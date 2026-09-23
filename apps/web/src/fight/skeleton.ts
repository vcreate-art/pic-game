/**
 * A stick figure as a handful of joint angles.
 *
 * Angles are in degrees. Limbs measure from straight down and the torso from
 * straight up; positive always rotates toward the way the fighter faces. So an
 * arm at 90 points straight ahead whichever side of the screen it is on, and
 * mirroring a fighter is one sign flip rather than a second set of poses.
 */
export interface Pose {
  /** Hip height above the feet. */
  hip: number;
  /** Hip shift forward. */
  hx: number;
  torso: number;
  head: number;
  /** Front arm: shoulder, then elbow bend relative to the upper arm. */
  fs: number;
  fe: number;
  bs: number;
  be: number;
  /** Front leg: hip, then knee bend (negative folds the shin back). */
  fh: number;
  fk: number;
  bh: number;
  bk: number;
  /** Whole-body rotation about the hip, for falling and lying down. Positive
   *  tips backward. */
  rot: number;
}

export const LEN = {
  torso: 64,
  neck: 9,
  head: 13,
  upper: 36,
  fore: 34,
  thigh: 46,
  shin: 46,
} as const;

export const STANCE: Pose = {
  hip: 84, hx: 0, torso: 8, head: 0,
  fs: 38, fe: 100, bs: 22, be: 112,
  fh: 22, fk: -26, bh: -20, bk: -12,
  rot: 0,
};

export function mix(a: Pose, b: Pose, t: number): Pose {
  const out = { ...a };
  for (const k of Object.keys(a) as (keyof Pose)[]) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export const with_ = (base: Pose, patch: Partial<Pose>): Pose => ({ ...base, ...patch });

export interface Joints {
  hip: Pt;
  neck: Pt;
  head: Pt;
  fElbow: Pt;
  fHand: Pt;
  bElbow: Pt;
  bHand: Pt;
  fKnee: Pt;
  fFoot: Pt;
  bKnee: Pt;
  bFoot: Pt;
}

export interface Pt {
  x: number;
  y: number;
}

const RAD = Math.PI / 180;

/** Offset for a limb at `deg` from straight down, in world space (y up). */
function down(deg: number, len: number, f: number): Pt {
  return { x: Math.sin(deg * RAD) * len * f, y: -Math.cos(deg * RAD) * len };
}
function up(deg: number, len: number, f: number): Pt {
  return { x: Math.sin(deg * RAD) * len * f, y: Math.cos(deg * RAD) * len };
}
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });

/** Where every joint is, in world space, for a fighter standing at (x, y). */
export function joints(p: Pose, x: number, y: number, facing: number): Joints {
  const f = facing;
  const hip = { x: x + p.hx * f, y: y + p.hip };
  const neck = add(hip, up(p.torso, LEN.torso, f));
  const head = add(neck, up(p.torso + p.head, LEN.neck + LEN.head, f));
  const fElbow = add(neck, down(p.fs, LEN.upper, f));
  const fHand = add(fElbow, down(p.fs + p.fe, LEN.fore, f));
  const bElbow = add(neck, down(p.bs, LEN.upper, f));
  const bHand = add(bElbow, down(p.bs + p.be, LEN.fore, f));
  const fKnee = add(hip, down(p.fh, LEN.thigh, f));
  const fFoot = add(fKnee, down(p.fh + p.fk, LEN.shin, f));
  const bKnee = add(hip, down(p.bh, LEN.thigh, f));
  const bFoot = add(bKnee, down(p.bh + p.bk, LEN.shin, f));
  const j: Joints = { hip, neck, head, fElbow, fHand, bElbow, bHand, fKnee, fFoot, bKnee, bFoot };

  if (p.rot) {
    // Tipping backward means rotating away from the facing direction.
    const a = -p.rot * RAD * f;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const k of Object.keys(j) as (keyof Joints)[]) {
      const q = j[k];
      const dx = q.x - hip.x;
      const dy = q.y - hip.y;
      j[k] = { x: hip.x + dx * c - dy * s, y: hip.y + dx * s + dy * c };
    }
  }
  return j;
}

/** The segments of a figure, back limbs first so the front ones draw over. */
export type Bone = [keyof Joints, keyof Joints, 'back' | 'body' | 'front'];
export const BONES: Bone[] = [
  ['neck', 'bElbow', 'back'],
  ['bElbow', 'bHand', 'back'],
  ['hip', 'bKnee', 'back'],
  ['bKnee', 'bFoot', 'back'],
  ['hip', 'neck', 'body'],
  ['hip', 'fKnee', 'front'],
  ['fKnee', 'fFoot', 'front'],
  ['neck', 'fElbow', 'front'],
  ['fElbow', 'fHand', 'front'],
];
