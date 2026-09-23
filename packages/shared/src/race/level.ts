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

export interface Level {
  id: string;
  name: string;
  /** In tiles. */
  w: number;
  h: number;
  tiles: Uint8Array;
  /** Where a runner's top-left sits at the start. */
  spawn: Pt;
  /** Respawn points, left to right; each triggers on a column band. */
  checkpoints: { x: number; y: number; zone: Rect }[];
  finish: Rect;
  saws: Saw[];
  lasers: Laser[];
  cannons: Cannon[];
  /** How long before the chasing wall sets off. */
  chaserDelay: number;
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
 */
export class LevelBuilder {
  private tiles: Uint8Array;
  private spawnAt: Pt = { x: 2, y: 2 };
  private cps: Pt[] = [];
  private fin: Pt = { x: 0, y: 0 };
  private saws: Saw[] = [];
  private lasers: Omit<Laser, 'len'>[] = [];
  private cannons: Omit<Cannon, 'range'>[] = [];

  constructor(readonly w: number, readonly h: number) {
    this.tiles = new Uint8Array(w * h);
  }

  private set(x: number, y: number, t: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.tiles[y * this.w + x] = t;
  }

  solid(x: number, y: number, w = 1, h = 1): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, T.SOLID);
    return this;
  }

  /** Ground from row `top` all the way to the bottom. */
  floor(x: number, w: number, top: number): this {
    return this.solid(x, top, w, this.h - top);
  }

  clear(x: number, y: number, w = 1, h = 1): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, T.AIR);
    return this;
  }

  spikes(x: number, y: number, w = 1, kind: 'up' | 'down' | 'left' | 'right' = 'up'): this {
    const t = { up: T.SPIKE_UP, down: T.SPIKE_DOWN, left: T.SPIKE_LEFT, right: T.SPIKE_RIGHT }[kind];
    for (let i = x; i < x + w; i++) this.set(kind === 'left' || kind === 'right' ? x : i, kind === 'left' || kind === 'right' ? y + (i - x) : y, t);
    return this;
  }

  crumble(x: number, y: number, w = 1): this {
    for (let i = x; i < x + w; i++) this.set(i, y, T.CRUMBLE);
    return this;
  }

  /** A saw centred on a tile position (fractions allowed). */
  saw(x: number, y: number, o: { to?: [number, number]; r?: number; period?: number; offset?: number } = {}): this {
    const a = { x: x * TILE, y: y * TILE };
    const b = o.to ? { x: o.to[0] * TILE, y: o.to[1] * TILE } : a;
    this.saws.push({ a, b, r: (o.r ?? 0.7) * TILE, period: o.period ?? 2000, offset: o.offset ?? 0 });
    return this;
  }

  /** A laser whose emitter is a solid block at (x, y), firing one way. */
  laser(x: number, y: number, dir: Dir4, o: { on?: number; off?: number; offset?: number } = {}): this {
    this.set(x, y, T.SOLID);
    const cx = (x + 0.5) * TILE;
    const cy = (y + 0.5) * TILE;
    const half = TILE / 2;
    const start = {
      up: { x: cx, y: cy - half }, down: { x: cx, y: cy + half },
      left: { x: cx - half, y: cy }, right: { x: cx + half, y: cy },
    }[dir];
    this.lasers.push({ ...start, dir, on: o.on ?? 1000, off: o.off ?? 1400, offset: o.offset ?? 0 });
    return this;
  }

  cannon(x: number, y: number, dir: 1 | -1, o: { period?: number; offset?: number; speed?: number } = {}): this {
    this.set(x, y, T.SOLID);
    this.cannons.push({
      x: (x + 0.5 + dir * 0.5) * TILE,
      y: (y + 0.5) * TILE,
      dir,
      period: o.period ?? 1500,
      offset: o.offset ?? 0,
      speed: o.speed ?? 0.32,
    });
    return this;
  }

  spawn(x: number, y: number): this {
    this.spawnAt = { x, y };
    return this;
  }

  checkpoint(x: number, y: number): this {
    this.cps.push({ x, y });
    return this;
  }

  finish(x: number, y: number): this {
    this.fin = { x, y };
    return this;
  }

  build(id: string, name: string, chaserDelay = 5000): Level {
    const lv: Level = {
      id, name, w: this.w, h: this.h, tiles: this.tiles,
      spawn: standOn(this.spawnAt),
      checkpoints: this.cps
        .sort((p, q) => p.x - q.x)
        .map((c) => ({ ...standOn(c), zone: { x: c.x * TILE, y: (c.y - 3) * TILE, w: TILE, h: 4 * TILE } })),
      finish: { x: this.fin.x * TILE, y: (this.fin.y - 3) * TILE, w: 2 * TILE, h: 4 * TILE },
      saws: this.saws,
      lasers: [],
      cannons: [],
      chaserDelay,
    };
    lv.lasers = this.lasers.map((l) => ({ ...l, len: reach(lv, l.x, l.y, l.dir) }));
    lv.cannons = this.cannons.map((c) => ({ ...c, range: reach(lv, c.x, c.y, c.dir === 1 ? 'right' : 'left') }));
    return lv;
  }
}

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
