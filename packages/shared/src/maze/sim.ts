import { cellCentre, mazeSolidAt, type MazeMap } from './map.js';
import {
  BULLET_DAMAGE, BULLET_LIFE, BULLET_SPEED, FIRE_EVERY, MAX_HP, MAZE_DT, MV, PF, PLAYER_R,
  PLAYER_SPEED, PROTECT_TICKS, RADAR_TICKS, REGEN_AFTER, REGEN_PER_TICK, RESPAWN_TICKS,
  fromAim, type MazeEvent, type MazeFrame, type MazeInput,
} from './types.js';

type Rng = () => number;

// ----------------------------------------------------------------- movement

/**
 * Moves a body by (dx, dy), stopping at walls. Each axis is moved and settled
 * on its own, so running into a wall at an angle slides along it. The body is
 * treated as a square of half-size PLAYER_R against the walls: corridors are
 * three tiles wide, so the corners it cuts off never matter.
 */
export function moveBody(m: MazeMap, pos: { x: number; y: number }, dx: number, dy: number): void {
  const r = PLAYER_R;
  // Short steps, so even a fast move cannot skip a wall.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));
  for (let i = 0; i < steps; i++) {
    const nx = pos.x + dx / steps;
    if (!boxHits(m, nx, pos.y, r)) pos.x = nx;
    else pos.x = settle(m, pos.x, pos.y, dx > 0 ? 1 : -1, r, 'x');
    const ny = pos.y + dy / steps;
    if (!boxHits(m, pos.x, ny, r)) pos.y = ny;
    else pos.y = settle(m, pos.x, pos.y, dy > 0 ? 1 : -1, r, 'y');
  }
}

function boxHits(m: MazeMap, x: number, y: number, r: number): boolean {
  const e = 0.001;
  return mazeSolidAt(m, x - r + e, y - r + e) || mazeSolidAt(m, x + r - e, y - r + e)
    || mazeSolidAt(m, x - r + e, y + r - e) || mazeSolidAt(m, x + r - e, y + r - e);
}

/** Slides up to the wall, a pixel at a time, without entering it. */
function settle(m: MazeMap, x: number, y: number, dir: number, r: number, axis: 'x' | 'y'): number {
  let v = axis === 'x' ? x : y;
  for (let i = 0; i < 8; i++) {
    const nv = v + dir;
    if (axis === 'x' ? boxHits(m, nv, y, r) : boxHits(m, x, nv, r)) break;
    v = nv;
  }
  return v;
}

/** One tick of walking for these keys. Used by the server, and by the client
 *  to predict its own player between frames. */
export function walk(m: MazeMap, pos: { x: number; y: number }, keys: number): void {
  let dx = (keys & MV.RIGHT ? 1 : 0) - (keys & MV.LEFT ? 1 : 0);
  let dy = (keys & MV.DOWN ? 1 : 0) - (keys & MV.UP ? 1 : 0);
  if (!dx && !dy) return;
  const len = Math.hypot(dx, dy);
  dx = (dx / len) * PLAYER_SPEED * MAZE_DT;
  dy = (dy / len) * PLAYER_SPEED * MAZE_DT;
  moveBody(m, pos, dx, dy);
}

// -------------------------------------------------------------------- world

export interface MazeFighter {
  id: string;
  seat: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  alive: boolean;
  /** Tick to come back on, while dead. */
  respawnAt: number;
  safeUntil: number;
  lastHurt: number;
  lastShot: number;
  nextShot: number;
  kills: number;
  deaths: number;
  /** Not in the match right now (disconnected): not drawn, not hit, not spawned. */
  away: boolean;
}

export interface Bullet {
  id: number;
  seat: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dieAt: number;
}

export interface MazeWorld {
  map: MazeMap;
  tick: number;
  fighters: MazeFighter[];
  bullets: Bullet[];
  nextBullet: number;
  rng: Rng;
}

/** A new match, everyone spread across the maze as far apart as it allows. */
export function createWorld(map: MazeMap, ids: string[], rng: Rng): MazeWorld {
  const w: MazeWorld = { map, tick: 0, fighters: [], bullets: [], nextBullet: 1, rng };
  ids.forEach((id, seat) => {
    const f: MazeFighter = {
      id, seat, x: 0, y: 0, aim: 0, hp: MAX_HP, alive: true, respawnAt: 0, safeUntil: 0,
      lastHurt: -REGEN_AFTER, lastShot: -RADAR_TICKS, nextShot: 0, kills: 0, deaths: 0, away: false,
    };
    w.fighters.push(f);
    place(w, f);
  });
  return w;
}

/**
 * A spawn point far from everyone else: of a few dozen random cells, the one
 * whose nearest other player is furthest off. Cell centres always have room.
 */
export function spawnPoint(w: MazeWorld, except: MazeFighter | null): [number, number] {
  const others = w.fighters.filter((f) => f !== except && f.alive && !f.away && (f.x || f.y));
  let best: [number, number] = cellCentre(0, 0);
  let bestD = -1;
  for (let i = 0; i < 40; i++) {
    const p = cellCentre(Math.floor(w.rng() * w.map.cols), Math.floor(w.rng() * w.map.rows));
    const d = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - p[0], o.y - p[1]))) : Infinity;
    if (d > bestD) {
      bestD = d;
      best = p;
      if (d === Infinity) break;
    }
  }
  return best;
}

