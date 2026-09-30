import { cellCentre, mazeSolidAt, worldH, worldW, type MazeMap } from './map.js';
import {
  BULLET_DAMAGE, BULLET_LIFE, BULLET_SPEED, CELL, FIRE_EVERY, KILL_SWAP_CHANCE, MAX_HP, MAZE_DT, MAZE_TILE,
  MAX_ITEMS, MISSILE, MV, PF, PICKUP_EVERY, PICKUP_R, PLAYER_R, PLAYER_SPEED, POWER_AMOUNT, POWER_KINDS, PROTECT_TICKS,
  RADAR_TICKS, REGEN_AFTER, REGEN_PER_TICK, RESPAWN_TICKS, RUN, SHOT, SHUFFLE_EVERY, SPEED_BOOST, SPREAD,
  fromAim, packItems, powerCode, type ItemKind, type MazeEvent, type MazeFrame, type MazeInput, type PowerKind,
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

/** How fast a player moves, running or walking. */
export const speedFor = (boosted: boolean): number => PLAYER_SPEED * (boosted ? SPEED_BOOST : 1);

/** One tick of walking for these keys. Used by the server, and by the client
 *  to predict its own player between frames. */
export function walk(m: MazeMap, pos: { x: number; y: number }, keys: number, speed = PLAYER_SPEED): void {
  let dx = (keys & MV.RIGHT ? 1 : 0) - (keys & MV.LEFT ? 1 : 0);
  let dy = (keys & MV.DOWN ? 1 : 0) - (keys & MV.UP ? 1 : 0);
  if (!dx && !dy) return;
  const len = Math.hypot(dx, dy);
  dx = (dx / len) * speed * MAZE_DT;
  dy = (dy / len) * speed * MAZE_DT;
  moveBody(m, pos, dx, dy);
}

// -------------------------------------------------------------------- world

/** An item on a player's stack. */
export interface Item {
  kind: ItemKind;
  /** Missiles or blasts left. */
  left: number;
}

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
  /** Items, the top of the stack last: the secondary button uses that one. */
  items: Item[];
  /** Shield points, spent before health. */
  shield: number;
  /** Ticks of a run still going. */
  runLeft: number;
  /** Tick the next run may start. */
  runReadyAt: number;
  /** Whether run was held last tick, so holding it does not start another. */
  runWas: boolean;
  /** Tick the secondary may next fire. */
  nextAlt: number;
  /** Whether the secondary was held last tick, to catch a fresh press. */
  altWas: boolean;
}

export type ShotKind = (typeof SHOT)[keyof typeof SHOT];

export interface Bullet {
  id: number;
  seat: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  dieAt: number;
  shot: ShotKind;
  damage: number;
}

export interface Pickup {
  id: number;
  kind: PowerKind;
  x: number;
  y: number;
}

export interface MazeWorld {
  map: MazeMap;
  tick: number;
  fighters: MazeFighter[];
  bullets: Bullet[];
  nextBullet: number;
  rng: Rng;
  powerups: boolean;
  pickups: Pickup[];
  nextPickup: number;
  /** Tick the next pickup may appear. */
  pickupAt: number;
  /** Tick of the next shuffle of everyone's power-ups. */
  shuffleAt: number;
}

/** A new match, everyone spread across the maze as far apart as it allows. */
export function createWorld(map: MazeMap, ids: string[], rng: Rng, powerups = false): MazeWorld {
  const w: MazeWorld = {
    map, tick: 0, fighters: [], bullets: [], nextBullet: 1, rng,
    powerups, pickups: [], nextPickup: 1, pickupAt: 0, shuffleAt: 0,
  };
  w.shuffleAt = nextShuffle(w);
  ids.forEach((id, seat) => {
    const f: MazeFighter = {
      id, seat, x: 0, y: 0, aim: 0, hp: MAX_HP, alive: true, respawnAt: 0, safeUntil: 0,
      lastHurt: -REGEN_AFTER, lastShot: -RADAR_TICKS, nextShot: 0, kills: 0, deaths: 0, away: false,
      items: [], shield: 0, runLeft: 0, runReadyAt: 0, runWas: false, nextAlt: 0, altWas: false,
    };
    w.fighters.push(f);
    place(w, f);
  });
  return w;
}

const nextShuffle = (w: MazeWorld) =>
  w.tick + SHUFFLE_EVERY.min + Math.floor(w.rng() * (SHUFFLE_EVERY.max - SHUFFLE_EVERY.min));

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

/** A full item of this kind. */
export const freshItem = (kind: ItemKind): Item => ({ kind, left: POWER_AMOUNT[kind] });

/** Whether this player can take this pickup right now: a shield only with
 *  none already, an item only with room on the stack. */
export function canTake(f: MazeFighter, kind: PowerKind): boolean {
  return kind === 'shield' ? f.shield <= 0 : f.items.length < MAX_ITEMS;
}

