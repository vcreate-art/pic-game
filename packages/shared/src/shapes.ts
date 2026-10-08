import { LOGICAL_H, LOGICAL_W } from './types.js';
import { dequantize, quantize } from './protocol.js';

/**
 * Shape snapping, as Apple Notes does it: a stroke held still at its end is
 * read as a straight line, a circle or an ellipse if it's close enough to
 * one, and swapped for a clean one. Points are the wire's flat quantized
 * pairs in and out; the reading is done on the logical canvas, 800 × 600.
 */

export type SnapKind = 'line' | 'circle' | 'ellipse';

export interface SnapShape {
  kind: SnapKind;
  /** The clean shape's points, flat quantized pairs, ready for the wire. */
  pts: number[];
}

/** Shorter than this, in logical px, and a stroke is a mark, not a shape. */
const MIN_SPAN = 30;
/** A line may stray from its chord by this much of its length, at least
 *  LINE_SLACK_MIN px: a hand's wobble, not a curve. */
const LINE_SLACK = 0.07;
const LINE_SLACK_MIN = 6;
/** ...and its path may run at most this much longer than the chord: no
 *  doubling back. */
const LINE_DETOUR = 1.2;
/** A loop must go this far round its centre (in turns), and end this close
 *  to where it began (as a share of its mean diameter). */
const LOOP_TURNS = 0.85;
const LOOP_GAP = 0.45;
/** How far, on average, its points may sit off the fitted ellipse, as a
 *  share of the ellipse's size. */
const ELLIPSE_FIT = 0.11;
/** A curve can't be traced with a few straight sides: one needing fewer
 *  than this many, each within CORNER_FIT of its shorter side, has corners
 *  (a square, a triangle) and isn't snapped to a round shape. Measured:
 *  circles and ellipses need 9 or more, squares 5 or 6, triangles 4. */
const CURVE_SIDES = 8;
const CORNER_FIT = 0.07;
const CORNER_SAMPLES = 96;
/** Axes within this ratio of each other make a circle. */
const ROUND = 1.18;
/** Points around a snapped ellipse. */
const ELLIPSE_POINTS = 72;

type P = [number, number];

function toLogical(pts: readonly number[]): P[] {
  const out: P[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push(dequantize(pts[i]!, pts[i + 1]!));
  return out;
}

function toWire(ps: readonly P[]): number[] {
  const out: number[] = [];
  for (const [x, y] of ps) {
    const [qx, qy] = quantize(x, y);
    out.push(qx, qy);
  }
  return out;
}

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The stroke as evenly spaced points, so its density doesn't depend on how
 *  fast it was drawn. */
function resample(ps: readonly P[], n: number): P[] {
  const step = pathLength(ps) / (n - 1);
  if (!(step > 0)) return [...ps];
  const out: P[] = [ps[0]!];
  let carried = 0;
  for (let i = 1; i < ps.length && out.length < n; i++) {
    let a = ps[i - 1]!;
    const b = ps[i]!;
    let d = dist(a, b);
    while (carried + d >= step && out.length < n) {
      const t = (step - carried) / d;
      a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(a);
      d = dist(a, b);
      carried = 0;
    }
    carried += d;
  }
  if (out.length < n) out.push(ps[ps.length - 1]!);
  return out;
}

/** How many points it takes to trace the stroke with straight sides, none
 *  straying more than `within` from it (Douglas–Peucker). */
function straightSides(ps: readonly P[], within: number): number {
  const keep = new Array<boolean>(ps.length).fill(false);
  keep[0] = keep[ps.length - 1] = true;
  const split = (i: number, j: number) => {
    const a = ps[i]!;
    const b = ps[j]!;
    const len = dist(a, b) || 1;
    let far = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const p = ps[k]!;
      const off = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
      if (off > far) [far, at] = [off, k];
    }
    if (far > within) {
      keep[at] = true;
      split(i, at);
      split(at, j);
    }
  };
  // A loop ends where it began, and a side from a point to itself measures
  // nothing: start from the point farthest from the start, two halves.
  let far = 0;
  for (let k = 1; k < ps.length; k++) if (dist(ps[0]!, ps[k]!) > dist(ps[0]!, ps[far]!)) far = k;
  if (far > 0 && far < ps.length - 1) {
    keep[far] = true;
    split(0, far);
    split(far, ps.length - 1);
  } else {
    split(0, ps.length - 1);
  }
  return keep.filter(Boolean).length;
}

function pathLength(ps: readonly P[]): number {
  let n = 0;
  for (let i = 1; i < ps.length; i++) n += dist(ps[i - 1]!, ps[i]!);
  return n;
}