function place(w: MazeWorld, f: MazeFighter): void {
  const [x, y] = spawnPoint(w, f);
  f.x = x;
  f.y = y;
  f.hp = MAX_HP;
  f.alive = true;
  f.safeUntil = w.tick + PROTECT_TICKS;
  f.lastHurt = w.tick - REGEN_AFTER;
}

/**
 * One tick. `inputs` holds this tick's controls by seat; a seat with none
 * stands still and holds fire. Returns what happened, for the reliable feed.
 */
export function stepWorld(w: MazeWorld, inputs: (MazeInput | null)[]): MazeEvent[] {
  const events: MazeEvent[] = [];
  w.tick++;
  const t = w.tick;

  for (const f of w.fighters) {
    if (f.away) continue;
    if (!f.alive) {
      if (t >= f.respawnAt) {
        place(w, f);
        events.push({ k: 'spawn', s: f.seat, x: Math.round(f.x), y: Math.round(f.y) });
      }
      continue;
    }
    const inp = inputs[f.seat];
    if (inp) {
      walk(w.map, f, inp.keys);
      f.aim = inp.aim;
      if (inp.fire && t >= f.nextShot) fire(w, f);
    }
    if (f.hp < MAX_HP && t - f.lastHurt >= REGEN_AFTER) f.hp = Math.min(MAX_HP, f.hp + REGEN_PER_TICK);
  }

  // Bullets, in short steps: a wall ends one, and so does the first player on
  // its path who is not its owner and not fresh from a respawn.
  const alive: Bullet[] = [];
  for (const b of w.bullets) {
    if (t >= b.dieAt) continue;
    let gone = false;
    const steps = Math.ceil(BULLET_SPEED * MAZE_DT / 6);
    for (let i = 0; i < steps && !gone; i++) {
      const px = b.x;
      const py = b.y;
      b.x += (b.vx * MAZE_DT) / steps;
      b.y += (b.vy * MAZE_DT) / steps;
      if (mazeSolidAt(w.map, b.x, b.y)) {
        gone = true;
        break;
      }
      for (const f of w.fighters) {
        if (!f.alive || f.away || f.seat === b.seat || t < f.safeUntil) continue;
        if (segmentHitsCircle(px, py, b.x, b.y, f.x, f.y, PLAYER_R + 2)) {
          hurt(w, f, b.seat, events);
          gone = true;
          break;
        }
      }
    }
    if (!gone) alive.push(b);
  }
  w.bullets = alive;
  return events;
}

function fire(w: MazeWorld, f: MazeFighter): void {
  // Shooting ends spawn protection: you cannot hide behind it and fire.
  f.safeUntil = Math.min(f.safeUntil, w.tick);
  f.nextShot = w.tick + FIRE_EVERY;
  f.lastShot = w.tick;
  const a = fromAim(f.aim);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // From the muzzle, unless the muzzle is in a wall: then from the body, so a
  // player pressed to a wall cannot shoot through it.
  const mx = f.x + cos * (PLAYER_R + 6);
  const my = f.y + sin * (PLAYER_R + 6);
  const clear = !mazeSolidAt(w.map, mx, my);
  w.bullets.push({
    id: w.nextBullet++,
    seat: f.seat,
    x: clear ? mx : f.x,
    y: clear ? my : f.y,
    vx: cos * BULLET_SPEED,
    vy: sin * BULLET_SPEED,
    dieAt: w.tick + BULLET_LIFE,
  });
}

function hurt(w: MazeWorld, f: MazeFighter, by: number, events: MazeEvent[]): void {
  f.hp -= BULLET_DAMAGE;
  f.lastHurt = w.tick;
  events.push({ k: 'hit', v: f.seat, by, x: Math.round(f.x), y: Math.round(f.y) });
  if (f.hp > 0) return;
  f.hp = 0;
  f.alive = false;
  f.deaths++;
  f.respawnAt = w.tick + RESPAWN_TICKS;
  const killer = w.fighters[by];
  if (killer && killer !== f) killer.kills++;
  events.push({ k: 'kill', v: f.seat, by });
}

/** Whether the segment (x1,y1)-(x2,y2) passes within r of (cx,cy). */
export function segmentHitsCircle(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, r: number): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / len2)) : 0;
  const px = x1 + dx * t - cx;
  const py = y1 + dy * t - cy;
  return px * px + py * py <= r * r;
}

/** Takes a player out of the match while they are disconnected, or puts them
 *  back, somewhere safe, when they return. */
export function setAway(w: MazeWorld, seat: number, away: boolean): void {
  const f = w.fighters[seat];
  if (!f || f.away === away) return;
  f.away = away;
  if (!away) place(w, f);
}

/** The world as a frame. `acks` are the last input each seat has had applied. */
export function toMazeFrame(w: MazeWorld, acks: number[]): MazeFrame {
  return {
    t: w.tick,
    p: w.fighters.map((f) => [
      Math.round(f.x * 10) / 10,
      Math.round(f.y * 10) / 10,
      f.aim,
      Math.ceil(f.hp),
      (f.alive ? PF.ALIVE : 0) | (w.tick < f.safeUntil ? PF.SAFE : 0)
        | (w.tick - f.lastShot < RADAR_TICKS ? PF.RADAR : 0) | (f.away ? PF.AWAY : 0),
      acks[f.seat] ?? -1,
      f.alive ? 0 : Math.max(0, f.respawnAt - w.tick),
    ]),
    b: w.bullets.map((b) => [b.id, Math.round(b.x), Math.round(b.y), b.seat]),
  };
}
