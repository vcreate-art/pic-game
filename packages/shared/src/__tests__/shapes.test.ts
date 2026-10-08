import { describe, expect, it } from 'vitest';
import { dequantize, quantize } from '../protocol.js';
import { recognizeShape } from '../shapes.js';

/** A stroke from logical points, as the wire carries it. */
const wire = (ps: [number, number][]) => ps.flatMap(([x, y]) => quantize(x, y));
/** A deterministic wobble, so the tests don't depend on chance. */
const wobble = (i: number, amount: number) => Math.sin(i * 1.7) * amount;

function line(from: [number, number], to: [number, number], jitter: number, n = 40): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [from[0] + (to[0] - from[0]) * t + wobble(i, jitter), from[1] + (to[1] - from[1]) * t + wobble(i + 3, jitter)];
  });
}

/** A loop as a hand draws one: lumpy (a few gentle bulges, `lumps` of its
 *  size), with a little jitter on top. */
function loop(cx: number, cy: number, a: number, b: number, opts: { lumps?: number; turns?: number; tilt?: number; n?: number } = {}) {
  const { lumps = 0, turns = 1, tilt = 0, n = 60 } = opts;
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * turns * 2 * Math.PI;
    const r = 1 + lumps * Math.sin(3 * t + 1) + (lumps / 2) * Math.sin(5 * t) + wobble(i, 0.01);
    const u = a * r * Math.cos(t);
    const v = b * r * Math.sin(t);
    return [cx + u * Math.cos(tilt) - v * Math.sin(tilt), cy + u * Math.sin(tilt) + v * Math.cos(tilt)] as [number, number];
  });
}

describe('shape snapping', () => {
  it('reads a wobbly stroke as a straight line, end to end', () => {
    const s = recognizeShape(wire(line([100, 100], [500, 300], 5)));
    expect(s?.kind).toBe('line');
    expect(s!.pts).toHaveLength(4);
    // From where the stroke began to where it ended, wobble and all.
    const [ax, ay] = dequantize(s!.pts[0]!, s!.pts[1]!);
    const [bx, by] = dequantize(s!.pts[2]!, s!.pts[3]!);
    for (const [got, want] of [[ax, 100], [ay, 100], [bx, 500], [by, 300]] as const) expect(Math.abs(got - want)).toBeLessThan(6);
  });

  it('leaves a curve, a zigzag and a short mark alone', () => {
    const arc = loop(400, 300, 200, 200, { turns: 0.3 });
    expect(recognizeShape(wire(arc))).toBeNull();
    const zigzag = Array.from({ length: 20 }, (_, i) => [100 + i * 20, i % 2 ? 100 : 160] as [number, number]);
    expect(recognizeShape(wire(zigzag))).toBeNull();
    expect(recognizeShape(wire(line([100, 100], [115, 110], 0)))).toBeNull();
    // Back and forth along one line is a scribble, not a line.
    expect(recognizeShape(wire([...line([100, 100], [400, 100], 1), ...line([400, 100], [150, 100], 1)]))).toBeNull();
  });

  it('reads a rough loop as a circle, centred where it was drawn', () => {
    const s = recognizeShape(wire(loop(400, 300, 120, 115, { lumps: 0.08 })));
    expect(s?.kind).toBe('circle');
    const ps = [];
    for (let i = 0; i + 1 < s!.pts.length; i += 2) ps.push(dequantize(s!.pts[i]!, s!.pts[i + 1]!));
    const cx = ps.reduce((n, p) => n + p[0], 0) / ps.length;
    const cy = ps.reduce((n, p) => n + p[1], 0) / ps.length;
    expect(Math.abs(cx - 400)).toBeLessThan(6);
    expect(Math.abs(cy - 300)).toBeLessThan(6);
    // Closed: it ends where it starts.
    expect(s!.pts.slice(-2)).toEqual(s!.pts.slice(0, 2));
  });

  it('reads lumpy and small circles too', () => {
    expect(recognizeShape(wire(loop(400, 300, 120, 110, { lumps: 0.12 })))?.kind).toBe('circle');
    expect(recognizeShape(wire(loop(400, 300, 40, 38, { lumps: 0.08 })))?.kind).toBe('circle');
  });

  it('reads a circle drawn as a finger draws one: uneven speed, then a held end', () => {
    // Slow through one side and fast through the other...
    const uneven = Array.from({ length: 60 }, (_, i) => {
      const u = i / 59;
      const t = (u + 0.12 * Math.sin(2 * Math.PI * u)) * 2 * Math.PI;
      const k = 1 + 0.06 * Math.sin(3 * t + 1);
      return [400 + 120 * k * Math.cos(t), 300 + 120 * k * Math.sin(t)] as [number, number];
    });
    // ...then held at the end, a fingertip wandering a few px for half a second.
    const [ex, ey] = uneven[uneven.length - 1]!;
    const held = Array.from({ length: 40 }, (_, i) => [ex + Math.sin(i * 2.1) * 2, ey + Math.cos(i * 1.7) * 2] as [number, number]);
    expect(recognizeShape(wire([...uneven, ...held]))?.kind).toBe('circle');
  });

  it('reads a long loop as an ellipse, tilt and all', () => {
    expect(recognizeShape(wire(loop(400, 300, 200, 90, { lumps: 0.05 })))?.kind).toBe('ellipse');
    expect(recognizeShape(wire(loop(400, 300, 200, 90, { lumps: 0.05, tilt: 0.6 })))?.kind).toBe('ellipse');
    expect(recognizeShape(wire(loop(400, 300, 300, 50, { lumps: 0.03 })))?.kind).toBe('ellipse');
  });

  it('takes a loop that overshoots or stops a little short', () => {
    expect(recognizeShape(wire(loop(400, 300, 100, 100, { turns: 1.1 })))?.kind).toBe('circle');
    expect(recognizeShape(wire(loop(400, 300, 100, 100, { turns: 0.9 })))?.kind).toBe('circle');
  });

  it('leaves an open curve, a lumpy loop, and shapes with corners alone', () => {
    expect(recognizeShape(wire(loop(400, 300, 100, 100, { turns: 0.6 })))).toBeNull();
    expect(recognizeShape(wire(loop(400, 300, 120, 120, { lumps: 0.4 })))).toBeNull();
    const square: [number, number][] = [
      ...line([200, 200], [400, 200], 0, 15), ...line([400, 200], [400, 400], 0, 15),
      ...line([400, 400], [200, 400], 0, 15), ...line([200, 400], [200, 200], 0, 15),
    ];
    expect(recognizeShape(wire(square))).toBeNull();
    const shaky: [number, number][] = [
      ...line([200, 200], [400, 200], 3, 15), ...line([400, 200], [400, 400], 3, 15),
      ...line([400, 400], [200, 400], 3, 15), ...line([200, 400], [200, 200], 3, 15),
    ];
    expect(recognizeShape(wire(shaky))).toBeNull();
    const rect: [number, number][] = [
      ...line([200, 200], [500, 200], 0, 15), ...line([500, 200], [500, 320], 0, 15),
      ...line([500, 320], [200, 320], 0, 15), ...line([200, 320], [200, 200], 0, 15),
    ];
    expect(recognizeShape(wire(rect))).toBeNull();
    const triangle: [number, number][] = [
      ...line([400, 150], [550, 400], 0, 15), ...line([550, 400], [250, 400], 0, 15), ...line([250, 400], [400, 150], 0, 15),
    ];
    expect(recognizeShape(wire(triangle))).toBeNull();
  });
});
