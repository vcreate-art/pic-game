import { performance } from 'node:perf_hooks';
import {
  GAME_CAPACITY, BTN_ALL, FIGHTER_IDS, FIGHT_BOUNDS, FIGHT_DEFAULTS, FIGHT_SIDES, TICK_HZ, createMatch,
  otherSide, step, toFrame, type FightEnding, type FightEvent, type FightPicks,
  type FightPublic, type FightRoomPhase, type FightSeats, type FightSettings,
  type FightSide, type FighterId, type Match, type RoomState,
} from '@pic-game/shared';
import { FIGHT_FORFEIT_MS, FIGHT_RESUME_MS } from '../../config.js';
import { BaseRoom, type CorePlayer, type IO, type RoomLifecycle } from '../../core/BaseRoom.js';

const STEP_MS = 1000 / TICK_HZ;
/** Most ticks run to catch up after a stall. Past this the backlog is dropped:
 *  fast-forwarding a fight the players cannot see helps nobody. */
const MAX_CATCH_UP = 5;

interface Controls {
  held: number;
  /** Button-down edges since the last tick, cleared as each tick reads them. */
  pressed: number;
  seq: number;
}

const idle = (): Controls => ({ held: 0, pressed: 0, seq: -1 });

/**
 * Stick Kombat: the app's only real-time game, and the only room with a clock
 * of its own.
 *
 * Everything else here reacts to events. A fighting game cannot: things
 * happen between inputs (a jump arcs, a projectile flies, hitstun wears off),
 * so the server runs the shared sim at a fixed 60 Hz and sends every tick out.
 * Clients only ever send controller state and render what comes back, which
 * makes the server the single authority on who hit whom.
 */
export class FightRoom extends BaseRoom<CorePlayer> {
  readonly kind = 'fight' as const;
  settings: FightSettings = { ...FIGHT_DEFAULTS };
  phase: FightRoomPhase = 'lobby';
  seats: FightSeats = { a: null, b: null };
  picks: FightPicks = { a: null, b: null };
  private match: Match | null = null;
  private controls: Record<FightSide, Controls> = { a: idle(), b: idle() };
  private winner: FightSide | null = null;
  private reason: FightEnding = null;
  private paused: FightPublic['paused'] = null;

  private loop: ReturnType<typeof setTimeout> | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  /** What a fighter's countdown does when it runs out. */
  private pauseThen: (() => void) | null = null;
  private last = 0;
  private acc = 0;

  constructor(code: string, io: IO) {
    super(code, io);
  }

  // ------------------------------------------------------- BaseRoom contract

  isLobby(): boolean {
    return this.phase === 'lobby';
  }

  lifecycle(): RoomLifecycle {
    return this.isLobby() ? 'lobby' : this.phase === 'ended' ? 'ended' : 'playing';
  }

  /** The loop stops ticking while paused. A fighter's own countdown, for a
   *  drop-out or the get-ready after one, stops with it and resumes with the
   *  time it had left. */
  protected override get pausable(): boolean {
    return true;
  }

  protected override onPause(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
  }

  protected override onResume(pausedMs: number): void {
    if (this.paused) {
      this.paused.until += pausedMs;
      this.armPause(this.paused.until - Date.now());
    }
    // Whatever was held when it stopped isn't held any more.
    this.controls = { a: idle(), b: idle() };
    this.broadcast();
  }

  /** Seats and picks stay, so a restart goes straight to the fight. */
  protected resetToLobby(): void {
    this.stopLoop();
    this.clearPause();
    this.phase = 'lobby';
    this.match = null;
    this.broadcast();
  }

  /** Two fighters, and room for a crowd. */
  get maxPlayers(): number {
    return GAME_CAPACITY.fight;
  }

  protected get minPlayers(): number {
    return 2;
  }

  protected createPlayer(base: CorePlayer): CorePlayer {
    return base;
  }

  /**
   * A fighter dropping mid-match freezes it rather than ending it: a refresh
   * or a Wi-Fi blip should not hand the other player the win. If they are not
   * back in time, they forfeit.
   */
  protected override onPlayerDisconnected(p: CorePlayer): boolean {
    const side = this.sideOf(p.id);
    if (!side) return false;
    if (this.phase !== 'playing') {
      this.vacate(side);
      return true;
    }
    this.controls[side] = idle();
    // Both gone: the first one's clock keeps running rather than restarting.
    if (this.paused && !this.paused.resuming) return true;
    this.pauseFor(side);
    return true;
  }

