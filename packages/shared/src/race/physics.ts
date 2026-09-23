import { RH, RW, tileAt, type Level } from './level.js';
import { RB, T, TILE } from './types.js';

/** Movement tuning, in pixels and frames at 60 Hz. */
export const PHYS = {
  RUN: 5.2,
  ACCEL_GROUND: 0.9,
  ACCEL_AIR: 0.55,
  FRICTION_GROUND: 0.72,
  FRICTION_AIR: 0.08,
  GRAVITY: 0.6,
  JUMP: 11,
  DOUBLE_JUMP: 9.5,
  /** Letting go of jump on the way up cuts the rise short, for small hops. */
  JUMP_CUT: 0.45,
  MAX_FALL: 12,
  GLIDE_FALL: 1.4,
  WALL_SLIDE: 2.2,
  WALL_JUMP_X: 6.2,
  WALL_JUMP_Y: 10.2,
  CLIMB: 2.4,
  MANTLE: 6,
  /** Frames of climbing before the grip gives out; refilled on landing. */
  STAMINA: 80,
  /** A jump still counts this long after running off a ledge. */
  COYOTE: 6,
  /** A jump pressed this long before landing still happens on landing. */
  BUFFER: 6,
  /** After a wall jump, steering is locked briefly so it actually leaves the wall. */
  WALL_LOCK: 9,
  CRUMBLE_DELAY: 28,
  CRUMBLE_GONE: 150,
} as const;

export interface Runner {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  ground: boolean;
  /** -1 or 1 while pressed against a wall in the air; 0 otherwise. */
  wall: -1 | 0 | 1;
  gliding: boolean;
  climbing: boolean;
  coyote: number;
  buffer: number;
  airJumps: number;
  stamina: number;
  lock: number;
  jumpHeld: boolean;
  cut: boolean;
}

/**
 * Per-player level state that is not the runner: which crumbling blocks have
 * been stepped on. Runners are ghosts to each other, so each client keeps its
 * own copy and a block only falls under the player who stood on it.
 */
export interface World {
  level: Level;
  frame: number;
  /** Tile index → frame it was first stood on. */
  crumbles: Map<number, number>;
}

export function newRunner(level: Level, at = level.spawn): Runner {
  return {
    x: at.x, y: at.y, vx: 0, vy: 0, facing: 1,
    ground: false, wall: 0, gliding: false, climbing: false,
    coyote: 0, buffer: 0, airJumps: 1, stamina: PHYS.STAMINA, lock: 0,
    jumpHeld: false, cut: false,
  };
}

export function newWorld(level: Level): World {
  return { level, frame: 0, crumbles: new Map() };
}

function crumbleGone(w: World, idx: number): boolean {
  const at = w.crumbles.get(idx);
  if (at === undefined) return false;
  const age = w.frame - at;
  return age >= PHYS.CRUMBLE_DELAY && age < PHYS.CRUMBLE_DELAY + PHYS.CRUMBLE_GONE;
}

/** Solid for movement. The level's sides are walls; above and below are open,
 *  and falling out of the bottom is a death. */
export function solidAt(w: World, tx: number, ty: number): boolean {
  const lv = w.level;
  if (tx < 0 || tx >= lv.w) return true;
  const t = tileAt(lv, tx, ty);
  if (t === T.SOLID) return true;
  if (t === T.CRUMBLE) return !crumbleGone(w, ty * lv.w + tx);
  return false;
}

function hits(w: World, x: number, y: number): boolean {
  const x0 = Math.floor(x / TILE);
  const x1 = Math.floor((x + RW - 0.01) / TILE);
  const y0 = Math.floor(y / TILE);
  const y1 = Math.floor((y + RH - 0.01) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidAt(w, tx, ty)) return true;
  return false;
}

/** Solid directly beside the runner, at any height along their body. */
function wallAt(w: World, r: Runner, side: -1 | 1): boolean {
  const tx = Math.floor((side === 1 ? r.x + RW + 1 : r.x - 1) / TILE);
  const y0 = Math.floor((r.y + 2) / TILE);
  const y1 = Math.floor((r.y + RH - 2) / TILE);
  for (let ty = y0; ty <= y1; ty++) if (solidAt(w, tx, ty)) return true;
  return false;
}

/**
 * One frame of movement. `held` is the controls this frame; `pressed` the
 * ones that went down since the last. Pure apart from the crumble map.
 */
