import { LOGICAL_W, LOGICAL_H, QUANT } from './types.js';

/** Logical pixels -> 12-bit wire ints. Halves payload size versus floats and
 *  guarantees every client dequantizes to bit-identical coordinates. */
export function quantize(x: number, y: number): [number, number] {
  const qx = Math.round((clamp(x, 0, LOGICAL_W) / LOGICAL_W) * QUANT);
  const qy = Math.round((clamp(y, 0, LOGICAL_H) / LOGICAL_H) * QUANT);
  return [qx, qy];
}

export function dequantize(qx: number, qy: number): [number, number] {
  return [(qx / QUANT) * LOGICAL_W, (qy / QUANT) * LOGICAL_H];
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Points arrive as a flat array to keep JSON small; this walks it in pairs. */
export function* pairs(pts: readonly number[]): Generator<[number, number]> {
  for (let i = 0; i + 1 < pts.length; i += 2) {
    yield [pts[i]!, pts[i + 1]!];
  }
}

export function isValidQuantPoint(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= QUANT;
}

/** Never trust a client's point array — it arrives straight off the wire. */
export function sanitizePoints(pts: unknown, max = 4096): number[] | null {
  if (!Array.isArray(pts) || pts.length === 0 || pts.length % 2 !== 0) return null;
  if (pts.length > max * 2) return null;
  for (const p of pts) if (!isValidQuantPoint(p)) return null;
  return pts as number[];
}