  protected override onPlayerReconnected(p: CorePlayer): void {
    const side = this.sideOf(p.id);
    if (!side || this.paused?.side !== side || this.paused.resuming) return;
    this.setPause({ side, until: Date.now() + FIGHT_RESUME_MS, resuming: true }, () => {
      this.paused = null;
      // The other fighter may have dropped while this one was away.
      const gone = FIGHT_SIDES.find((s) => !this.players.get(this.seats[s] ?? '')?.connected);
      if (gone) this.pauseFor(gone);
      else this.broadcast();
    });
  }

  private pauseFor(side: FightSide): void {
    this.setPause({ side, until: Date.now() + FIGHT_FORFEIT_MS, resuming: false }, () =>
      this.forfeit(side),
    );
  }

  protected override onPlayerRemoved(playerId: string): boolean {
    const side = this.sideOf(playerId);
    if (!side) return false;
    if (this.phase === 'playing') this.forfeit(side);
    this.vacate(side);
    return true;
  }

  protected override onDestroy(): void {
    this.stopLoop();
    this.clearPause();
  }

  // ------------------------------------------------------------------ seats

  sideOf(playerId: string): FightSide | null {
    return FIGHT_SIDES.find((s) => this.seats[s] === playerId) ?? null;
  }

  private vacate(side: FightSide): void {
    this.seats[side] = null;
    this.picks[side] = null;
    this.broadcast();
  }

  /** Claims a side, or releases whichever one this player holds. */
  takeSeat(playerId: string, side: FightSide | null): void {
    if (this.phase === 'playing') return;
    if (!this.players.has(playerId)) return;

    const held = this.sideOf(playerId);
    if (side && this.seats[side] && this.seats[side] !== playerId) {
      this.emitError(playerId, 'SEAT_TAKEN', 'Someone is already fighting on that side.');
      return;
    }
    if (held === side) return;
    if (held) {
      this.seats[held] = null;
      this.picks[held] = null;
    }
    if (side) this.seats[side] = playerId;
    this.broadcast();
  }

  pick(playerId: string, fighter: string): void {
    if (this.phase === 'playing') return;
    const side = this.sideOf(playerId);
    if (!side) {
      this.emitError(playerId, 'NOT_SEATED', 'Take a side before picking a fighter.');
      return;
    }
    if (!FIGHTER_IDS.includes(fighter as FighterId)) {
      this.emitError(playerId, 'BAD_PICK', 'No fighter by that name.');
      return;
    }
    this.picks[side] = fighter as FighterId;
    this.broadcast();
  }

