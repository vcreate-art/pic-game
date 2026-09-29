import {
  CRYPTID_DEFAULTS, CRYPTID_MAX_PLAYERS, CRYPTID_MIN_PLAYERS, CryptidError, autoMove, clueText,
  cryptidTurn, depart, generatePuzzle, hexLabel, newCryptid, placeCube, question, search, setupLeft,
  type CryptidClue, type CryptidGame, type CryptidPublic, type CryptidSettings, type RoomState,
} from '@pic-game/shared';
import { BaseRoom, type CorePlayer, type IO } from '../../core/BaseRoom.js';

/** How long a disconnected player's turn waits for them before the app moves
 *  for them. Long enough for a refresh or a phone waking up. */
const AWAY_MS = Number(process.env.CRYPTID_AWAY_MS) || 30_000;

/**
 * Cryptid (see the shared types for the rules).
 *
 * Clues are private like a Star Realms hand: each goes to its owner's socket
 * alone, and `CryptidPublic` carries none until the game ends. The one
 * exception is a player who leaves mid-game. Their clue still counts, since
 * the puzzle needs it, so it goes public for everyone to reason with.
 *
 * Every answer comes from the server, which holds all the clues, so nobody is
 * asked to do anything when questioned: only the player to move acts.
 */
export class CryptidRoom extends BaseRoom<CorePlayer> {
  readonly kind = 'cryptid' as const;
  settings: CryptidSettings = { ...CRYPTID_DEFAULTS };
  private game: CryptidGame | null = null;
  /** Names of players who left mid-game, for the history. */
  private departed: Record<string, string> = {};
  private awayTimer: ReturnType<typeof setTimeout> | null = null;
  /** The name of whoever is being removed, while their removal runs. */
  private leavingName: string | null = null;

  constructor(code: string, io: IO) {
    super(code, io);
  }

  // ------------------------------------------------------- BaseRoom contract

  isLobby(): boolean {
    return !this.game;
  }

  get maxPlayers(): number {
    // Five play; the rest can watch.
    return 12;
  }

  /** Below this mid-game, there is nobody left to find it against. */
  protected get minPlayers(): number {
    return 2;
  }

  protected createPlayer(base: CorePlayer): CorePlayer {
    return base;
  }

  protected override onPlayerReconnected(p: CorePlayer): void {
    this.sendClue(p.id);
    this.watchTurn();
  }

  protected override onPlayerDisconnected(): boolean {
    this.watchTurn();
    return false;
  }

  /** BaseRoom drops the seat before `onPlayerRemoved` runs, so the name is
   *  caught on the way out for the history and the open clue. */
  override removePlayer(playerId: string): void {
    this.leavingName = this.players.get(playerId)?.name ?? null;
    try {
      super.removePlayer(playerId);
    } finally {
      this.leavingName = null;
    }
  }

