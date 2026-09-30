import { describe, expect, it } from 'vitest';
import { CELL, PF, type MazeFrame, type MazeMap } from '@pic-game/shared';
import { LOCK_RANGE, inSight, lockOrder, nextLock } from './lock.js';

/** An open room with one wall column down the middle at x = 320..352. */
function room(): MazeMap {
  const cols = 6;
  const rows = 4;
  const w = cols * CELL + 1;
  const h = rows * CELL + 1;
  const walls = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) walls[x] = walls[(h - 1) * w + x] = 1;
  for (let y = 0; y < h; y++) walls[y * w] = walls[y * w + w - 1] = walls[y * w + 10] = 1;
  return { cols, rows, w, h, walls };
}

const player = (x: number, y: number, flags: number = PF.ALIVE): MazeFrame['p'][number] => [x, y, 0, 100, flags, 0, 0, 0, 0, 0, 0, 0];

describe('keyboard lock-on', () => {
  const m = room();
  const me = { x: 100, y: 200 };

  it('sees along open floor, not through a wall', () => {
    expect(inSight(m, 100, 200, 250, 250)).toBe(true);
    expect(inSight(m, 100, 200, 450, 200)).toBe(false);
  });

  it('picks others in sight and in range, nearest first', () => {
    const f: MazeFrame = {
      t: 1, b: [], u: [],
      p: [player(me.x, me.y), player(280, 200), player(160, 260), player(450, 200), player(200, 150, 0), player(250, 250, PF.ALIVE | PF.AWAY)],
    };
    // 0 is us; 3 is behind the wall; 4 is dead; 5 is away.
    expect(lockOrder(m, f, 0, me, false)).toEqual([2, 1]);
    // With Ghost missiles, the one behind the wall counts too.
    expect(lockOrder(m, f, 0, me, true)).toEqual([2, 1, 3]);
  });

  it('leaves out anyone past the range', () => {
    const f: MazeFrame = { t: 1, b: [], u: [], p: [player(me.x, me.y), player(me.x, me.y + LOCK_RANGE + 1)] };
    expect(lockOrder(m, f, 0, me, true)).toEqual([]);
  });

  it('pressing again moves on to the next, and round', () => {
    expect(nextLock([2, 1, 3], null)).toBe(2);
    expect(nextLock([2, 1, 3], 2)).toBe(1);
    expect(nextLock([2, 1, 3], 3)).toBe(2);
    expect(nextLock([2, 1], 7)).toBe(2);
    expect(nextLock([], 2)).toBeNull();
  });
});