  updateSettings(patch: Partial<FightSettings>): void {
    if (this.phase === 'playing') return;
    const clampTo = (n: unknown, b: { min: number; max: number }) =>
      typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.max(b.min, Math.min(b.max, n))) : null;
    const rounds = clampTo(patch.roundsToWin, FIGHT_BOUNDS.roundsToWin);
    if (rounds !== null) this.settings.roundsToWin = rounds;
    const secs = clampTo(patch.roundSeconds, FIGHT_BOUNDS.roundSeconds);
    if (secs !== null) this.settings.roundSeconds = secs;
    if (typeof patch.blood === 'boolean') this.settings.blood = patch.blood;
    this.broadcast();
  }

  private ready(): boolean {
    return FIGHT_SIDES.every((s) => this.seats[s] && this.picks[s]);
  }

  // ------------------------------------------------------------------- match

  startGame(byPlayerId: string): void {
    if (byPlayerId !== this.hostId) return;
    if (this.phase === 'playing') return;
    if (!this.ready()) {
      this.emitError(byPlayerId, 'NOT_READY', 'Both fighters need a seat and a pick.');
      return;
    }
    this.match = createMatch(this.settings, { a: this.picks.a!, b: this.picks.b! });
    this.controls = { a: idle(), b: idle() };
    this.winner = null;
    this.reason = null;
    this.clearPause();
    this.phase = 'playing';
    this.broadcast();
    this.startLoop();
  }

  rematch(byPlayerId: string): void {
    if (this.phase !== 'ended') return;
    if (byPlayerId !== this.hostId && !this.sideOf(byPlayerId)) return;
    if (!this.ready()) {
      this.toSelect(this.hostId);
      return;
    }
    this.startGame(this.hostId);
  }

  toSelect(byPlayerId: string): void {
    if (this.phase !== 'ended' || byPlayerId !== this.hostId) return;
    this.phase = 'lobby';
    this.match = null;
    this.broadcast();
  }

  input(playerId: string, seq: number, held: number, pressed: number): void {
    if (this.phase !== 'playing') return;
    const side = this.sideOf(playerId);
    if (!side) return; // spectators have no controller
    const c = this.controls[side];
    // Socket.IO keeps order over a websocket, but not across a fallback
    // transport or a reconnect; a stale update must not overwrite a newer one.
    if (seq <= c.seq) return;
    c.seq = seq;
    c.held = held & BTN_ALL;
    c.pressed |= pressed & BTN_ALL;
  }

  private forfeit(side: FightSide): void {
    if (this.phase !== 'playing') return;
    this.finish(otherSide(side), 'forfeit');
  }

  private finish(winner: FightSide | null, reason: FightEnding): void {
    this.stopLoop();
    this.clearPause();
    this.phase = 'ended';
    this.winner = winner;
    this.reason = reason;
    this.recordWin([winner && this.seats[winner]]);
    this.broadcast();
  }

  // -------------------------------------------------------------------- loop

  /**
   * A fixed-step loop. setTimeout drifts and bunches, so rather than trust
   * each callback to be one tick, time is accumulated and as many ticks run as
   * are due. One frame goes out per wake-up, carrying the latest state.
   */
  private startLoop(): void {
    this.stopLoop();
    this.last = performance.now();
    this.acc = 0;
    const run = () => {
      this.loop = null;
      const m = this.match;
      if (!m || this.phase !== 'playing' || this.destroyed) return;

      const now = performance.now();
      this.acc += now - this.last;
      this.last = now;

      if (this.paused || this.isPaused) {
        this.acc = 0;
      } else {
        const events: FightEvent[] = [];
        let n = 0;
        while (this.acc >= STEP_MS && n < MAX_CATCH_UP) {
          events.push(...this.tick(m));
          this.acc -= STEP_MS;
          n++;
        }
        if (n === MAX_CATCH_UP) this.acc = 0;
        if (n > 0) {
          this.io.to(this.code).volatile.emit('fight:frame', toFrame(m));
          if (events.length) this.io.to(this.code).emit('fight:events', events);
        }
        if (m.phase === 'done') {
          this.finish(m.winner, m.reason);
          return;
        }
      }
      this.loop = setTimeout(run, Math.max(1, STEP_MS - this.acc));
    };
    this.loop = setTimeout(run, STEP_MS);
  }

  private tick(m: Match): FightEvent[] {
    const { a, b } = this.controls;
    const ev = step(m, { held: a.held, pressed: a.pressed }, { held: b.held, pressed: b.pressed });
    a.pressed = 0;
    b.pressed = 0;
    return ev;
  }

  private stopLoop(): void {
    if (this.loop) clearTimeout(this.loop);
    this.loop = null;
  }

  private setPause(p: NonNullable<FightPublic['paused']>, then: () => void): void {
    this.clearPause();
    this.paused = p;
    this.pauseThen = then;
    // The room's own pause holds a fighter's countdown too: nobody forfeits
    // while everything is stopped.
    if (!this.isPaused) this.armPause(p.until - Date.now());
    this.broadcast();
  }

  private armPause(ms: number): void {
    const then = this.pauseThen;
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null;
      then?.();
    }, ms);
  }

  private clearPause(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    this.pauseThen = null;
    this.paused = null;
  }

  // ------------------------------------------------------------------- state

  gamePublic(): FightPublic {
    return {
      phase: this.phase,
      settings: { ...this.settings },
      seats: { ...this.seats },
      picks: { ...this.picks },
      wins: this.match ? { ...this.match.wins } : { a: 0, b: 0 },
      winner: this.winner,
      reason: this.reason,
      paused: this.paused ? { ...this.paused } : null,
    };
  }

  publicState(): RoomState {
    return {
      kind: 'fight',
      ...this.baseState(),
      game: this.gamePublic(),
      frame: this.match ? toFrame(this.match) : null,
    };
  }

  broadcast(): void {
    this.io.to(this.code).emit('fight:state', this.gamePublic());
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
