import { RH, RW, tileAt, type Level } from './level.js';
import { RB, T, TILE } from './types.js';

/**
 * Movement tuning, in pixels and frames at 60 Hz. Modelled on Hollow Knight
 * and Silksong: no acceleration curve, full control in the air, a jump that
 * rises at a steady speed for as long as the button is held and stops the
 * moment it is let go, and heavy gravity so falls are quick and readable.
 */
export const PHYS = {
  RUN: 5,
  SPRINT: 7.8,
  GRAVITY: 0.75,
  MAX_FALL: 11,
  JUMP: 8.5,
  /** Frames the rise can be held for. */
  JUMP_HOLD: 8,
  /** Even a tap rises this many frames, so it is a hop rather than a twitch. */
  JUMP_MIN: 3,
  DOUBLE_JUMP: 8.5,
  DOUBLE_HOLD: 6,
  /** Speed at the top of a jump that was let go early. */
  JUMP_RELEASE: 2,
  GLIDE_FALL: 1.4,
  WALL_SLIDE: 2.6,
  /** The kick away from a wall. Steering comes back after WALL_LOCK frames,
   *  so holding toward the wall carries you back to it a little higher. */
  WALL_JUMP_X: 7,
  WALL_JUMP_Y: 8.5,
  WALL_JUMP_HOLD: 6,
  WALL_LOCK: 7,
  CLIMB: 2.4,
  MANTLE: 6,
  /** Frames of climbing before the grip gives out; refilled on landing. */
  STAMINA: 80,
  DASH_SPEED: 12,
  DASH_FRAMES: 10,
  /** Frames after a dash ends before the next one. */
  DASH_COOLDOWN: 24,
  /** A jump still counts this long after running off a ledge. */
  COYOTE: 6,
  /** A jump pressed this long before landing still happens on landing. */
  BUFFER: 6,
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
  /** -1 or 1 while clinging to a wall in the air; 0 otherwise. */
  wall: -1 | 0 | 1;
  gliding: boolean;
  climbing: boolean;
  coyote: number;
  buffer: number;
  airJumps: number;
  stamina: number;
  /** Frames of wall-jump kick left, during which steering is ignored. */
  lock: number;
  /** Frames the current jump can still be held rising. */
  hold: number;
  /** Frames since the current jump started. */
  rise: number;
  /** Frames of dash left, and which way. */
  dash: number;
  dashDir: 1 | -1;
  /** Frames until the dash can be used again. */
  dashCd: number;
  /** An air dash is available. Refilled on the ground and on walls. */
  airDash: boolean;
  sprint: boolean;
  /** Frames since the last double jump, for the wing flap. Large when idle. */
  flap: number;
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
    hold: 0, rise: 0, dash: 0, dashDir: 1, dashCd: 0, airDash: true, sprint: false,
    flap: 999,
  };
}

export function newWorld(level: Level): World {
  return { level, frame: 0, crumbles: new Map() };
}

/** Whether a dash would go off if pressed now. For the indicator. */
export function dashReady(r: Runner): boolean {
  return r.dash === 0 && r.dashCd === 0 && (r.ground || r.airDash);
}

function crumbleGone(w: World, idx: number): boolean {
  const at = w.crumbles.get(idx);
  if (at === undefined) return false;
  const age = w.frame - at;
  return age >= PHYS.CRUMBLE_DELAY && age < PHYS.CRUMBLE_DELAY + PHYS.CRUMBLE_GONE;
}

/** Solid for movement. The level's sides and top are walls, so nothing can be
 *  skipped by going over it; the bottom is open, and falling out is a death. */