function asLine(ps: readonly P[]): SnapShape | null {
  const a = ps[0]!;
  const b = ps[ps.length - 1]!;
  const chord = dist(a, b);
  if (chord < MIN_SPAN) return null;
  if (pathLength(ps) > chord * LINE_DETOUR) return null;
  const slack = Math.max(LINE_SLACK_MIN, chord * LINE_SLACK);
  const [dx, dy] = [(b[0] - a[0]) / chord, (b[1] - a[1]) / chord];
  for (const p of ps) {
    const off = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx);
    if (off > slack) return null;
  }
  return { kind: 'line', pts: toWire([a, b]) };
}

function asEllipse(ps: readonly P[]): SnapShape | null {
  const n = ps.length;
  if (n < 8) return null;
  const cx = ps.reduce((s, p) => s + p[0], 0) / n;
  const cy = ps.reduce((s, p) => s + p[1], 0) / n;

  // Its spread: the axes come from the covariance's eigenvectors, and for
  // points spread evenly round an ellipse each axis's variance is half its
  // semi-axis squared.
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of ps) {
    sxx += (x - cx) ** 2;
    syy += (y - cy) ** 2;
    sxy += (x - cx) * (y - cy);
  }
  sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy;
  const root = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
  const l1 = tr / 2 + root;
  const l2 = tr / 2 - root;
  if (l2 <= 0) return null;
  let a = Math.sqrt(2 * l1);
  let b = Math.sqrt(2 * l2);
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (2 * b < MIN_SPAN / 2 || 2 * a < MIN_SPAN) return null;

  // A loop: round its centre most of the way, ending near its start.
  let turned = 0;
  for (let i = 1; i < n; i++) {
    const t0 = Math.atan2(ps[i - 1]![1] - cy, ps[i - 1]![0] - cx);
    const t1 = Math.atan2(ps[i]![1] - cy, ps[i]![0] - cx);
    let d = t1 - t0;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
  }
  if (Math.abs(turned) / (2 * Math.PI) < LOOP_TURNS) return null;
  if (dist(ps[0]!, ps[n - 1]!) > LOOP_GAP * (a + b)) return null;

  // And close to the ellipse all the way round.
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let off = 0;
  for (const [x, y] of ps) {
    const u = (x - cx) * cos + (y - cy) * sin;
    const v = -(x - cx) * sin + (y - cy) * cos;
    off += Math.abs(Math.hypot(u / a, v / b) - 1);
  }
  if (off / n > ELLIPSE_FIT) return null;

  // Round all the way, not a few straight sides with corners.
  const xs = ps.map((p) => p[0]);
  const ys = ps.map((p) => p[1]);
  const shorter = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (straightSides(resample(ps, CORNER_SAMPLES), CORNER_FIT * shorter) < CURVE_SIDES) return null;

  const round = a / b <= ROUND;
  if (round) a = b = (a + b) / 2;
  // Begun where the stroke began, and run the way it was drawn, so the snap
  // reads as the same line drawn true rather than a circle spun into place.
  const [sx, sy] = ps[0]!;
  const su = (sx - cx) * cos + (sy - cy) * sin;
  const sv = -(sx - cx) * sin + (sy - cy) * cos;
  const t0 = Math.atan2(sv / b, su / a);
  const way = Math.sign(turned) || 1;
  const out: P[] = [];
  for (let i = 0; i <= ELLIPSE_POINTS; i++) {
    const t = t0 + way * (i / ELLIPSE_POINTS) * 2 * Math.PI;
    const u = a * Math.cos(t);
    const v = b * Math.sin(t);
    out.push([
      Math.min(LOGICAL_W, Math.max(0, cx + u * cos - v * sin)),
      Math.min(LOGICAL_H, Math.max(0, cy + u * sin + v * cos)),
    ]);
  }
  return { kind: round ? 'circle' : 'ellipse', pts: toWire(out) };
}

/** How close, in logical px, the jitter of a held end stays to where the
 *  stroke stopped. */
const HELD_END = 8;
/** Points a stroke is spaced out to before it's read. */
const READ_POINTS = 96;

/**
 * The clean shape a stroke is close to, or null if it's none of them. Read
 * as drawn, not as sampled: the held end's jitter (many points on one spot)
 * is trimmed, and the rest spaced evenly along it, so neither a pause nor a
 * hand slowing through part of a loop pulls its centre or its size.
 */
export function recognizeShape(pts: readonly number[]): SnapShape | null {
  const drawn = toLogical(pts);
  const end = drawn[drawn.length - 1];
  if (!end) return null;
  let last = drawn.length - 1;
  while (last > 0 && dist(drawn[last - 1]!, end) < HELD_END) last--;
  const kept = [...drawn.slice(0, last), end];
  if (kept.length < 3) return null;
  const ps = resample(kept, READ_POINTS);
  return asLine(ps) ?? asEllipse(ps);
}
