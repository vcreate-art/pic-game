import {
  GAME_CAPACITY, CHASER_PACES, GF, LEVELS, PHYS, RACE_DEFAULTS, TILE, chaserDoneAt, pointsFor,
  type ChaserPace, type DeathCause, type Ghost, type Level, type LevelResult,
  type RaceEvent, type RacePhase, type RacePublic, type RaceSettings, type RoomState,
} from '@pic-game/shared';
import { BaseRoom, type CorePlayer, type IO, type RoomLifecycle } from '../../core/BaseRoom.js';
import { topScorers } from '../../core/RoomSession.js';

const COUNTDOWN_MS = 3500;
const RESULTS_MS = 7000;
const GHOST_HZ = 15;
/** With the chaser off, something still has to end a level. */
const NO_CHASER_LIMIT_MS = 180_000;
/** Faster than any runner can go, in px/ms, so a legitimate move is never refused. */
const MAX_SPEED = (PHYS.MAX_FALL * 60 * 1.25) / 1000;

interface Seen {
  g: Ghost;
  at: number;
  seq: number;
  /** Furthest checkpoint claimed; a respawn may teleport there. */
  cp: number;
}

/**
 * Meat Race: everyone runs the same level at once, as ghosts to each other.
 *
 * Unlike the fighter, the server does not run the game. Racers never touch,
 * so each client moves its own runner locally with no lag on its own jumps,
 * and hazards are functions of a shared clock that every client computes for
 * itself. The server's job is the clock, the relay, the scoreboard and a
 * sanity check on claims: a runner cannot move faster than physics allows,
 * and cannot finish from somewhere that is not the finish.
 */
export class RaceRoom extends BaseRoom<CorePlayer> {
  readonly kind = 'race' as const;
  settings: RaceSettings = { ...RACE_DEFAULTS };
  phase: RacePhase = 'lobby';
  private level = 0;
  private leg = 0;
  private startAt = 0;
  private nextAt = 0;
  private racers: string[] = [];
  private results: Record<string, LevelResult> = {};
  private points: Record<string, number> = {};
  private seen = new Map<string, Seen>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loop: ReturnType<typeof setInterval> | null = null;

  constructor(code: string, io: IO) {
    super(code, io);
  }

  // ------------------------------------------------------- BaseRoom contract

  isLobby(): boolean {
    return this.phase === 'lobby';
  }

  lifecycle(): RoomLifecycle {
    return this.isLobby() ? 'lobby' : this.phase === 'podium' ? 'ended' : 'playing';
  }

  get maxPlayers(): number {
    return GAME_CAPACITY.race;
  }

  /** A solo run is still a race against the clock and the wall. */
  protected get minPlayers(): number {
    return 1;
  }

  protected createPlayer(base: CorePlayer): CorePlayer {
    return base;
  }

  protected override onPlayerDisconnected(): boolean {
    // Their runner simply stops. The level ends without them if everyone
    // else is done; a quick reconnect picks up where they were.
    this.checkAllDone();
    return false;
  }

  /** A reload starts the client's update count again from zero. */
  protected override onPlayerReconnected(p: CorePlayer): void {
    const s = this.seen.get(p.id);
    if (s) s.seq = -1;
  }

  protected override onPlayerRemoved(playerId: string): boolean {
    this.racers = this.racers.filter((id) => id !== playerId);
    delete this.points[playerId];
    this.seen.delete(playerId);
    this.checkAllDone();
    this.broadcast();
    return true;
  }

  protected override onDestroy(): void {
    this.clearTimers();
  }

  private get lv(): Level {
    return LEVELS[this.level]!;
  }

  // ---------------------------------------------------------------- lobby

  updateSettings(patch: Partial<RaceSettings>): void {
    if (this.phase !== 'lobby' && this.phase !== 'podium') return;
    const n = Number(patch.levels);
    if (Number.isFinite(n)) this.settings.levels = Math.max(1, Math.min(LEVELS.length, Math.round(n)));
    if (patch.chaser && CHASER_PACES.includes(patch.chaser as ChaserPace)) this.settings.chaser = patch.chaser;
    this.broadcast();
  }

  startGame(byPlayerId: string): void {
    if (byPlayerId !== this.hostId) return;
    if (this.phase !== 'lobby' && this.phase !== 'podium') return;
    this.points = {};
    for (const id of this.players.keys()) this.points[id] = 0;
    this.beginLevel(0);
  }

  again(byPlayerId: string): void {
    if (byPlayerId !== this.hostId || this.phase !== 'podium') return;
    this.phase = 'lobby';
    this.broadcast();
  }

  // ---------------------------------------------------------------- levels

  private beginLevel(index: number): void {
    this.clearTimers();
    this.level = index;
    this.leg = index + 1;
    this.racers = this.connectedPlayers().map((p) => p.id);
    this.results = {};
    for (const id of this.racers) {
      this.results[id] = { time: null, place: null, points: 0, deaths: 0, caught: false };
      this.points[id] ??= 0;
    }
    this.seen.clear();
    this.phase = 'countdown';
    this.startAt = Date.now() + COUNTDOWN_MS;
    this.nextAt = this.startAt;
    this.broadcast();
    this.timer = setTimeout(() => this.go(), COUNTDOWN_MS);
  }

  private go(): void {
    this.phase = 'racing';
    const limit = Math.min(chaserDoneAt(this.lv, this.settings.chaser) + 800, NO_CHASER_LIMIT_MS);
    this.nextAt = this.startAt + limit;
    this.broadcast();
    this.loop = setInterval(() => this.tick(), 1000 / GHOST_HZ);
    this.timer = setTimeout(() => this.endLevel(), this.nextAt - Date.now());
  }

