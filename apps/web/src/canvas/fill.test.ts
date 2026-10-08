import { describe, expect, it } from 'vitest';
import { fillPixels, floodMask } from './engine.js';

const RED: [number, number, number] = [239, 68, 68];

/** A w×h white image, with `paint` setting grey levels by position. */
function image(w: number, h: number, paint: (x: number, y: number) => number | null): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = paint(x, y);
      if (v === null) continue;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  return d;
}

const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => {
  const i = (y * w + x) * 4;
  return [d[i], d[i + 1], d[i + 2]];
};

describe('flood fill', () => {
  // A black wall down column 10 with a soft edge either side, as a canvas
  // anti-aliases a stroke: 170 then 85 going in, 85 then 170 coming out.
  const W = 24;
  const H = 6;
  const EDGE: Record<number, number> = { 8: 170, 9: 85, 10: 0, 11: 85, 12: 170 };
  const wall = () => image(W, H, (x) => EDGE[x] ?? null);

  it('fills the flat area up to the wall', () => {
    const d = wall();
    expect(fillPixels(d, W, H, 2, 2, RED)).toBe(true);
    expect(px(d, W, 0, 0)).toEqual(RED);
    expect(px(d, W, 7, 5)).toEqual(RED);
  });

  it('blends the edge pixel into the new colour instead of leaving it pale', () => {
    const d = wall();
    fillPixels(d, W, H, 2, 2, RED);
    // 170 is a third of the way from white to black: a third line, two thirds fill.
    const [r, g, b] = px(d, W, 8, 2);
    expect(r).toBe(Math.round((1 / 3) * 0 + (2 / 3) * 239));
    expect(g).toBe(Math.round((2 / 3) * 68));
    expect(b).toBe(g);
    // No grey left: the halo is gone.
    expect(r).not.toBe(g);
  });

  it('touches one ring only, so the line core and the far side are untouched', () => {
    const d = wall();
    fillPixels(d, W, H, 2, 2, RED);
    expect(px(d, W, 9, 2)).toEqual([85, 85, 85]);
    expect(px(d, W, 10, 2)).toEqual([0, 0, 0]);
    expect(px(d, W, 12, 2)).toEqual([170, 170, 170]);
    expect(px(d, W, 20, 2)).toEqual([255, 255, 255]);
  });

  it('does not leak through a closed wall, however soft its edges', () => {
    const d = wall();
    fillPixels(d, W, H, 2, 2, RED);
    for (let y = 0; y < H; y++) for (let x = 13; x < W; x++) expect(px(d, W, x, y)).toEqual([255, 255, 255]);
  });

  it('leaves a flat neighbouring colour alone', () => {
    // A solid blue block to the right, no soft edge: nothing to re-blend.
    const d = new Uint8ClampedArray(W * H * 4).fill(255);
    for (let y = 0; y < H; y++) for (let x = 12; x < W; x++) {
      const i = (y * W + x) * 4;
      d[i] = 59; d[i + 1] = 130; d[i + 2] = 246;
    }
    fillPixels(d, W, H, 2, 2, RED);
    expect(px(d, W, 11, 2)).toEqual(RED);
    expect(px(d, W, 12, 2)).toEqual([59, 130, 246]);
  });

  it('does nothing when filling with the colour already there', () => {
    const d = wall();
    expect(fillPixels(d, W, H, 2, 2, [255, 255, 255])).toBe(false);
    expect(px(d, W, 8, 2)).toEqual([170, 170, 170]);
  });
});

describe('the fill preview', () => {
  // Two shapes and a diagonal stroke, soft-edged, on white: regions of every
  // kind, inside and out.
  const W = 60;
  const H = 40;
  const drawing = () =>
    image(W, H, (x, y) => {
      const ring = Math.abs(Math.hypot(x - 15, y - 20) - 10);
      if (ring < 1) return 0;
      if (ring < 2) return 128;
      if ((x === 35 || x === 50) && y >= 8 && y <= 32) return 0;
      if ((y === 8 || y === 32) && x >= 35 && x <= 50) return 0;
      if (Math.abs(x - y - 10) < 1 && x > 52) return 40;
      return null;
    });

  for (const [name, sx, sy] of [['inside the circle', 15, 20], ['inside the box', 42, 20], ['outside both', 2, 2]] as const) {
    it(`covers exactly what the fill floods, ${name}`, () => {
      const before = drawing();
      const mask = floodMask(before, W, H, sx, sy, RED)!;
      expect(mask).not.toBeNull();
      const after = drawing();
      fillPixels(after, W, H, sx, sy, RED);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (mask[i]) {
            expect(px(after, W, x, y)).toEqual(RED);
          } else {
            // Outside it, only the ring of edge pixels the fill re-blends may change.
            const nearMask = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => mask[(y + dy) * W + (x + dx)] === 1));
            if (!nearMask) expect(px(after, W, x, y)).toEqual(px(before, W, x, y));
          }
        }
      }
    });
  }

  it('shows nothing where the fill would change nothing', () => {
    const d = image(10, 10, () => null);
    expect(floodMask(d, 10, 10, 5, 5, [255, 255, 255])).toBeNull();
  });
});