/** Gives a player a pickup's power, if they can take it. */
export function take(f: MazeFighter, kind: PowerKind): boolean {
  if (!canTake(f, kind)) return false;
  if (kind === 'shield') f.shield = POWER_AMOUNT.shield;
  else f.items.push(freshItem(kind));
  return true;
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
      const run = inp.run === true;
      if (run && !f.runWas && t >= f.runReadyAt) {
        f.runLeft = RUN.ticks;
        f.runReadyAt = t + RUN.ticks + RUN.cooldown;
      }
      f.runWas = run;
      walk(w.map, f, inp.keys, speedFor(f.runLeft > 0));
      f.aim = inp.aim;
      if (inp.fire && t >= f.nextShot) fire(w, f);
      useItem(w, f, inp.alt === true);
    } else {
      f.altWas = false;
    }
    if (f.runLeft > 0) f.runLeft--;
    if (f.hp < MAX_HP && t - f.lastHurt >= REGEN_AFTER) f.hp = Math.min(MAX_HP, f.hp + REGEN_PER_TICK);
  }

  if (w.powerups) {
    collect(w, events);
    spawnPickups(w);
    if (t >= w.shuffleAt) {
      w.shuffleAt = nextShuffle(w);
      if (shufflePowers(w)) events.push({ k: 'shuffle' });
    }
  }

  // Bullets, in short steps: a wall ends one (unless it is a ghost missile),
  // and so does the first player on its path who is not its owner and not
  // fresh from a respawn.
  const alive: Bullet[] = [];
  const W = worldW(w.map);
  const H = worldH(w.map);
  for (const b of w.bullets) {
    if (t >= b.dieAt) continue;
    let gone = false;
    const speed = Math.hypot(b.vx, b.vy);
    const steps = Math.max(1, Math.ceil((speed * MAZE_DT) / 6));
    for (let i = 0; i < steps && !gone; i++) {
      const px = b.x;
      const py = b.y;
      b.x += (b.vx * MAZE_DT) / steps;
      b.y += (b.vy * MAZE_DT) / steps;
      const wall = b.shot === SHOT.MISSILE
        ? b.x < MAZE_TILE || b.y < MAZE_TILE || b.x > W - MAZE_TILE || b.y > H - MAZE_TILE
        : mazeSolidAt(w.map, b.x, b.y);
      if (wall) {
        gone = true;
        break;
      }
      for (const f of w.fighters) {
        if (!f.alive || f.away || f.seat === b.seat || t < f.safeUntil) continue;
        if (segmentHitsCircle(px, py, b.x, b.y, f.x, f.y, PLAYER_R + 2)) {
          hurt(w, f, b.seat, b.damage, events);
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

function shoot(w: MazeWorld, f: MazeFighter, angle: number, speed: number, life: number, shot: ShotKind, damage: number): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // From the muzzle, unless the muzzle is in a wall: then from the body, so a
  // player pressed to a wall cannot shoot through it. Missiles may.
  const mx = f.x + cos * (PLAYER_R + 6);
  const my = f.y + sin * (PLAYER_R + 6);
  const clear = shot === SHOT.MISSILE || !mazeSolidAt(w.map, mx, my);
  w.bullets.push({
    id: w.nextBullet++, seat: f.seat, x: clear ? mx : f.x, y: clear ? my : f.y,
    vx: cos * speed, vy: sin * speed, dieAt: w.tick + life, shot, damage,
  });
}

/** Shooting at all ends spawn protection: you cannot hide behind it and fire. */
function shot(w: MazeWorld, f: MazeFighter): void {
  f.safeUntil = Math.min(f.safeUntil, w.tick);
  f.lastShot = w.tick;
}

/** The gun: always ordinary bullets. */
function fire(w: MazeWorld, f: MazeFighter): void {
  shot(w, f);
  shoot(w, f, fromAim(f.aim), BULLET_SPEED, BULLET_LIFE, SHOT.BULLET, BULLET_DAMAGE);
  f.nextShot = w.tick + FIRE_EVERY;
}

/**
 * The secondary: the item on top of the stack, fired while held, each kind at
 * its own rate. An item is gone once used up, and the one under it is next.
 */
function useItem(w: MazeWorld, f: MazeFighter, held: boolean): void {
  f.altWas = held;
  const top = f.items[f.items.length - 1];
  if (!top || !held) return;
  if (w.tick < f.nextAlt) return;
  shot(w, f);
  const a = fromAim(f.aim);
  if (top.kind === 'missile') {
    shoot(w, f, a, MISSILE.speed, MISSILE.life, SHOT.MISSILE, MISSILE.damage);
    f.nextAlt = w.tick + MISSILE.every;
  } else {
    for (let i = 0; i < SPREAD.pellets; i++) {
      const off = (i / (SPREAD.pellets - 1) - 0.5) * SPREAD.arc;
      shoot(w, f, a + off, SPREAD.speed, SPREAD.life, SHOT.PELLET, SPREAD.damage);
    }
    f.nextAlt = w.tick + SPREAD.every;
  }
  if (--top.left <= 0) f.items.pop();
}

function hurt(w: MazeWorld, f: MazeFighter, by: number, damage: number, events: MazeEvent[]): void {
  f.lastHurt = w.tick;
  events.push({ k: 'hit', v: f.seat, by, x: Math.round(f.x), y: Math.round(f.y) });
  // A shield takes it first.
  if (f.shield > 0) {
    const soak = Math.min(f.shield, damage);
    f.shield -= soak;
    damage -= soak;
  }
  f.hp -= damage;
  if (f.hp > 0) return;
  f.hp = 0;
  f.alive = false;
  f.deaths++;
  f.respawnAt = w.tick + RESPAWN_TICKS;
  const killer = w.fighters[by];
  if (killer && killer !== f) killer.kills++;
  events.push({ k: 'kill', v: f.seat, by });
  f.runLeft = 0;
  f.shield = 0;
  if (w.powerups && killer && killer !== f) afterKill(w, killer, f, events);
  else f.items = [];
}

/**
 * A kill's items (shields are not part of it). Sometimes the two stacks swap:
 * the killer takes the victim's, and the victim comes back with the killer's.
 * Otherwise the victim's scatter where they fell, for anyone to grab.
 */
function afterKill(w: MazeWorld, killer: MazeFighter, victim: MazeFighter, events: MazeEvent[]): void {
  const theirs = victim.items;
  const mine = killer.items;
  if ((theirs.length || mine.length) && w.rng() < KILL_SWAP_CHANCE) {
    killer.items = theirs;
    victim.items = mine;
    events.push({ k: 'swap', a: killer.seat, b: victim.seat });
    return;
  }
  victim.items = [];
  theirs.forEach((it, i) => {
    // Spread round the body, so they are separate things to pick up.
    const a = (i / Math.max(1, theirs.length)) * Math.PI * 2;
    const r = theirs.length > 1 ? 18 : 0;
    const x = victim.x + Math.cos(a) * r;
    const y = victim.y + Math.sin(a) * r;
    w.pickups.push({ id: w.nextPickup++, kind: it.kind, x: mazeSolidAt(w.map, x, y) ? victim.x : x, y: mazeSolidAt(w.map, x, y) ? victim.y : y });
  });
}

/** Walking over a pickup takes it, if you can: see `canTake`. One you
 *  cannot take stays where it is for someone who can. */
function collect(w: MazeWorld, events: MazeEvent[]): void {
  if (!w.pickups.length) return;
  const left: Pickup[] = [];
  for (const u of w.pickups) {
    const f = w.fighters.find((p) => p.alive && !p.away && canTake(p, u.kind)
      && Math.hypot(p.x - u.x, p.y - u.y) <= PLAYER_R + PICKUP_R);
    if (!f) {
      left.push(u);
      continue;
    }
    take(f, u.kind);
    events.push({ k: 'pick', s: f.seat, p: powerCode(u.kind), x: Math.round(u.x), y: Math.round(u.y) });
  }
  w.pickups = left;
}

/** How many pickups the maze holds at once: more for more players. */
export const pickupCap = (w: MazeWorld): number =>
  Math.min(6, 1 + Math.ceil(w.fighters.filter((f) => !f.away).length / 2));

/** Tops the maze up, one at a time, in a cell nobody is near. */
function spawnPickups(w: MazeWorld): void {
  if (w.tick < w.pickupAt || w.pickups.length >= pickupCap(w)) return;
  w.pickupAt = w.tick + PICKUP_EVERY;
  const clear = CELL * MAZE_TILE * 2;
  for (let i = 0; i < 20; i++) {
    const [x, y] = cellCentre(Math.floor(w.rng() * w.map.cols), Math.floor(w.rng() * w.map.rows));
    const near = w.fighters.some((f) => f.alive && !f.away && Math.hypot(f.x - x, f.y - y) < clear)
      || w.pickups.some((u) => Math.hypot(u.x - x, u.y - y) < clear);
    if (near) continue;
    w.pickups.push({ id: w.nextPickup++, kind: POWER_KINDS[Math.floor(w.rng() * POWER_KINDS.length)]!, x, y });
    return;
  }
}

/**
 * Deals everyone's item stacks out again at random among the living, whole,
 * so someone may come away empty-handed. Shields stay put. Returns false when
 * nobody held anything.
 */
export function shufflePowers(w: MazeWorld): boolean {
  const live = w.fighters.filter((f) => f.alive && !f.away);
  if (live.length < 2 || !live.some((f) => f.items.length)) return false;
  const pool = live.map((f) => f.items);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(w.rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  live.forEach((f, i) => (f.items = pool[i]!));
  return true;
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
      packItems([...f.items].reverse().map((it) => it.kind)),
      f.items.length ? f.items[f.items.length - 1]!.left : 0,
      Math.ceil(f.shield),
      f.runLeft,
      f.alive ? Math.max(0, f.runReadyAt - w.tick) : 0,
    ]),
    b: w.bullets.map((b) => [b.id, Math.round(b.x), Math.round(b.y), b.seat, b.shot]),
    u: w.pickups.map((u) => [u.id, powerCode(u.kind), Math.round(u.x), Math.round(u.y)]),
  };
}
