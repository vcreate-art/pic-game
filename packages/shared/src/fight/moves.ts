import type { Box, Height, ProjectileKind } from './types.js';

/** One active window of a move. Frames count from 1, the tick the move starts. */
export interface Hit {
  /** First active frame. */
  at: number;
  /** How many frames it stays out. */
  active: number;
  box: Box;
  damage: number;
  height: Height;
  hitstun: number;
  blockstun: number;
  /** Speed the defender is shoved back at, on hit or block. */
  push: number;
  /** Knocks the defender into the air, where it can be juggled. */
  launch?: { vx: number; vy: number };
  /** Puts them on the floor. */
  knockdown?: boolean;
}

export interface ProjectileSpec {
  at: number;
  kind: ProjectileKind;
  speed: number;
  /** Height it flies at, above the thrower's feet. */
  y: number;
  vy?: number;
  /** Frames before it fizzles; bounds the range. */
  life: number;
  damage: number;
  hitstun: number;
  blockstun: number;
  /** What happens to a defender it hits, beyond the damage. */
  effect?: 'freeze' | 'pull';
}

export interface Move {
  id: string;
  name: string;
  /** Frames from start to the end of recovery. */
  total: number;
  hits: Hit[];
  special?: boolean;
  /** Usable in the air. Air moves keep the jump's momentum. */
  air?: boolean;
  /** Lowers the hurtbox, as with a slide or a sweep. */
  low?: boolean;
  /** Sets horizontal speed for a stretch of frames (forward is positive). */
  vel?: { from: number; to: number; vx: number }[];
  /** Stops dead once it connects, rather than sliding through. */
  stopOnHit?: boolean;
  projectile?: ProjectileSpec;
  /** Reappears behind the opponent on this frame. */
  teleport?: number;
  /** Invulnerable, and not drawn, over this range of frames. */
  vanish?: [number, number];
  /** A throw: the hit is a grab rather than a strike. */
  grab?: boolean;
  fatal?: boolean;
}

// Standing reach: the shoulder sits about 165 up and an arm is about 75 long;
// the hip sits at 96 and a leg is about 96 long. Boxes are placed so the drawn
// fist or foot ends inside them.

const STAND_HIGH = { y: 140, h: 34 };
const MID_KICK = { y: 70, h: 45 };
const LOW = { y: 0, h: 38 };

export const NORMALS: Record<string, Move> = {
  jab: {
    id: 'jab', name: 'Jab', total: 18,
    hits: [{ at: 6, active: 3, box: { x: 30, w: 62, ...STAND_HIGH }, damage: 30, height: 'high', hitstun: 15, blockstun: 10, push: 3 }],
  },
  cross: {
    id: 'cross', name: 'Cross', total: 24,
    hits: [{ at: 8, active: 3, box: { x: 30, w: 70, ...STAND_HIGH }, damage: 45, height: 'high', hitstun: 18, blockstun: 12, push: 5 }],
  },
  fkick: {
    id: 'fkick', name: 'Front Kick', total: 25,
    hits: [{ at: 9, active: 3, box: { x: 30, w: 76, ...MID_KICK }, damage: 45, height: 'mid', hitstun: 18, blockstun: 12, push: 5 }],
  },
  bkick: {
    id: 'bkick', name: 'Back Kick', total: 34,
    hits: [{ at: 12, active: 4, box: { x: 30, w: 90, y: 90, h: 50 }, damage: 65, height: 'mid', hitstun: 22, blockstun: 14, push: 9 }],
  },
  lowjab: {
    id: 'lowjab', name: 'Low Jab', total: 18, low: true,
    hits: [{ at: 6, active: 3, box: { x: 25, w: 62, y: 60, h: 30 }, damage: 25, height: 'mid', hitstun: 14, blockstun: 9, push: 3 }],
  },
  uppercut: {
    id: 'uppercut', name: 'Uppercut', total: 40,
    hits: [{
      at: 10, active: 4, box: { x: 15, w: 60, y: 90, h: 110 }, damage: 110, height: 'mid',
      hitstun: 30, blockstun: 16, push: 4, launch: { vx: 2.5, vy: 17 },
    }],
  },
  lowkick: {
    id: 'lowkick', name: 'Low Kick', total: 22, low: true,
    hits: [{ at: 7, active: 3, box: { x: 25, w: 80, ...LOW }, damage: 30, height: 'low', hitstun: 15, blockstun: 10, push: 4 }],
  },
  sweep: {
    id: 'sweep', name: 'Sweep', total: 42, low: true,
    hits: [{
      at: 11, active: 4, box: { x: 25, w: 100, ...LOW }, damage: 70, height: 'low',
      hitstun: 20, blockstun: 14, push: 4, knockdown: true,
    }],
  },
  overhead: {
    id: 'overhead', name: 'Overhead', total: 38,
    hits: [{ at: 18, active: 4, box: { x: 25, w: 70, y: 60, h: 120 }, damage: 60, height: 'overhead', hitstun: 22, blockstun: 12, push: 5 }],
  },
  jpunch: {
    id: 'jpunch', name: 'Jump Punch', total: 22, air: true,
    hits: [{ at: 6, active: 8, box: { x: 15, w: 70, y: 40, h: 70 }, damage: 50, height: 'overhead', hitstun: 20, blockstun: 12, push: 4 }],
  },
  jkick: {
    id: 'jkick', name: 'Jump Kick', total: 26, air: true,
    hits: [{ at: 7, active: 10, box: { x: 15, w: 85, y: 0, h: 70 }, damage: 60, height: 'overhead', hitstun: 22, blockstun: 12, push: 6 }],
  },
  throw: {
    id: 'throw', name: 'Throw', total: 30, grab: true,
    hits: [{ at: 7, active: 3, box: { x: 20, w: 58, y: 40, h: 120 }, damage: 120, height: 'mid', hitstun: 0, blockstun: 0, push: 0 }],
  },
  fatal: {
    id: 'fatal', name: 'Fatal Blow', total: 46, fatal: true,
    vel: [{ from: 4, to: 16, vx: 9 }],
    hits: [{ at: 12, active: 6, box: { x: 10, w: 110, y: 30, h: 150 }, damage: 0, height: 'mid', hitstun: 30, blockstun: 20, push: 6 }],
  },
};

/** Frames a thrown fighter has to press throw and break free. */
export const THROW_TECH_FRAMES = 10;
/** How long a throw holds both fighters before the victim hits the floor. */
export const THROW_FRAMES = 40;

/** When a string's next button is accepted: from the first active frame to
 *  the end of recovery. Holding the input a few frames early is fine too; the
 *  buffer catches it. */
export function firstActive(move: Move): number {
  return move.hits[0]?.at ?? 1;
}
