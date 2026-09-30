import { performance } from 'node:perf_hooks';
import {
  AIM_STEPS, MAZE_DEFAULTS, MAZE_HZ, MAZE_KILL_LIMITS, MAZE_MAX_PLAYERS, MAZE_MIN_PLAYERS, MAZE_MINUTES,
  createWorld, generateMaze, mazeSize, setAway, stepWorld, toMazeFrame,
  type MazeEvent, type MazeInput, type MazePhase, type MazePublic, type MazeSettings, type MazeWorld,
  type RoomState,
} from '@pic-game/shared';
import { BaseRoom, type CorePlayer, type IO } from '../../core/BaseRoom.js';

const STEP_MS = 1000 / MAZE_HZ;
/** Most ticks run in one wake-up to catch up after a stall. */
const MAX_CATCH_UP = 4;
/** Inputs held for a player beyond this are dropped, oldest first: a backlog
 *  would only play their controls back late. */
const MAX_QUEUE = 4;
/** Ticks a player's last controls are repeated when nothing new arrives: a
 *  late packet or two. Past that they stand still and hold fire, so a player
 *  whose tab went to the background does not walk on shooting. */
const HOLD_TICKS = 3;

interface Seat {
  queue: MazeInput[];
  /** The input applied last tick, repeated while the queue is empty, so a
   *  late packet does not stop a player in their tracks. */
  last: MazeInput | null;
  /** The newest seq accepted, to refuse anything older. */
  seen: number;
  /** The seq of the input most recently applied, sent back in each frame. */
  ack: number;
  /** Ticks since the queue last had anything in it. */
  starved: number;
}

/**
 * Maze Wars (see the shared types for the rules).
 *
 * The server runs the shared simulation at a fixed 30 Hz and is the only
 * judge of hits, as in Stick Kombat. Unlike there, each client sends one input
 * a tick rather than on change, and the room applies them one a tick in order.
 * That lets every frame say which input it reflects, so each client can
 * replay its unanswered inputs on top and move its own player without lag.
 */
export class MazeRoom extends BaseRoom<CorePlayer> {
  readonly kind = 'maze' as const;
  settings: MazeSettings = { ...MAZE_DEFAULTS };
  private stage: MazePhase = 'lobby';
  private world: MazeWorld | null = null;
  private seats: Seat[] = [];
  private seed = 0;
  private endsAt = 0;
  private winners: string[] = [];
  private loop: ReturnType<typeof setTimeout> | null = null;
  private last = 0;
  private acc = 0;

  constructor(code: string, io: IO) {
    super(code, io);
  }

  // ------------------------------------------------------- BaseRoom contract

  isLobby(): boolean {
    return this.stage === 'lobby';
  }

  get maxPlayers(): number {
    return 16;
  }

  protected get minPlayers(): number {
    return 1;
  }

  protected createPlayer(base: CorePlayer): CorePlayer {
    return base;
  }

  /** Out of the maze while gone, so nobody farms an empty body; back in,
   *  somewhere safe, on return. */
  protected override onPlayerDisconnected(p: CorePlayer): boolean {
    this.setPresent(p.id, false);
    return false;
  }

  protected override onPlayerReconnected(p: CorePlayer): void {
    this.setPresent(p.id, true);
  }

  protected override onPlayerRemoved(playerId: string): boolean {
    this.setPresent(playerId, false);
    // Nobody left to fight: the match is over.
    const w = this.world;
    if (w && this.stage === 'playing' && w.fighters.filter((f) => !f.away).length < MAZE_MIN_PLAYERS) this.finish();
    this.broadcast();
    return true;
  }

  protected override onDestroy(): void {
    this.stopLoop();
  }

  private seatOf(id: string): number {
    return this.world?.fighters.findIndex((f) => f.id === id) ?? -1;
  }

  private setPresent(id: string, here: boolean): void {
    const w = this.world;
    const seat = this.seatOf(id);
    if (!w || seat < 0 || this.stage !== 'playing') return;
    setAway(w, seat, !here);
    // A fresh start for the controls. A player back from a refresh has a new
    // page counting its inputs from 1, and keeping the old count would throw
    // every one of them away as stale, freezing them in place.
    this.seats[seat] = { queue: [], last: null, seen: -1, ack: -1, starved: 0 };
  }

  // --------------------------------------------------------------- settings

  updateSettings(by: string, patch: Partial<MazeSettings>): void {
    if (by !== this.hostId || this.stage === 'playing') return;
    if ((MAZE_MINUTES as readonly number[]).includes(patch.minutes as number)) this.settings.minutes = patch.minutes!;
    if ((MAZE_KILL_LIMITS as readonly number[]).includes(patch.killLimit as number)) this.settings.killLimit = patch.killLimit!;
    if (patch.radar === 'all' || patch.radar === 'firing') this.settings.radar = patch.radar;
    if (typeof patch.powerups === 'boolean') this.settings.powerups = patch.powerups;
    this.broadcast();
  }

  // ------------------------------------------------------------------ match

