import { RH, RW, tileAt, type Cannon, type Laser, type Level, type Pt, type Rect, type Saw } from './level.js';
import { CHASER_SPEED, T, TILE, type ChaserPace, type DeathCause } from './types.js';

/**
 * Every hazard is a function of the level clock and nothing else: `t` is
 * milliseconds since GO, read from the server's clock. So every client draws
 * the same saw in the same place, and nothing about hazards ever needs to
 * travel over the network.
 */

export function sawAt(s: Saw, t: number): Pt {
  if (s.a.x === s.b.x && s.a.y === s.b.y) return s.a;
  // Eased ping-pong: it lingers at each end, which is what makes it readable.
  const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * (t + s.offset)) / s.period);
  return { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Warning flicker before a beam fires, in ms. Harmless, but it tells you. */
export const LASER_WARN = 450;

export function laserPhase(l: Laser, t: number): 'on' | 'warn' | 'off' {
  const c = mod(t + l.offset, l.on + l.off);
  if (c < l.on) return 'on';
  return c >= l.on + l.off - LASER_WARN ? 'warn' : 'off';
}

/** The beam as a rectangle, six pixels thick. */
export function laserRect(l: Laser): Rect {
  const th = 6;
  switch (l.dir) {
    case 'down': return { x: l.x - th / 2, y: l.y, w: th, h: l.len };
    case 'up': return { x: l.x - th / 2, y: l.y - l.len, w: th, h: l.len };
    case 'right': return { x: l.x, y: l.y - th / 2, w: l.len, h: th };
    case 'left': return { x: l.x - l.len, y: l.y - th / 2, w: l.len, h: th };
  }
}

export const SHOT_R = 7;

/** Shots in flight at time t. A cannon fires every period from its offset;
 *  each shot flies straight until the wall its range was measured to. */
export function shotsAt(c: Cannon, t: number): Pt[] {
  if (t < c.offset) return [];
  const flight = c.range / c.speed;
  const out: Pt[] = [];
  const last = Math.floor((t - c.offset) / c.period);
  for (let k = last; k >= 0; k--) {
    const age = t - (c.offset + k * c.period);
    if (age > flight) break;
    out.push({ x: c.x + c.dir * age * c.speed, y: c.y });
  }
  return out;
}

/** The chasing wall's leading edge, in pixels. Starts off the left edge. */
export function chaserX(lv: Level, pace: ChaserPace, t: number): number {
  const speed = CHASER_SPEED[pace];
  if (!speed) return -Infinity;
  return -2 * TILE + Math.max(0, t - lv.chaserDelay) * (speed / 1000);
}

/** When the wall passes the finish line and the level is over for everyone. */
export function chaserDoneAt(lv: Level, pace: ChaserPace): number {
  const speed = CHASER_SPEED[pace];
  if (!speed) return Infinity;
  return lv.chaserDelay + ((lv.finish.x + lv.finish.w + 2 * TILE) / speed) * 1000;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function circleHits(c: Pt, r: number, box: Rect): boolean {
  const nx = Math.max(box.x, Math.min(c.x, box.x + box.w));
  const ny = Math.max(box.y, Math.min(c.y, box.y + box.h));
  return (c.x - nx) ** 2 + (c.y - ny) ** 2 < r * r;
}

/** The part of a spike tile that actually hurts: the points, not the base. */
function spikeRect(kind: number, tx: number, ty: number): Rect | null {
  const x = tx * TILE;
  const y = ty * TILE;
  const d = TILE * 0.45;
  switch (kind) {
    case T.SPIKE_UP: return { x: x + 3, y: y + TILE - d, w: TILE - 6, h: d };
    case T.SPIKE_DOWN: return { x: x + 3, y, w: TILE - 6, h: d };
    case T.SPIKE_LEFT: return { x: x + TILE - d, y: y + 3, w: d, h: TILE - 6 };
    case T.SPIKE_RIGHT: return { x, y: y + 3, w: d, h: TILE - 6 };
  }
  return null;
}

/**
 * What, if anything, is killing a runner whose top-left is at (x, y). The box
 * is shrunk a little: dying to a pixel of overlap feels like cheating.
 */
export function hazardAt(lv: Level, x: number, y: number, t: number): DeathCause | null {
  if (y > lv.h * TILE) return 'pit';
  const box: Rect = { x: x + 3, y: y + 3, w: RW - 6, h: RH - 5 };

  const x0 = Math.floor(box.x / TILE);
  const x1 = Math.floor((box.x + box.w) / TILE);
  const y0 = Math.floor(box.y / TILE);
  const y1 = Math.floor((box.y + box.h) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const s = spikeRect(tileAt(lv, tx, ty), tx, ty);
      if (s && overlaps(s, box)) return 'spikes';
    }
  }
  for (const s of lv.saws) if (circleHits(sawAt(s, t), s.r - 2, box)) return 'saw';
  for (const l of lv.lasers) if (laserPhase(l, t) === 'on' && overlaps(laserRect(l), box)) return 'laser';
  for (const c of lv.cannons) for (const p of shotsAt(c, t)) if (circleHits(p, SHOT_R, box)) return 'cannon';
  return null;
}

/** The furthest checkpoint whose zone the runner is inside, or -1. */
export function checkpointAt(lv: Level, x: number, y: number): number {
  const box = { x, y, w: RW, h: RH };
  for (let i = lv.checkpoints.length - 1; i >= 0; i--) if (overlaps(lv.checkpoints[i]!.zone, box)) return i;
  return -1;
}

export function atFinish(lv: Level, x: number, y: number): boolean {
  return overlaps(lv.finish, { x, y, w: RW, h: RH });
}
