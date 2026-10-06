import { randomUUID } from 'node:crypto';
import {
  GAME_CAPACITY, MANUAL_BONUSES, TOURNEY_BOUNDS, cancelMatch, endNow, isMain, newEntrant, newTourney, report,
  startMatch, startTourney, swapNext, validateTourney,
  type Avatar, type BonusKind, type ManualBonus, type MatchScore, type RoomState,
  type TourneyBonuses, type TourneyPublic, type TourneySettings, type TourneyState,
} from '@pic-game/shared';
import { TOURNEY_KEEP_MS } from '../../config.js';
import { BaseRoom, type CorePlayer, type IO, type RoomLifecycle } from '../../core/BaseRoom.js';

/** How many results can be taken back, newest first. */
const UNDO_DEPTH = 50;

const BONUS_NAMES: Record<BonusKind, string> = {
  clean: 'a clean 2-0', streak: 'a win streak', flawless: 'a Flawless Victory',
  fatality: 'a Fatality', brutality: 'a Brutality',
};

/**
 * An MK11 points tournament. The fights happen on a console; this room keeps
 * the stacks, the circle and the results (the rules are in the shared engine).
 *
 * Only the host changes anything once it has started. Everyone else, and the
 * host's other devices, just watch it update. Nothing is secret, so the whole
 * tournament goes to everyone on every change.
 *
 * A tournament runs for an evening from a phone that sleeps between matches,
 * so this room and its seats are kept for hours rather than minutes.
 */
export class TourneyRoom extends BaseRoom<CorePlayer> {
  readonly kind = 'tourney' as const;
  private t: TourneyState = newTourney();
  /** The tournament as it was before each result, for Undo. */
  private undoStack: TourneyState[] = [];

  constructor(code: string, io: IO) {
    super(code, io);
  }

  // ------------------------------------------------------- BaseRoom contract

  isLobby(): boolean {
    return this.t.phase === 'setup';
  }

  lifecycle(): RoomLifecycle {
    return this.isLobby() ? 'lobby' : this.t.phase === 'ended' ? 'ended' : 'playing';
  }

  /** The same players, signed up afresh: the bracket and results go. */
  protected resetToLobby(): void {
    const entrants = this.t.entrants.map((e) => newEntrant(e.id, e.name, e.main, e.playerId));
    this.t = { ...newTourney(this.t.settings), entrants };
    this.undoStack = [];
    this.broadcast();
  }

  get maxPlayers(): number {
    return GAME_CAPACITY.tourney;
  }

  /** Nothing is played in the app, so nobody leaving can stop it. */
  protected get minPlayers(): number {
    return 1;
  }

  protected override get emptyTtlMs(): number {
    return TOURNEY_KEEP_MS;
  }

  protected override get reconnectGraceMs(): number {
    return TOURNEY_KEEP_MS;
  }

  protected createPlayer(base: CorePlayer): CorePlayer {
    return base;
  }

  /** Someone who leaves stays in the tournament; only the link to them goes. */
  protected override onPlayerRemoved(playerId: string): boolean {
    for (const e of this.t.entrants) if (e.playerId === playerId) e.playerId = null;
    this.broadcast();
    return true;
  }

  /** A player renaming themselves before the start renames their entry too. */
  override rename(playerId: string, name: string, avatar: Avatar): void {
    super.rename(playerId, name, avatar);
    const mine = this.t.entrants.find((e) => e.playerId === playerId);
    if (mine && this.t.phase === 'setup' && !this.nameTaken(name, mine.id)) {
      mine.name = name;
      this.broadcast();
    }
  }

  // ----------------------------------------------------------------- setup

  private isHost(by: string): boolean {
    return by === this.hostId;
  }

  private inSetup(by: string): boolean {
    return this.isHost(by) && this.t.phase === 'setup';
  }

  private nameTaken(name: string, except?: string): boolean {
    const n = name.toLowerCase();
    return this.t.entrants.some((e) => e.id !== except && e.name.toLowerCase() === n);
  }

  private full(by: string): boolean {
    if (this.t.entrants.length < TOURNEY_BOUNDS.entrants.max) return false;
    this.emitError(by, 'FULL', `A tournament takes ${TOURNEY_BOUNDS.entrants.max} players at most.`);
    return true;
  }

