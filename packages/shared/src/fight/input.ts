import type { Dir } from './fighters.js';
import { BTN } from './types.js';

/**
 * Direction as a numpad digit, relative to facing: 6 is forward, 4 back,
 * 2 down, 8 up, 5 neutral, and the corners in between. Fighting games have
 * written motions this way for thirty years because it makes "forward" mean
 * the same thing from either side of the screen.
 */
export type Numpad = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export function numpad(held: number, facing: 1 | -1): Numpad {
  const left = (held & BTN.LEFT) !== 0;
  const right = (held & BTN.RIGHT) !== 0;
  // Both at once cancel out, as on a stick you cannot hold both.
  const h = left === right ? 0 : right ? 1 : -1;
  const fwd = h * facing;
  const up = (held & BTN.UP) !== 0;
  const down = (held & BTN.DOWN) !== 0;
  const v = up === down ? 0 : up ? 1 : -1;
  return (5 + fwd + v * 3) as Numpad;
}

export const isDown = (d: Numpad) => d <= 3;
export const isUp = (d: Numpad) => d >= 7;
export const isForward = (d: Numpad) => d % 3 === 0;
export const isBack = (d: Numpad) => d % 3 === 1;

/** How long a history is kept: long enough for a fatality, entered slowly. */
export const HISTORY = 90;
/** A special's motion must fit in this many frames. */
export const MOTION_WINDOW = 15;
/** A fatality's motion, entered deliberately over a dizzy opponent. */
export const FATALITY_WINDOW = 60;

export interface InputHistory {
  /** Relative direction per tick, oldest first, at most HISTORY long. */
  dirs: Numpad[];
}

export function newHistory(): InputHistory {
  return { dirs: [] };
}

export function record(h: InputHistory, dir: Numpad): void {
  h.dirs.push(dir);
  if (h.dirs.length > HISTORY) h.dirs.shift();
}

function matches(token: Dir, d: Numpad): boolean {
  switch (token) {
    // Forward and back are strict: a down-forward on the way through a
    // quarter circle should not count as a forward tap.
    case 'F': return d === 6;
    case 'B': return d === 4;
    case 'D': return isDown(d);
    case 'U': return isUp(d);
  }
}

/**
 * Whether the motion was entered within the last `window` ticks.
 *
 * A token matches a change of direction, not a held one: walking forward for
 * a second and pressing 1 is not "forward + 1". The exception is the first
 * direction of a longer motion, which may already be held: backing off and
 * then going forward + 1 is exactly how a spear gets thrown. The tokens are
 * matched in order as a subsequence, so passing through neutral or a diagonal
 * in between is allowed.
 */
export function matchMotion(h: InputHistory, motion: readonly Dir[], window = MOTION_WINDOW): boolean {
  const start = Math.max(0, h.dirs.length - window);
  let i = 0;
  for (let k = start; k < h.dirs.length && i < motion.length; k++) {
    const d = h.dirs[k]!;
    const prev = k > 0 ? h.dirs[k - 1]! : 5;
    const entered = d !== prev || (i === 0 && motion.length > 1);
    if (entered && matches(motion[i]!, d)) i++;
  }
  return i === motion.length;
}
