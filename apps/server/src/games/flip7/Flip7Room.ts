import {
  GAME_CAPACITY, FLIP7_DEFAULTS, FLIP7_MAX_PLAYERS, FLIP7_MIN_PLAYERS, FLIP7_TARGETS, Flip7Error, buildDeck, choose,
  faceKey, flip7AutoMove, flip7Depart, flip7Turn, hit, newFlip7, nextRound, pendingChoice, stay,
  type Flip7Game, type Flip7Public, type Flip7Settings, type RoomState,
} from '@pic-game/shared';
import { BaseRoom, type CorePlayer, type IO, type RoomLifecycle } from '../../core/BaseRoom.js';

/** How long a disconnected player's move waits for them before the app makes
 *  it: a stay, or a random target for their action card. */
const AWAY_MS = Number(process.env.FLIP7_AWAY_MS) || 30_000;

/**
 * Flip 7 (see the shared types for the rules).
 *
 * Nothing is secret but the order of the deck, so there are no private
 * messages: one broadcast carries the whole table, with the deck reduced to
 * how many of each card are left.
 */
export class Flip7Room extends BaseRoom<CorePlayer> {
  readonly kind = 'flip7' as const;
  settings: Flip7Settings = { ...FLIP7_DEFAULTS };
  private game: Flip7Game | null = null;
  private awayTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string, io: IO) {
    super(code, io);
  }

  // ------------------------------------------------------- BaseRoom contract

  isLobby(): boolean {
    return !this.game;
  }

  lifecycle(): RoomLifecycle {
    return this.isLobby() ? 'lobby' : this.game?.stage === 'ended' ? 'ended' : 'playing';
  }

  get maxPlayers(): number {
    return GAME_CAPACITY.flip7;
  }

  protected get minPlayers(): number {
    return FLIP7_MIN_PLAYERS;
  }

  protected createPlayer(base: CorePlayer): CorePlayer {
    return base;
  }

  protected override onPlayerReconnected(): void {
    this.watchAway();
  }

  protected override onPlayerDisconnected(): boolean {
    this.watchAway();
    return false;
  }

  protected override onPlayerRemoved(playerId: string): boolean {
    const g = this.game;
    if (g && g.stage !== 'ended' && g.order.includes(playerId)) {
      flip7Depart(g, playerId);
      if (g.order.length - g.gone.length < FLIP7_MIN_PLAYERS) {
        this.onTooFewPlayers();
        return true;
      }
      this.afterMove();
      return true;
    }
    this.broadcast();
    return true;
  }

  protected override onTooFewPlayers(): void {
    if (this.game?.stage === 'ended') return;
    this.systemMessage('Not enough players left: back to the lobby.');
    this.toLobbyNow();
  }

  protected override onDestroy(): void {
    this.clearAway();
  }

  // --------------------------------------------------------------- settings

  updateSettings(by: string, patch: Partial<Flip7Settings>): void {
    if (by !== this.hostId || !this.canSetUp()) return;
    if ((FLIP7_TARGETS as readonly number[]).includes(patch.target as number)) this.settings.target = patch.target!;
    this.broadcast();
  }

  private canSetUp(): boolean {
    return !this.game || this.game.stage === 'ended';
  }

  startGame(by: string): void {
    if (by !== this.hostId || !this.canSetUp()) return;
    const here = this.order.filter((id) => this.players.get(id)?.connected);
    if (here.length < FLIP7_MIN_PLAYERS) {
      this.emitError(by, 'NOT_READY', `Flip 7 needs at least ${FLIP7_MIN_PLAYERS} players.`);
      return;
    }
    const seats = shuffle(here).slice(0, FLIP7_MAX_PLAYERS);
    this.game = newFlip7(seats, this.settings.target, Math.random);
    this.systemMessage(`First to ${this.settings.target}. ${this.nameOf(seats[0]!)} deals.`);
    this.afterMove();
  }

  // ------------------------------------------------------------------ moves

  private act(id: string, move: (g: Flip7Game) => void): void {
    const g = this.game;
    if (!g || !g.order.includes(id)) return;
    try {
      move(g);
    } catch (e) {
      if (e instanceof Flip7Error) return this.emitError(id, 'FLIP7', e.message);
      throw e;
    }
    this.afterMove();
  }

  hit(id: string): void {
    this.act(id, (g) => hit(g, id));
  }

  stay(id: string): void {
    this.act(id, (g) => stay(g, id));
  }

  choose(id: string, target: string): void {
    this.act(id, (g) => choose(g, id, target));
  }

  /** Any player in the game may deal the next round, so an absent host
   *  cannot hold everyone up. */
  next(id: string): void {
    this.act(id, (g) => nextRound(g));
  }

  private afterMove(): void {
    const g = this.game;
    if (g) {
      const done = g.events.find((e) => e.kind === 'round');
      if (done && done.kind === 'round') {
        const line = g.order
          .filter((id) => !g.gone.includes(id))
          .map((id) => `${this.nameOf(id)} ${g.hands[id]!.status === 'bust' ? 'bust' : done.scores[id]}`)
          .join(', ');
        this.systemMessage(`Round ${done.round}: ${line}.`);
      }
      if (g.stage === 'ended' && done) {
        this.recordWin(g.winners);
        this.systemMessage(`${g.winners.map((w) => this.nameOf(w)).join(' and ')} wins with ${g.totals[g.winners[0]!]}!`);
      }
    }
    this.watchAway();
    this.broadcast();
  }

  // ------------------------------------------------------------------ away

  /** Whoever the game is waiting on right now, if anyone. */
  private waitingOn(): string | null {
    const g = this.game;
    if (!g) return null;
    return pendingChoice(g)?.by ?? flip7Turn(g);
  }

  private watchAway(): void {
    const who = this.waitingOn();
    if (!who || this.players.get(who)?.connected) {
      this.clearAway();
      return;
    }
    if (this.awayTimer) return;
    const g = this.game;
    this.awayTimer = setTimeout(() => {
      this.awayTimer = null;
      if (this.game !== g || !g || this.waitingOn() !== who || this.players.get(who)?.connected) return;
      flip7AutoMove(g);
      this.systemMessage(`${this.nameOf(who)} is away, so the app moved for them.`);
      this.afterMove();
    }, AWAY_MS);
  }

  private clearAway(): void {
    if (this.awayTimer) clearTimeout(this.awayTimer);
    this.awayTimer = null;
  }

  // ------------------------------------------------------------------- end

  rematch(by: string): void {
    if (by !== this.hostId || this.game?.stage !== 'ended') return;
    this.startGame(by);
  }

  toLobby(by: string): void {
    if (by !== this.hostId || this.game?.stage !== 'ended') return;
    this.toLobbyNow();
  }

  private toLobbyNow(): void {
    this.clearAway();
    this.game = null;
    this.broadcast();
  }

  // ----------------------------------------------------------------- state

  private nameOf(id: string): string {
    return this.players.get(id)?.name ?? 'Someone';
  }

  gamePublic(): Flip7Public {
    const g = this.game;
    if (!g) {
      return {
        phase: 'lobby', settings: { ...this.settings }, players: [], round: 0, dealer: null, turn: null,
        hands: {}, totals: {}, lastRound: null, pending: null, flipping: null, deckCount: 0,
        discardCount: 0, remaining: {}, events: [], winners: [],
      };
    }
    // What is left to draw, by face. The deck is all that is not on the table
    // or in the discards; counting it saves players doing the same sums.
    const remaining: Record<string, number> = {};
    for (const c of buildDeck()) remaining[faceKey(c.face)] = 0;
    for (const c of g.deck) remaining[faceKey(c.face)]! += 1;
    return {
      phase: g.stage,
      settings: { ...this.settings },
      players: [...g.order],
      round: g.round,
      dealer: g.order[g.dealer] ?? null,
      turn: flip7Turn(g),
      hands: structuredClone(g.hands),
      totals: { ...g.totals },
      lastRound: g.lastRound ? { ...g.lastRound } : null,
      pending: pendingChoice(g),
      flipping: g.flipping ? { target: g.flipping.target, left: g.flipping.left } : null,
      deckCount: g.deck.length,
      discardCount: g.discard.length,
      remaining,
      events: structuredClone(g.events),
      winners: [...g.winners],
    };
  }

  publicState(): RoomState {
    return {
      kind: 'flip7',
      ...this.baseState(),
      game: this.gamePublic(),
    };
  }

  broadcast(): void {
    this.io.to(this.code).emit('flip7:state', this.gamePublic());
    this.syncMeta();
  }

  handleChat(playerId: string, raw: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const text = raw.slice(0, 200).trim();
    if (!text) return;
    this.broadcastChat({ kind: 'chat', playerId, name: player.name, text });
  }
}

function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
