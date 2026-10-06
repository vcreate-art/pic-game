import {
  GAME_CAPACITY, BINGO_BOUNDS, BINGO_DEFAULTS, CELLS, advanceTurn, callNumber, claim, daub, lines,
  newGame, randomCallerCard, randomTurnsCard, turnOf, uncalled, validTurnsCard,
  type BingoGame, type BingoPhase, type BingoPublic, type BingoSettings, type RoomState,
} from '@pic-game/shared';
import { BaseRoom, type CorePlayer, type IO, type RoomLifecycle } from '../../core/BaseRoom.js';

/** A wrong BINGO locks that player out of shouting again for this long. */
const CLAIM_COOLDOWN_MS = 3000;

/**
 * Bingo, both ways (see the shared types for the rules of each).
 *
 * Cards are private like a Star Realms hand: in the turns game a grid you
 * filled in yourself is strategy, since whoever knows it can call around you.
 * Each goes to its owner's socket, and `BingoPublic` shows every card only
 * once the game is over. The line counts are public, as they are at a table.
 *
 * Turns games have an extra phase before play, `arrange`, where everyone fills
 * in their grid on their own device and sends it when they are done.
 */
export class BingoRoom extends BaseRoom<CorePlayer> {
  readonly kind = 'bingo' as const;
  settings: BingoSettings = { ...BINGO_DEFAULTS };
  private stage: BingoPhase = 'lobby';
  private game: BingoGame | null = null;
  /** Arrange phase: who is in this game, and the grids they have finished. */
  private arrangers: string[] = [];
  private finished = new Map<string, number[]>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private endsAt = 0;
  private paused = false;
  private claimLock = new Map<string, number>();

  constructor(code: string, io: IO) {
    super(code, io);
  }

  // ------------------------------------------------------- BaseRoom contract

  get phase(): BingoPhase {
    return this.stage;
  }

  isLobby(): boolean {
    return this.stage === 'lobby';
  }

  lifecycle(): RoomLifecycle {
    return this.isLobby() ? 'lobby' : this.stage === 'ended' ? 'ended' : 'playing';
  }

  protected resetToLobby(): void {
    this.toLobbyNow();
  }

  get maxPlayers(): number {
    return GAME_CAPACITY.bingo;
  }

  /** A turns game needs someone to take turns with; a caller game does not. */
  protected get minPlayers(): number {
    return this.settings.mode === 'turns' ? 2 : 1;
  }

  protected createPlayer(base: CorePlayer): CorePlayer {
    return base;
  }

  protected override onPlayerReconnected(p: CorePlayer): void {
    this.sendCard(p.id);
    // If everyone had dropped, the call is stuck with someone who is not here.
    const g = this.game;
    if (g && this.stage === 'play' && g.mode === 'turns' && this.away(turnOf(g) ?? '')) this.nextTurn();
  }

  protected override onPlayerDisconnected(p: CorePlayer): boolean {
    if (this.stage === 'arrange') this.beginIfAllReady();
    else if (this.onTurn(p.id)) this.nextTurn();
    return false;
  }

  protected override onPlayerRemoved(playerId: string): boolean {
    this.claimLock.delete(playerId);
    if (this.stage === 'arrange') {
      this.arrangers = this.arrangers.filter((id) => id !== playerId);
      this.finished.delete(playerId);
      this.beginIfAllReady();
    } else if (this.onTurn(playerId)) {
      this.nextTurn();
    }
    this.broadcast();
    return true;
  }

  protected override onTooFewPlayers(): void {
    if (this.stage === 'ended') return;
    this.systemMessage('Not enough players left: back to the lobby.');
    this.toLobbyNow();
  }

  protected override onDestroy(): void {
    this.clearTimer();
  }

  // --------------------------------------------------------------- settings