  updateSettings(
    by: string,
    patch: Partial<Omit<TourneySettings, 'bonuses'>> & { bonuses?: Partial<TourneyBonuses> },
  ): void {
    if (!this.inSetup(by)) return;
    const s = this.t.settings;
    const B = TOURNEY_BOUNDS;
    const int = (v: unknown, b: { min: number; max: number }) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(b.min, Math.min(b.max, v))) : null;
    if (typeof patch.name === 'string') {
      const name = patch.name.replace(/\s+/g, ' ').trim().slice(0, B.name.max);
      if (name) s.name = name;
    }
    for (const k of ['startPoints', 'entryFee', 'riseEvery', 'risePercent'] as const) {
      const v = int(patch[k], B[k]);
      if (v !== null) s[k] = v;
    }
    for (const k of ['clean', 'streak', ...MANUAL_BONUSES] as const) {
      const v = int(patch.bonuses?.[k], B.bonus);
      if (v !== null) s.bonuses[k] = v;
    }
    this.broadcast();
  }

  add(by: string, name: string, main: unknown): void {
    if (!this.inSetup(by) || this.full(by)) return;
    if (this.nameTaken(name)) return this.emitError(by, 'NAME_TAKEN', `${name} is already in.`);
    this.t.entrants.push(newEntrant(randomUUID().slice(0, 8), name, isMain(main) ? main : null, null));
    this.broadcast();
  }

  /** Everyone here who is not entered yet. A typed-in entry with the same
   *  name is taken to be them, and linked rather than doubled. */
  addRoom(by: string): void {
    if (!this.inSetup(by)) return;
    for (const p of this.connectedPlayers()) {
      if (this.t.entrants.some((e) => e.playerId === p.id)) continue;
      const same = this.t.entrants.find((e) => !e.playerId && e.name.toLowerCase() === p.name.toLowerCase());
      if (same) same.playerId = p.id;
      else if (this.t.entrants.length < TOURNEY_BOUNDS.entrants.max && !this.nameTaken(p.name)) {
        this.t.entrants.push(newEntrant(randomUUID().slice(0, 8), p.name, null, p.id));
      }
    }
    this.broadcast();
  }

  remove(by: string, id: string): void {
    if (!this.inSetup(by)) return;
    this.t.entrants = this.t.entrants.filter((e) => e.id !== id);
    this.broadcast();
  }

  signUp(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || this.t.phase !== 'setup' || this.full(playerId)) return;
    if (this.t.entrants.some((e) => e.playerId === playerId)) return;
    if (this.nameTaken(p.name)) {
      return this.emitError(playerId, 'NAME_TAKEN', `${p.name} is already in. Change your name, or ask the host.`);
    }
    this.t.entrants.push(newEntrant(randomUUID().slice(0, 8), p.name, null, playerId));
    this.broadcast();
  }

  withdraw(playerId: string): void {
    if (this.t.phase !== 'setup') return;
    this.t.entrants = this.t.entrants.filter((e) => e.playerId !== playerId);
    this.broadcast();
  }

  /** Mains are only for show, so they can change at any point. */
  setMain(by: string, id: string, main: unknown): void {
    const e = this.t.entrants.find((x) => x.id === id);
    if (!e || !(this.isHost(by) || e.playerId === by)) return;
    if (main !== null && !isMain(main)) return;
    e.main = main;
    this.broadcast();
  }

  startGame(by: string): void {
    if (!this.inSetup(by)) return;
    if (this.t.entrants.length < TOURNEY_BOUNDS.entrants.min) {
      return this.emitError(by, 'NOT_READY', 'Add at least two players.');
    }
    startTourney(this.t, Math.random);
    this.undoStack = [];
    this.systemMessage(`${this.t.settings.name} is on: ${this.t.entrants.length} players, ${this.t.settings.startPoints} points each.`);
    this.broadcast();
  }

  // ------------------------------------------------------------------ play

  /** Runs an engine step for the host, turning a refusal into a message. */
  private step(by: string, fn: () => void, undoable = false): boolean {
    if (!this.isHost(by) || this.t.phase === 'setup') return false;
    const before = undoable ? structuredClone(this.t) : null;
    try {
      fn();
    } catch (err) {
      this.emitError(by, 'REFUSED', err instanceof Error ? err.message : 'Not now.');
      return false;
    }
    if (before) this.undoStack = [...this.undoStack, before].slice(-UNDO_DEPTH);
    this.broadcast();
    return true;
  }

  swap(by: string, side: 0 | 1, id: string): void {
    this.step(by, () => swapNext(this.t, side, id));
  }

  startMatch(by: string): void {
    this.step(by, () => startMatch(this.t));
  }

  cancel(by: string): void {
    this.step(by, () => cancelMatch(this.t));
  }

  report(
    by: string,
    winner: string,
    score: MatchScore,
    ticked: ManualBonus[],
    chars: { a: string | null; b: string | null } | null,
  ): void {
    const cleanChars = chars && {
      a: isMain(chars.a) ? chars.a : null,
      b: isMain(chars.b) ? chars.b : null,
    };
    let said = '';
    const ok = this.step(by, () => {
      const r = report(this.t, winner, score, [...new Set(ticked)], cleanChars?.a || cleanChars?.b ? cleanChars : null, Math.random);
      const extra = r.bonuses.reduce((s, b) => s + b.points, 0);
      const w = this.nameOf(r.winner);
      const l = this.nameOf(r.winner === r.a ? r.b : r.a);
      const how = r.bonuses.length ? ` with ${r.bonuses.map((b) => BONUS_NAMES[b.kind]).join(', ')}` : '';
      said = `${w} beat ${l} ${r.score}${how}: +${r.pot + extra}.`;
      const out = this.t.entrants.find((e) => e.outOnTurn === r.n);
      if (out) said += ` ${out.name} is out!`;
    }, true);
    if (!ok) return;
    this.systemMessage(said);
    if (this.t.phase === 'ended') this.announceWinners();
  }

  undo(by: string): void {
    if (!this.isHost(by) || this.t.phase === 'setup' || this.t.phase === 'fighting') return;
    const prev = this.undoStack.at(-1);
    if (!prev) return;
    this.undoStack = this.undoStack.slice(0, -1);
    // Undoing the result that ended it takes the win back as well.
    if (this.t.phase === 'ended' && prev.phase !== 'ended') this.revokeLastWin();
    this.t = prev;
    this.systemMessage('The host took back the last result.');
    this.broadcast();
  }

  end(by: string): void {
    if (this.step(by, () => endNow(this.t), true)) this.announceWinners();
  }

  /** Same players, fresh tournament. */
  toSetup(by: string): void {
    if (!this.isHost(by) || this.t.phase !== 'ended') return;
    this.resetToLobby();
  }

  /** A tournament saved in the host's browser, brought back after a restart.
   *  Room players are matched back to their entries by name. */
  restore(by: string, raw: unknown): void {
    if (!this.inSetup(by)) return;
    const t = validateTourney(raw);
    if (!t) return this.emitError(by, 'BAD_SAVE', 'That saved tournament could not be read.');
    for (const e of t.entrants) {
      const p = [...this.players.values()].find((x) => x.name.toLowerCase() === e.name.toLowerCase());
      if (p) e.playerId = p.id;
    }
    this.t = t;
    this.undoStack = [];
    this.systemMessage(`${t.settings.name} was restored, on turn ${t.turn}.`);
    this.broadcast();
  }

  private announceWinners(): void {
    this.recordWin(this.t.winners.map((id) => this.t.entrants.find((e) => e.id === id)?.playerId));
    const names = this.t.winners.map((id) => this.nameOf(id));
    this.systemMessage(names.length > 1 ? `It's a tie: ${names.join(' and ')} share the win!` : `${names[0]} wins the tournament!`);
  }

  private nameOf(id: string): string {
    return this.t.entrants.find((e) => e.id === id)?.name ?? 'Someone';
  }

  // ----------------------------------------------------------------- state

  gamePublic(): TourneyPublic {
    return { ...structuredClone(this.t), canUndo: this.undoStack.length > 0 && this.t.phase !== 'fighting' };
  }

  publicState(): RoomState {
    return {
      kind: 'tourney',
      ...this.baseState(),
      game: this.gamePublic(),
    };
  }

  broadcast(): void {
    this.io.to(this.code).emit('tourney:state', this.gamePublic());
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