  protected override onPlayerRemoved(playerId: string): boolean {
    const g = this.game;
    if (g && g.stage !== 'ended' && g.order.includes(playerId)) {
      this.departed[playerId] = this.leavingName ?? 'Someone';
      depart(g, playerId);
      // Watchers keep the room above its minimum, so count the table itself.
      if (g.order.length - g.gone.length < 2) {
        this.onTooFewPlayers();
        return true;
      }
      this.systemMessage(`${this.departed[playerId]} is out. Their clue still counts, so it is now open: "${clueText(g.clues[playerId]!)}".`);
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

  updateSettings(by: string, patch: Partial<CryptidSettings>): void {
    if (by !== this.hostId || !this.canSetUp()) return;
    if (typeof patch.advanced === 'boolean') this.settings.advanced = patch.advanced;
    this.broadcast();
  }

  private canSetUp(): boolean {
    return !this.game || this.game.stage === 'ended';
  }

  // ------------------------------------------------------------------ start

  startGame(by: string): void {
    if (by !== this.hostId || !this.canSetUp()) return;
    const here = this.order.filter((id) => this.players.get(id)?.connected);
    if (here.length < CRYPTID_MIN_PLAYERS) {
      this.emitError(by, 'NOT_READY', `Cryptid needs at least ${CRYPTID_MIN_PLAYERS} players.`);
      return;
    }
    // Five at most; anyone past that watches this one.
    const seats = shuffle(here).slice(0, CRYPTID_MAX_PLAYERS);
    const puzzle = generatePuzzle(seats.length, this.settings.advanced, Math.random);
    this.game = newCryptid(puzzle.board, seats, puzzle.clues, puzzle.answer);
    this.departed = {};
    for (const id of this.players.keys()) this.sendClue(id);
    this.systemMessage(`A new map. ${this.nameOf(seats[0]!)} goes first: everyone puts down two cubes where their clue rules the creature out.`);
    this.afterMove();
  }

  // ------------------------------------------------------------------ moves

  /** Runs a move, turning a refusal into an error for that player alone. */
  private act(id: string, move: (g: CryptidGame) => void): void {
    const g = this.game;
    if (!g || !g.order.includes(id)) return;
    try {
      move(g);
    } catch (e) {
      if (e instanceof CryptidError) return this.emitError(id, 'CRYPTID', e.message);
      throw e;
    }
    this.afterMove();
  }

  cube(id: string, hex: number): void {
    this.act(id, (g) => placeCube(g, id, hex));
  }

  ask(id: string, target: string, hex: number): void {
    this.act(id, (g) => {
      const yes = question(g, id, target, hex);
      this.systemMessage(
        `${this.nameOf(id)} asked ${this.nameOf(target)} about ${hexLabel(hex)}: ${yes ? 'could be.' : 'no.'}`,
      );
    });
  }

  searchAt(id: string, hex: number): void {
    this.act(id, (g) => {
      const found = search(g, id, hex);
      this.systemMessage(
        found
          ? `${this.nameOf(id)} searched ${hexLabel(hex)} and found the creature!`
          : `${this.nameOf(id)} searched ${hexLabel(hex)}. Nothing there.`,
      );
    });
  }

  /** After any change: settle the ending, check the player to move is here,
   *  and tell everyone. */
  private afterMove(): void {
    const g = this.game;
    if (g?.stage === 'ended' && g.winner) {
      const p = this.players.get(g.winner);
      if (p) {
        p.score += 1;
        this.io.to(this.code).emit('player:updated', this.publicPlayer(p));
      }
    }
    this.watchTurn();
    this.broadcast();
  }

  // ----------------------------------------------------------------- away

  /**
   * When the player to move is disconnected, give them a while to come back,
   * then move for them: an owed cube goes on a random space their clue rules
   * out, and an ordinary turn passes.
   */
  private watchTurn(): void {
    const g = this.game;
    const who = g ? cryptidTurn(g) : null;
    if (!g || g.stage === 'ended' || !who || this.players.get(who)?.connected) {
      this.clearAway();
      return;
    }
    if (this.awayTimer) return;
    this.awayTimer = setTimeout(() => {
      this.awayTimer = null;
      const now = this.game;
      if (!now || now !== g || cryptidTurn(now) !== who || this.players.get(who)?.connected) return;
      autoMove(now, Math.random);
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
    this.departed = {};
    for (const id of this.players.keys()) this.sendClue(id);
    this.broadcast();
  }

  // ----------------------------------------------------------------- state

  private nameOf(id: string): string {
    return this.players.get(id)?.name ?? this.departed[id] ?? 'Someone';
  }

  /** This player's clue, to their socket alone. */
  private sendClue(id: string): void {
    const clue = this.game?.clues[id] ?? null;
    this.emitTo(id, 'cryptid:clue', { clue: clue ? { ...clue } : null });
  }

  gamePublic(): CryptidPublic {
    const g = this.game;
    if (!g) {
      return {
        phase: 'lobby', settings: { ...this.settings }, board: null, players: [], turn: null,
        setupLeft: 0, disks: [], cubes: [], log: [], winner: null, openClues: {}, departed: {}, answer: null,
      };
    }
    const ended = g.stage === 'ended';
    const openClues: Record<string, CryptidClue> = {};
    for (const id of g.order) {
      if (ended || g.gone.includes(id)) openClues[id] = { ...g.clues[id]! };
    }
    return {
      phase: g.stage,
      settings: { ...this.settings },
      board: g.board,
      players: [...g.order],
      turn: ended ? null : cryptidTurn(g),
      setupLeft: setupLeft(g),
      disks: g.disks.map((d) => [...d]),
      cubes: [...g.cubes],
      log: g.log,
      winner: g.winner,
      openClues,
      departed: { ...this.departed },
      answer: ended ? g.answer : null,
    };
  }

  publicState(): RoomState {
    return {
      kind: 'cryptid',
      code: this.code,
      players: this.publicPlayers(),
      hostId: this.hostId,
      serverTime: Date.now(),
      game: this.gamePublic(),
    };
  }

  broadcast(): void {
    this.io.to(this.code).emit('cryptid:state', this.gamePublic());
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