  updateSettings(by: string, patch: Partial<BingoSettings>): void {
    if (by !== this.hostId || (this.stage !== 'lobby' && this.stage !== 'ended')) return;
    if (patch.mode === 'turns' || patch.mode === 'caller') this.settings.mode = patch.mode;
    if (patch.pattern === 'line' || patch.pattern === 'blackout') this.settings.pattern = patch.pattern;
    if (typeof patch.autoDaub === 'boolean') this.settings.autoDaub = patch.autoDaub;
    const clamp = (n: unknown, b: { min: number; max: number }) =>
      typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.max(b.min, Math.min(b.max, n))) : null;
    const t = clamp(patch.turnSeconds, BINGO_BOUNDS.turnSeconds);
    if (t !== null) this.settings.turnSeconds = t;
    const c = clamp(patch.callSeconds, BINGO_BOUNDS.callSeconds);
    if (c !== null) this.settings.callSeconds = c;
    this.broadcast();
  }

  // ------------------------------------------------------------------ start

  startGame(by: string): void {
    if (by !== this.hostId || (this.stage !== 'lobby' && this.stage !== 'ended')) return;
    const here = this.connectedPlayers().map((p) => p.id);
    if (here.length < this.minPlayers) {
      this.emitError(by, 'NOT_READY', 'You need at least two players to take turns.');
      return;
    }
    this.clearTimer();
    this.game = null;
    this.claimLock.clear();
    this.paused = false;

    if (this.settings.mode === 'turns') {
      this.stage = 'arrange';
      this.arrangers = here;
      this.finished.clear();
      for (const id of this.players.keys()) this.sendCard(id);
      this.broadcast();
      this.systemMessage('Fill in your grids: 1 to 25, in any order you like.');
      return;
    }

    const cards: Record<string, number[]> = {};
    for (const id of here) cards[id] = randomCallerCard(Math.random);
    this.game = newGame('caller', this.settings.pattern, cards);
    this.stage = 'play';
    for (const id of this.players.keys()) this.sendCard(id);
    this.systemMessage(
      this.settings.callSeconds
        ? `Eyes down! A ball every ${this.settings.callSeconds} seconds.`
        : 'Eyes down! The host calls the balls.',
    );
    this.scheduleBall();
    this.broadcast();
  }

  /** Turns: a grid is in, or taken back to change it. */
  ready(id: string, card: unknown): void {
    if (this.stage !== 'arrange' || !this.arrangers.includes(id)) return;
    if (card === null) this.finished.delete(id);
    else if (validTurnsCard(card)) this.finished.set(id, [...card]);
    else return this.emitError(id, 'BAD_CARD', 'Use each number from 1 to 25 once.');
    this.sendCard(id);
    if (!this.beginIfAllReady()) this.broadcast();
  }

  /** Host: stop waiting. Whoever has not finished gets a grid filled in at random. */
  begin(by: string): void {
    if (by !== this.hostId || this.stage !== 'arrange') return;
    this.beginPlay();
  }

  /** Starts once every player still connected has sent a grid. */
  private beginIfAllReady(): boolean {
    if (this.stage !== 'arrange') return false;
    const waiting = this.arrangers.filter((id) => this.players.get(id)?.connected && !this.finished.has(id));
    if (waiting.length || !this.finished.size) return false;
    this.beginPlay();
    return true;
  }

  private beginPlay(): void {
    const ids = this.arrangers.filter((id) => this.players.has(id));
    if (ids.length < 2) return this.onTooFewPlayers();
    const cards: Record<string, number[]> = {};
    for (const id of ids) cards[id] = this.finished.get(id) ?? randomTurnsCard(Math.random);
    this.game = newGame('turns', 'line', cards);
    // Whoever calls first is drawn by lot, then it goes round in join order.
    this.game.turn = Math.floor(Math.random() * ids.length);
    if (!this.players.get(ids[this.game.turn]!)?.connected) advanceTurn(this.game, (id) => this.away(id));
    this.stage = 'play';
    this.arrangers = [];
    this.finished.clear();
    for (const id of this.players.keys()) this.sendCard(id);
    this.startTurnTimer();
    this.broadcast();
    this.systemMessage(`${this.nameOf(turnOf(this.game))} calls first.`);
  }

  // ------------------------------------------------------------ turns play

  private away(id: string): boolean {
    return !this.players.get(id)?.connected;
  }

  private onTurn(id: string): boolean {
    const g = this.game;
    return this.stage === 'play' && g?.mode === 'turns' && turnOf(g) === id;
  }

  call(id: string, n: number): void {
    if (!this.onTurn(id)) return;
    const g = this.game!;
    if (!uncalled(g).includes(n)) return this.emitError(id, 'CALLED', `${n} has already been called.`);
    this.applyCall(n, id);
  }

  private applyCall(n: number, by: string): void {
    const g = this.game!;
    const won = callNumber(g, n);
    for (const pid of g.order) this.sendCard(pid);
    this.systemMessage(`${this.nameOf(by)} called ${n}.`);
    if (won.length) return this.finish();
    this.nextTurn();
  }

  /** On to the next player who is here. With nobody left to call, it waits. */
  private nextTurn(): void {
    const g = this.game;
    if (!g || this.stage !== 'play' || g.mode !== 'turns') return;
    advanceTurn(g, (id) => this.away(id));
    this.startTurnTimer();
    this.broadcast();
  }

  /** Running out of time calls a number at random, rather than skipping: a
   *  skipped turn would let a slow player stall everyone else's grids. */
  private startTurnTimer(): void {
    this.clearTimer();
    const secs = this.settings.turnSeconds;
    if (!secs) return;
    this.endsAt = Date.now() + secs * 1000;
    this.timer = setTimeout(() => {
      this.timer = null;
      const g = this.game;
      if (!g || this.stage !== 'play') return;
      const left = uncalled(g);
      const who = turnOf(g);
      if (!who || !left.length) return;
      this.applyCall(left[Math.floor(Math.random() * left.length)]!, who);
    }, secs * 1000);
  }

  // ----------------------------------------------------------- caller play

  private caller(): BingoGame | null {
    const g = this.game;
    return this.stage === 'play' && g?.mode === 'caller' ? g : null;
  }

  private drawBall(): void {
    const g = this.caller();
    if (!g) return;
    const left = uncalled(g);
    if (!left.length) {
      this.clearTimer();
      this.broadcast();
      return;
    }
    const n = left[Math.floor(Math.random() * left.length)]!;
    callNumber(g, n, this.settings.autoDaub);
    if (this.settings.autoDaub) for (const id of g.order) this.sendCard(id);
    if (left.length === 1) this.systemMessage('That was the last ball.');
    this.scheduleBall();
    this.broadcast();
  }

  private scheduleBall(): void {
    this.clearTimer();
    const g = this.caller();
    const secs = this.settings.callSeconds;
    if (!g || !secs || this.paused || !uncalled(g).length) return;
    this.endsAt = Date.now() + secs * 1000;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drawBall();
    }, secs * 1000);
  }

  /** Host: the next ball now, whether the draw is on a clock or by hand. */
  next(by: string): void {
    if (by !== this.hostId || !this.caller()) return;
    this.drawBall();
  }

  pause(by: string): void {
    if (by !== this.hostId || !this.caller() || !this.settings.callSeconds) return;
    this.paused = !this.paused;
    this.systemMessage(this.paused ? 'The draw is on hold.' : 'The draw is back on.');
    this.scheduleBall();
    this.broadcast();
  }

  daubCard(id: string, index: number): void {
    const g = this.caller();
    if (!g || this.settings.autoDaub) return;
    if (!daub(g, id, index)) return;
    this.sendCard(id);
    this.broadcast();
  }

  shout(id: string): void {
    const g = this.caller();
    if (!g || !g.order.includes(id)) return;
    const now = Date.now();
    if ((this.claimLock.get(id) ?? 0) > now) return;
    if (claim(g, id)) return this.finish();
    this.claimLock.set(id, now + CLAIM_COOLDOWN_MS);
    this.emitError(id, 'NO_BINGO', 'Not a bingo yet! Wait a moment before calling again.');
    this.systemMessage(`${this.nameOf(id)} shouted BINGO… too soon!`);
  }

  // ------------------------------------------------------------------- end

  private finish(): void {
    this.clearTimer();
    const g = this.game!;
    this.stage = 'ended';
    this.recordWin(g.winners);
    const names = g.winners.map((id) => this.nameOf(id));
    this.systemMessage(
      names.length > 1 ? `BINGO! ${names.join(' and ')} share the win.` : `BINGO! ${names[0]} wins.`,
    );
    this.broadcast();
  }

  rematch(by: string): void {
    if (by !== this.hostId || this.stage !== 'ended') return;
    this.startGame(by);
  }

  toLobby(by: string): void {
    if (by !== this.hostId || this.stage !== 'ended') return;
    this.toLobbyNow();
  }

  private toLobbyNow(): void {
    this.clearTimer();
    this.stage = 'lobby';
    this.game = null;
    this.arrangers = [];
    this.finished.clear();
    this.paused = false;
    for (const id of this.players.keys()) this.sendCard(id);
    this.broadcast();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.endsAt = 0;
  }

  // ----------------------------------------------------------------- state

  private nameOf(id: string | null): string {
    return (id && this.players.get(id)?.name) || 'Someone';
  }

  /** This player's card, to their socket alone. */
  private sendCard(id: string): void {
    const g = this.game;
    if (g?.cards[id]) {
      this.emitTo(id, 'bingo:card', { numbers: [...g.cards[id]!], marked: [...g.marked[id]!] });
      return;
    }
    const mine = this.stage === 'arrange' ? this.finished.get(id) : undefined;
    this.emitTo(id, 'bingo:card', mine ? { numbers: [...mine], marked: Array(CELLS).fill(false) } : null);
  }

  gamePublic(): BingoPublic {
    const g = this.game;
    const counts: Record<string, number> = {};
    if (g) for (const id of g.order) counts[id] = lines(g, id);
    const ended = this.stage === 'ended' && g;
    return {
      phase: this.stage,
      settings: { ...this.settings },
      players: this.stage === 'arrange' ? [...this.arrangers] : g ? [...g.order] : [],
      ready: [...this.finished.keys()],
      called: g ? [...g.called] : [],
      turn: g && this.stage === 'play' && g.mode === 'turns' ? turnOf(g) : null,
      lines: counts,
      paused: this.paused,
      endsAt: this.endsAt,
      winners: g ? [...g.winners] : [],
      cards: ended ? structuredClone(g.cards) : null,
    };
  }

  publicState(): RoomState {
    return {
      kind: 'bingo',
      ...this.baseState(),
      game: this.gamePublic(),
    };
  }

  broadcast(): void {
    this.io.to(this.code).emit('bingo:state', this.gamePublic());
    this.syncMeta();
  }

  handleChat(playerId: string, raw: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const text = raw.slice(0, 100).trim();
    if (!text) return;
    this.broadcastChat({ kind: 'chat', playerId, name: player.name, text });
  }
}
