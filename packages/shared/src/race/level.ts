import { T, TILE } from './types.js';

export interface Pt {
  x: number;
  y: number;
}

/** A spinning blade, swinging smoothly between two points (or sitting still). */
export interface Saw {
  a: Pt;
  b: Pt;
  /** Radius in pixels. */
  r: number;
  period: number;
  offset: number;
}

export type Dir4 = 'up' | 'down' | 'left' | 'right';

export interface Laser {
  /** Where the beam leaves the emitter. */
  x: number;
  y: number;
  dir: Dir4;
  /** How far it reaches before hitting something solid. */
  len: number;
  on: number;
  off: number;
  offset: number;
}

export interface Cannon {
  /** The muzzle. */
  x: number;
  y: number;
  dir: 1 | -1;
  period: number;
  offset: number;
  /** Pixels per millisecond. */
  speed: number;
  /** How far a shot flies before it hits a wall. */
  range: number;
}

/**
 * The route through a level, which the grinder follows. Each point starts a
 * leg; `pace` scales the grinder's speed along it, so it can ease off down a
 * pipe that has to be taken slowly.
 */
export interface PathPt extends Pt {
  pace: number;
}

export interface Level {
  id: string;
  name: string;
  /** In tiles. */
  w: number;
  h: number;
  tiles: Uint8Array;
  /** Where a runner's top-left sits at the start. */
  spawn: Pt;
  /** Respawn points, in route order; each triggers on a column band. */
  checkpoints: { x: number; y: number; zone: Rect }[];
  finish: Rect;
  saws: Saw[];
  lasers: Laser[];
  cannons: Cannon[];
  /** How long before the chasing wall sets off. */
  chaserDelay: number;
  /** In pixels, start to finish. */
  path: PathPt[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Runner size, in pixels. Lives here because spawn points depend on it. */
export const RW = 20;
export const RH = 26;

export const tileAt = (lv: Level, tx: number, ty: number): number =>
  tx < 0 || ty < 0 || tx >= lv.w || ty >= lv.h ? T.AIR : lv.tiles[ty * lv.w + tx]!;

/**
 * Builds a level in tile coordinates, with rows counted from the top. Every
 * hazard's reach (a laser's length, a cannon's range) is worked out once
 * here, so the per-frame checks never have to walk the grid.
 *
 * `offset` shifts everything after it, so a section can be written in its
 * own coordinates and then placed wherever the level needs it.
 */
export class LevelBuilder {
  private tiles: Uint8Array;
  private ox = 0;
  private oy = 0;
  private spawnAt: Pt = { x: 2, y: 2 };
  private cps: Pt[] = [];
  private fin: Pt = { x: 0, y: 0 };
  private saws: Saw[] = [];
  private lasers: Omit<Laser, 'len'>[] = [];
  private cannons: Omit<Cannon, 'range'>[] = [];
  private route: PathPt[] = [];

  constructor(readonly w: number, readonly h: number) {
    this.tiles = new Uint8Array(w * h);
  }

  offset(dx: number, dy: number): this {
    this.ox = dx;
    this.oy = dy;
    return this;
  }

  private set(x: number, y: number, t: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.tiles[y * this.w + x] = t;
  }

  private fill(x: number, y: number, w: number, h: number, t: number): this {
    const x0 = x + this.ox;
    const y0 = y + this.oy;
    for (let j = y0; j < y0 + h; j++) for (let i = x0; i < x0 + w; i++) this.set(i, j, t);
    return this;
  }

  solid(x: number, y: number, w = 1, h = 1): this {
    return this.fill(x, y, w, h, T.SOLID);
  }

  /** Ground from row `top` all the way to the bottom of the level. */
  floor(x: number, w: number, top: number): this {
    return this.fill(x, top, w, this.h - (top + this.oy), T.SOLID);
  }

  clear(x: number, y: number, w = 1, h = 1): this {
    return this.fill(x, y, w, h, T.AIR);
  }

  /** A row of floor or ceiling spikes, or a column of wall spikes. For walls,
   *  `n` runs downward, and the kind is the way the points face. */
  spikes(x: number, y: number, n = 1, kind: 'up' | 'down' | 'left' | 'right' = 'up'): this {
    const t = { up: T.SPIKE_UP, down: T.SPIKE_DOWN, left: T.SPIKE_LEFT, right: T.SPIKE_RIGHT }[kind];
    const wall = kind === 'left' || kind === 'right';
    return wall ? this.fill(x, y, 1, n, t) : this.fill(x, y, n, 1, t);
  }

  crumble(x: number, y: number, w = 1): this {
    return this.fill(x, y, w, 1, T.CRUMBLE);
  }

  /** A saw centred on a tile position (fractions allowed). */
  saw(x: number, y: number, o: { to?: [number, number]; r?: number; period?: number; offset?: number } = {}): this {
    const a = { x: (x + this.ox) * TILE, y: (y + this.oy) * TILE };
    const b = o.to ? { x: (o.to[0] + this.ox) * TILE, y: (o.to[1] + this.oy) * TILE } : a;
    this.saws.push({ a, b, r: (o.r ?? 0.7) * TILE, period: o.period ?? 2000, offset: o.offset ?? 0 });
    return this;
  }

  /** A laser whose emitter is a solid block at (x, y), firing one way. */
  laser(x: number, y: number, dir: Dir4, o: { on?: number; off?: number; offset?: number } = {}): this {
    this.solid(x, y);
    const cx = (x + this.ox + 0.5) * TILE;
    const cy = (y + this.oy + 0.5) * TILE;
    const half = TILE / 2;
    const start = {
      up: { x: cx, y: cy - half }, down: { x: cx, y: cy + half },
      left: { x: cx - half, y: cy }, right: { x: cx + half, y: cy },
    }[dir];
    this.lasers.push({ ...start, dir, on: o.on ?? 1000, off: o.off ?? 1400, offset: o.offset ?? 0 });
    return this;
  }

  cannon(x: number, y: number, dir: 1 | -1, o: { period?: number; offset?: number; speed?: number } = {}): this {
    this.solid(x, y);
    this.cannons.push({
      x: (x + this.ox + 0.5 + dir * 0.5) * TILE,
      y: (y + this.oy + 0.5) * TILE,
      dir,
      period: o.period ?? 1500,
      offset: o.offset ?? 0,
      speed: o.speed ?? 0.32,
    });
    return this;
  }

  spawn(x: number, y: number): this {
    this.spawnAt = { x: x + this.ox, y: y + this.oy };
    return this;
  }

  checkpoint(x: number, y: number): this {
    this.cps.push({ x: x + this.ox, y: y + this.oy });
    return this;
  }

  finish(x: number, y: number): this {
    this.fin = { x: x + this.ox, y: y + this.oy };
    return this;
  }

  /** The grinder's route, in tile coordinates. Each point is the start of a
   *  leg; give it a pace below 1 to slow the grinder down along that leg. */
  path(...pts: [x: number, y: number, pace?: number][]): this {
    for (const [x, y, pace] of pts) {
      this.route.push({ x: (x + this.ox + 0.5) * TILE, y: (y + this.oy + 0.5) * TILE, pace: pace ?? 1 });
    }
    return this;
  }

  build(id: string, name: string, chaserDelay = 5000): Level {
    const lv: Level = {
      id, name, w: this.w, h: this.h, tiles: this.tiles,
      spawn: standOn(this.spawnAt),
      // Kept in the order they were placed, which is the order along the route.
      checkpoints: this.cps.map((c) => ({
        ...standOn(c), zone: { x: c.x * TILE, y: (c.y - 3) * TILE, w: TILE, h: 4 * TILE },
      })),
      finish: { x: this.fin.x * TILE, y: (this.fin.y - 3) * TILE, w: 2 * TILE, h: 4 * TILE },
      saws: this.saws,
      lasers: [],
      cannons: [],
      chaserDelay,
      path: this.route.length >= 2 ? this.route : [
        { ...centre(this.spawnAt), pace: 1 },
        { ...centre(this.fin), pace: 1 },
      ],
    };
    lv.lasers = this.lasers.map((l) => ({ ...l, len: reach(lv, l.x, l.y, l.dir) }));
    lv.cannons = this.cannons.map((c) => ({ ...c, range: reach(lv, c.x, c.y, c.dir === 1 ? 'right' : 'left') }));
    return lv;
  }
}

const centre = (p: Pt): Pt => ({ x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE });

/** Top-left of a runner standing in tile (x, y), on whatever is below it. */
function standOn(p: Pt): Pt {
  return { x: p.x * TILE + (TILE - RW) / 2, y: (p.y + 1) * TILE - RH };
}

const isSolid = (t: number) => t === T.SOLID || t === T.CRUMBLE;

/** Distance from a point to the first solid tile in a direction. */
function reach(lv: Level, x: number, y: number, dir: Dir4): number {
  const step = 4;
  const dx = dir === 'left' ? -step : dir === 'right' ? step : 0;
  const dy = dir === 'up' ? -step : dir === 'down' ? step : 0;
  let d = 0;
  let px = x + dx / 2;
  let py = y + dy / 2;
  const limit = Math.max(lv.w, lv.h) * TILE;
  while (d < limit) {
    const t = tileAt(lv, Math.floor(px / TILE), Math.floor(py / TILE));
    if (isSolid(t)) break;
    if (px < 0 || py < 0 || px > lv.w * TILE || py > lv.h * TILE) break;
    px += dx;
    py += dy;
    d += step;
  }
  return d;
}