  private tick(): void {
    if (this.seen.size === 0) return;
    const out: Record<string, Ghost> = {};
    for (const [id, s] of this.seen) out[id] = s.g;
    this.io.to(this.code).volatile.emit('race:ghosts', out);
  }

  private done(id: string): boolean {
    const r = this.results[id];
    return !r || r.time !== null || r.caught || !this.players.get(id)?.connected;
  }

  private checkAllDone(): void {
    if (this.phase === 'racing' && this.racers.every((id) => this.done(id))) this.endLevel();
  }

  private endLevel(): void {
    if (this.phase !== 'racing') return;
    this.clearTimers();
    for (const id of this.racers) {
      const r = this.results[id];
      if (!r) continue;
      r.points = pointsFor(r.place);
      this.points[id] = (this.points[id] ?? 0) + r.points;
    }
    const last = this.leg >= Math.min(this.settings.levels, LEVELS.length);
    this.phase = 'results';
    this.nextAt = Date.now() + RESULTS_MS;
    this.broadcast();
    this.timer = setTimeout(() => {
      if (last) {
        this.phase = 'podium';
        this.nextAt = 0;
        this.recordWin(topScorers(this.points));
        this.broadcast();
      } else {
        this.beginLevel(this.level + 1);
      }
    }, RESULTS_MS);
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.loop) clearInterval(this.loop);
    this.timer = null;
    this.loop = null;
  }

  // ---------------------------------------------------------- runner claims

  private racing(id: string): boolean {
    return this.phase === 'racing' && this.racers.includes(id) && !this.done(id);
  }

  private events(evs: RaceEvent[]): void {
    this.io.to(this.code).emit('race:events', evs);
  }

  position(id: string, seq: number, g: Ghost): void {
    if (!this.racing(id)) return;
    const [x, y, vx, vy, flags] = g;
    const now = Date.now();
    const prev = this.seen.get(id);
    if (prev && seq <= prev.seq) return;

    if (prev) {
      const dt = now - prev.at;
      const moved = Math.hypot(x - prev.g[0], y - prev.g[1]);
      // A respawn jumps straight to a checkpoint (or the start); anything else
      // must be a distance the runner could have covered.
      const spawns = [this.lv.spawn, ...this.lv.checkpoints.slice(0, prev.cp + 1)];
      const respawn = spawns.some((p) => Math.hypot(p.x - x, p.y - y) < TILE);
      if (!respawn && moved > MAX_SPEED * dt + 2 * TILE) return;
    } else if (Math.hypot(x - this.lv.spawn.x, y - this.lv.spawn.y) > 3 * TILE) {
      return; // everyone starts at the start
    }
    this.seen.set(id, {
      g: [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(vx * 10) / 10, Math.round(vy * 10) / 10, flags & 0xff],
      at: now,
      seq,
      cp: prev?.cp ?? -1,
    });
  }

  checkpoint(id: string, n: number): void {
    const s = this.seen.get(id);
    const c = this.lv.checkpoints[n];
    if (!this.racing(id) || !s || !c) return;
    if (n <= s.cp) return;
    if (Math.hypot(s.g[0] - c.x, s.g[1] - c.y) > 4 * TILE) return;
    s.cp = n;
    this.events([{ t: 'checkpoint', id, n }]);
  }

  died(id: string, cause: DeathCause): void {
    const r = this.results[id];
    if (!this.racing(id) || !r) return;
    r.deaths++;
    this.events([{ t: 'died', id, cause }]);
  }

  caught(id: string): void {
    const r = this.results[id];
    if (!this.racing(id) || !r) return;
    r.caught = true;
    const s = this.seen.get(id);
    if (s) s.g = [s.g[0], s.g[1], 0, 0, s.g[4] | GF.DEAD | GF.DONE];
    this.events([{ t: 'caught', id }]);
    this.broadcast();
    this.checkAllDone();
  }

  finish(id: string): void {
    const r = this.results[id];
    const s = this.seen.get(id);
    if (!this.racing(id) || !r || !s) return;
    const f = this.lv.finish;
    const [x, y] = s.g;
    const near = x > f.x - 2 * TILE && x < f.x + f.w + 2 * TILE && y > f.y - 2 * TILE && y < f.y + f.h + 2 * TILE;
    const time = Date.now() - this.startAt;
    // Nobody crosses the level faster than dashing flat out in a straight line.
    const fastest = ((f.x - this.lv.spawn.x) / (PHYS.DASH_SPEED * 60)) * 1000;
    if (!near || time < fastest) return;

    r.time = time;
    r.place = Object.values(this.results).filter((q) => q.time !== null).length;
    s.g = [s.g[0], s.g[1], 0, 0, s.g[4] | GF.DONE];
    this.events([{ t: 'finish', id, place: r.place, time }]);
    this.broadcast();
    this.checkAllDone();
  }

  // ----------------------------------------------------------------- state

  gamePublic(): RacePublic {
    return {
      phase: this.phase,
      settings: { ...this.settings },
      level: this.level,
      leg: this.leg,
      startAt: this.startAt,
      nextAt: this.nextAt,
      racers: [...this.racers],
      results: structuredClone(this.results),
      points: { ...this.points },
    };
  }

  publicState(): RoomState {
    return {
      kind: 'race',
      ...this.baseState(),
      game: this.gamePublic(),
    };
  }

  broadcast(): void {
    this.io.to(this.code).emit('race:state', this.gamePublic());
  }

  handleChat(playerId: string, raw: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const text = raw.slice(0, 100).trim();
    if (!text) return;
    this.broadcastChat({ kind: 'chat', playerId, name: player.name, text });
  }
}