export function stepRunner(r: Runner, held: number, pressed: number, w: World): void {
  const left = (held & RB.LEFT) !== 0;
  const right = (held & RB.RIGHT) !== 0;
  const up = (held & RB.UP) !== 0;
  const down = (held & RB.DOWN) !== 0;
  const jump = (held & RB.JUMP) !== 0;
  const dir = left === right ? 0 : right ? 1 : -1;

  if (pressed & RB.JUMP) r.buffer = PHYS.BUFFER;
  else if (r.buffer > 0) r.buffer--;
  if (r.coyote > 0) r.coyote--;
  if (r.lock > 0) r.lock--;

  // --- horizontal
  const steer = r.lock > 0 ? 0 : dir;
  if (steer !== 0) {
    const accel = r.ground ? PHYS.ACCEL_GROUND : PHYS.ACCEL_AIR;
    r.vx += steer * accel;
    if (Math.abs(r.vx) > PHYS.RUN) r.vx = Math.sign(r.vx) * Math.max(PHYS.RUN, Math.abs(r.vx) - accel);
    r.facing = steer;
  } else if (r.lock === 0) {
    const f = r.ground ? PHYS.FRICTION_GROUND : PHYS.FRICTION_AIR;
    r.vx = Math.abs(r.vx) <= f ? 0 : r.vx - Math.sign(r.vx) * f;
  }

  // --- walls: which side is touching, and whether we are pushing into it
  const touchL = !r.ground && wallAt(w, r, -1);
  const touchR = !r.ground && wallAt(w, r, 1);
  const wallSide: -1 | 0 | 1 = touchR ? 1 : touchL ? -1 : 0;
  r.wall = wallSide !== 0 && (dir === wallSide || up) ? wallSide : 0;

  // --- jumps, in priority order
  if (r.buffer > 0 && (r.ground || r.coyote > 0)) {
    r.vy = -PHYS.JUMP;
    r.ground = false;
    r.coyote = 0;
    r.buffer = 0;
    r.cut = false;
  } else if (r.buffer > 0 && wallSide !== 0) {
    r.vy = -PHYS.WALL_JUMP_Y;
    r.vx = -wallSide * PHYS.WALL_JUMP_X;
    r.facing = wallSide === 1 ? -1 : 1;
    r.lock = PHYS.WALL_LOCK;
    r.buffer = 0;
    r.airJumps = 1;
    r.cut = false;
  } else if ((pressed & RB.JUMP) && !r.ground && r.airJumps > 0) {
    r.vy = -PHYS.DOUBLE_JUMP;
    r.airJumps--;
    r.buffer = 0;
    r.cut = false;
  }

  if (!jump && r.vy < 0 && !r.cut) {
    r.vy *= PHYS.JUMP_CUT;
    r.cut = true;
  }

  // --- vertical
  const wasClimbing = r.climbing;
  r.climbing = false;
  r.vy = Math.min(PHYS.MAX_FALL, r.vy + PHYS.GRAVITY);
  if (wasClimbing && r.wall === 0 && wallSide === 0 && up) {
    // Climbed off the top of the wall: a hop onto the ledge, or the runner
    // hangs a pixel short of it and slides back down.
    r.vy = Math.min(r.vy, -PHYS.MANTLE);
  } else if (r.wall !== 0 && up && r.stamina > 0) {
    r.vy = -PHYS.CLIMB;
    r.stamina--;
    r.climbing = true;
  } else if (r.wall !== 0 && r.vy > 0) {
    r.vy = Math.min(r.vy, down ? PHYS.WALL_SLIDE * 3 : PHYS.WALL_SLIDE);
  }
  r.gliding = jump && r.vy > 0 && r.wall === 0 && !r.ground;
  if (r.gliding) r.vy = Math.min(r.vy, PHYS.GLIDE_FALL);

  // --- move, one axis at a time
  r.x += r.vx;
  if (hits(w, r.x, r.y)) {
    r.x = r.vx > 0 ? Math.floor((r.x + RW) / TILE) * TILE - RW : Math.floor(r.x / TILE + 1) * TILE;
    r.vx = 0;
  }

  const wasGround = r.ground;
  r.ground = false;
  r.y += r.vy;
  if (hits(w, r.x, r.y)) {
    if (r.vy > 0) {
      r.y = Math.floor((r.y + RH) / TILE) * TILE - RH;
      r.ground = true;
    } else {
      r.y = Math.floor(r.y / TILE + 1) * TILE;
    }
    r.vy = 0;
  }

  if (r.ground) {
    r.airJumps = 1;
    r.stamina = PHYS.STAMINA;
    r.coyote = PHYS.COYOTE;
    touchCrumbles(r, w);
  } else if (wasGround && r.vy >= 0) {
    // Walked off a ledge: coyote time starts counting from here.
    r.coyote = PHYS.COYOTE;
  }
  r.jumpHeld = jump;
  w.frame++;
  for (const [idx, at] of w.crumbles) {
    if (w.frame - at >= PHYS.CRUMBLE_DELAY + PHYS.CRUMBLE_GONE) w.crumbles.delete(idx);
  }
}

function touchCrumbles(r: Runner, w: World): void {
  const lv = w.level;
  const ty = Math.floor((r.y + RH + 1) / TILE);
  const x0 = Math.floor(r.x / TILE);
  const x1 = Math.floor((r.x + RW - 0.01) / TILE);
  for (let tx = x0; tx <= x1; tx++) {
    if (tileAt(lv, tx, ty) !== T.CRUMBLE) continue;
    const idx = ty * lv.w + tx;
    if (!w.crumbles.has(idx)) w.crumbles.set(idx, w.frame);
  }
}

/** How far a crumbling block has got: 0 intact, rising to 1 as it gives way,
 *  and null while it is gone. For drawing the shake. */
export function crumbleState(w: World, idx: number): number | null {
  const at = w.crumbles.get(idx);
  if (at === undefined) return 0;
  const age = w.frame - at;
  if (age < PHYS.CRUMBLE_DELAY) return age / PHYS.CRUMBLE_DELAY;
  if (age < PHYS.CRUMBLE_DELAY + PHYS.CRUMBLE_GONE) return null;
  return 0;
}