  startGame(by: string): void {
    if (by !== this.hostId || this.stage === 'playing') return;
    const here = this.order.filter((id) => this.players.get(id)?.connected).slice(0, MAZE_MAX_PLAYERS);
    if (here.length < MAZE_MIN_PLAYERS) {
      this.emitError(by, 'NOT_READY', `Maze Wars needs at least ${MAZE_MIN_PLAYERS} players.`);
      return;
    }
    const { cols, rows } = mazeSize(here.length);
    this.seed = Math.floor(Math.random() * 2 ** 31);
    this.world = createWorld(generateMaze(this.seed, cols, rows), here, Math.random, this.settings.powerups);
    this.seats = here.map(() => ({ queue: [], last: null, seen: -1, ack: -1, starved: 0 }));
    this.winners = [];
    this.endsAt = Date.now() + this.settings.minutes * 60_000;
    this.stage = 'playing';
    this.broadcast();
    this.systemMessage(
      this.settings.killLimit
        ? `Fight! First to ${this.settings.killLimit} kills, or the most in ${this.settings.minutes} minutes.`
        : `Fight! Most kills in ${this.settings.minutes} minutes.`,
    );
    this.startLoop();
  }

  /** One tick of controls. Shape is checked here; the sim trusts it. */
  input(id: string, raw: MazeInput): void {
    const seat = this.seatOf(id);
    const s = this.seats[seat];
    if (!s || this.stage !== 'playing') return;
    if (raw.seq <= s.seen) return;
    s.seen = raw.seq;
    s.queue.push({
      seq: raw.seq,
      keys: raw.keys & 15,
      aim: ((raw.aim % AIM_STEPS) + AIM_STEPS) % AIM_STEPS,
      fire: raw.fire === true,
    });
    if (s.queue.length > MAX_QUEUE) s.queue.splice(0, s.queue.length - MAX_QUEUE);
  }

  private startLoop(): void {
    this.stopLoop();
    this.last = performance.now();
    this.acc = 0;
    const run = () => {
      this.loop = null;
      const w = this.world;
      if (!w || this.stage !== 'playing' || this.destroyed) return;
      const now = performance.now();
      this.acc += now - this.last;
      this.last = now;
      const events: MazeEvent[] = [];
      let n = 0;
      while (this.acc >= STEP_MS && n < MAX_CATCH_UP) {
        events.push(...this.tick(w));
        this.acc -= STEP_MS;
        n++;
      }
      if (n === MAX_CATCH_UP) this.acc = 0;
      if (n > 0) {
        this.io.to(this.code).volatile.emit('maze:frame', toMazeFrame(w, this.seats.map((s) => s.ack)));
        if (events.length) this.io.to(this.code).emit('maze:events', events);
        if (events.some((e) => e.k === 'kill')) this.afterKills();
      }
      if (this.stage !== 'playing') return;
      if (Date.now() >= this.endsAt) return this.finish();
      this.loop = setTimeout(run, Math.max(1, STEP_MS - this.acc));
    };
    this.loop = setTimeout(run, STEP_MS);
  }

  private tick(w: MazeWorld): MazeEvent[] {
    const inputs = this.seats.map((s) => {
      const next = s.queue.shift();
      if (next) {
        s.last = next;
        s.ack = next.seq;
        s.starved = 0;
      } else if (s.last && ++s.starved > HOLD_TICKS) {
        s.last = { ...s.last, keys: 0, fire: false };
      }
      return s.last;
    });
    return stepWorld(w, inputs);
  }

  /** Scores changed: tell everyone, and stop at the kill limit. */
  private afterKills(): void {
    const w = this.world!;
    const limit = this.settings.killLimit;
    if (limit && w.fighters.some((f) => f.kills >= limit)) return this.finish();
    this.broadcast();
  }

  private finish(): void {
    this.stopLoop();
    const w = this.world;
    this.stage = 'ended';
    if (w) {
      const best = Math.max(...w.fighters.map((f) => f.kills));
      this.winners = best > 0 ? w.fighters.filter((f) => f.kills === best).map((f) => f.id) : [];
      for (const id of this.winners) {
        const p = this.players.get(id);
        if (!p) continue;
        p.score += 1;
        this.io.to(this.code).emit('player:updated', this.publicPlayer(p));
      }
      const names = this.winners.map((id) => this.players.get(id)?.name ?? 'Someone');
      this.systemMessage(names.length ? `${names.join(' and ')} wins with ${best} kills!` : 'Time! Nobody scored.');
    }
    this.broadcast();
  }

  private stopLoop(): void {
    if (this.loop) clearTimeout(this.loop);
    this.loop = null;
  }

  rematch(by: string): void {
    if (by !== this.hostId || this.stage !== 'ended') return;
    this.startGame(by);
  }

  toLobby(by: string): void {
    if (by !== this.hostId || this.stage !== 'ended') return;
    this.stage = 'lobby';
    this.world = null;
    this.broadcast();
  }

  // ----------------------------------------------------------------- state

  gamePublic(): MazePublic {
    const w = this.world;
    const scores: MazePublic['scores'] = {};
    for (const f of w?.fighters ?? []) scores[f.id] = { kills: f.kills, deaths: f.deaths };
    return {
      phase: this.stage,
      settings: { ...this.settings },
      players: w ? w.fighters.map((f) => f.id) : [],
      seed: this.seed,
      cols: w?.map.cols ?? 0,
      rows: w?.map.rows ?? 0,
      scores,
      endsAt: this.endsAt,
      winners: [...this.winners],
    };
  }

  publicState(): RoomState {
    return {
      kind: 'maze',
      code: this.code,
      players: this.publicPlayers(),
      hostId: this.hostId,
      serverTime: Date.now(),
      game: this.gamePublic(),
    };
  }

  broadcast(): void {
    this.io.to(this.code).emit('maze:state', this.gamePublic());
  }

  handleChat(playerId: string, raw: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const text = raw.slice(0, 200).trim();
    if (!text) return;
    this.broadcastChat({ kind: 'chat', playerId, name: player.name, text });
  }
}