export function solidAt(w: World, tx: number, ty: number): boolean {
  const lv = w.level;
  if (tx < 0 || tx >= lv.w || ty < 0) return true;
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

function startJump(r: Runner, vy: number, hold: number): void {
  r.vy = -vy;
  r.hold = hold;
  r.rise = 0;
  r.dash = 0;
  r.ground = false;
  r.coyote = 0;
  r.buffer = 0;
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
  const dashHeld = (held & RB.DASH) !== 0;
  const dir = left === right ? 0 : right ? 1 : -1;

  if (pressed & RB.JUMP) r.buffer = PHYS.BUFFER;
  else if (r.buffer > 0) r.buffer--;
  if (r.coyote > 0) r.coyote--;
  if (r.lock > 0) r.lock--;
  if (r.dashCd > 0) r.dashCd--;
  r.flap++;

  // --- walls: cling by pushing into one in the air
  const touchL = !r.ground && wallAt(w, r, -1);
  const touchR = !r.ground && wallAt(w, r, 1);
  const wallSide: -1 | 0 | 1 = touchR ? 1 : touchL ? -1 : 0;
  r.wall = wallSide !== 0 && r.lock === 0 && r.dash === 0 && (dir === wallSide || up) ? wallSide : 0;
  if (r.wall !== 0) {
    // A wall is a fresh start in the air, as in Hollow Knight.
    r.airDash = true;
    r.airJumps = 1;
    r.sprint = false;
  }

  // --- dash
  if ((pressed & RB.DASH) && dashReady(r)) {
    r.dashDir = r.wall !== 0 ? (r.wall === 1 ? -1 : 1) : dir !== 0 ? dir : r.facing;
    r.facing = r.dashDir;
    r.dash = PHYS.DASH_FRAMES;
    r.dashCd = PHYS.DASH_FRAMES + PHYS.DASH_COOLDOWN;
    if (!r.ground) r.airDash = false;
    r.hold = 0;
    r.lock = 0;
    r.wall = 0;
  }

  // --- jumps, in priority order; any of them cancels a dash
  if (r.buffer > 0 && (r.ground || r.coyote > 0)) {
    // Jumping out of a sprint or a ground dash keeps the speed in the air.
    if (r.dash > 0 && dashHeld) r.sprint = true;
    startJump(r, PHYS.JUMP, PHYS.JUMP_HOLD);
  } else if (r.buffer > 0 && wallSide !== 0) {
    startJump(r, PHYS.WALL_JUMP_Y, PHYS.WALL_JUMP_HOLD);
    r.vx = -wallSide * PHYS.WALL_JUMP_X;
    r.facing = wallSide === 1 ? -1 : 1;
    r.lock = PHYS.WALL_LOCK;
    r.airJumps = 1;
    r.airDash = true;
    r.sprint = false;
  } else if ((pressed & RB.JUMP) && !r.ground && r.airJumps > 0) {
    startJump(r, PHYS.DOUBLE_JUMP, PHYS.DOUBLE_HOLD);
    r.airJumps--;
    r.flap = 0;
  }

  // --- horizontal: no acceleration curve, on the ground or in the air
  const dashing = r.dash > 0;
  if (dashing) {
    r.dash--;
    r.vx = r.dashDir * PHYS.DASH_SPEED;
    r.vy = 0;
    // Still holding dash when a ground dash ends: break into a sprint.
    if (r.dash === 0 && r.ground && dashHeld && dir === r.dashDir) r.sprint = true;
  } else if (r.lock === 0) {
    if (r.sprint && (dir !== r.facing || (r.ground && !dashHeld))) r.sprint = false;
    r.vx = dir * (r.sprint ? PHYS.SPRINT : PHYS.RUN);
    if (dir !== 0) r.facing = dir;
  }

  // --- vertical
  const wasClimbing = r.climbing;
  r.climbing = false;
  if (dashing) {
    // Gravity is suspended for the length of a dash.
  } else if (r.hold > 0 && (jump || r.rise < PHYS.JUMP_MIN)) {
    // Rising at a steady speed while the button is held.
    r.hold--;
    r.rise++;
  } else {
    if (r.hold > 0) {
      // Let go early: the rise stops almost at once.
      r.hold = 0;
      if (r.vy < -PHYS.JUMP_RELEASE) r.vy = -PHYS.JUMP_RELEASE;
    }
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
  }
  // The cloak: once the double jump is spent, holding jump on the way down
  // floats. Before that, a press is a double jump, so a held full jump never
  // turns into a glide by accident.
  r.gliding = jump && r.airJumps === 0 && r.vy > 0 && r.wall === 0 && !r.ground && !dashing;
  if (r.gliding) r.vy = Math.min(r.vy, PHYS.GLIDE_FALL);

  // --- move, one axis at a time
  r.x += r.vx;
  if (hits(w, r.x, r.y)) {
    r.x = r.vx > 0 ? Math.floor((r.x + RW) / TILE) * TILE - RW : Math.floor(r.x / TILE + 1) * TILE;
    r.vx = 0;
    r.dash = 0;
    r.sprint = false;
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
      r.hold = 0;
    }
    r.vy = 0;
  } else if (r.vy >= 0 && hits(w, r.x, r.y + 1)) {
    // Standing still vertically (a dash suspends gravity) is still standing.
    r.ground = true;
  }

  if (r.ground) {
    r.airJumps = 1;
    r.airDash = true;
    r.stamina = PHYS.STAMINA;
    r.coyote = PHYS.COYOTE;
    r.hold = 0;
    touchCrumbles(r, w);
  } else if (wasGround && r.vy >= 0) {
    // Walked off a ledge: coyote time starts counting from here.
    r.coyote = PHYS.COYOTE;
  }
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
