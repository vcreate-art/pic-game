import { LevelBuilder, type Level } from './level.js';

/**
 * The cup, in order: each level leans on one new movement idea. Coordinates
 * are tiles, rows counted from the top. A single jump clears about 3 tiles up
 * or 6 across; a double jump about 5 up; a glide covers about 4 across for
 * every 1 it drops.
 */

/** Runs, hops, the first wall climb, and a gap that needs a glide. */
const grinder = new LevelBuilder(150, 20)
  .floor(0, 26, 16).spawn(3, 15)
  // A pit to jump.
  .floor(30, 22, 16)
  .spikes(36, 15, 2)
  // A saw at head height: walk under it, don't jump.
  .saw(46, 13.5)
  .floor(52, 8, 14)
  .floor(60, 13, 12)
  .checkpoint(62, 11)
  .saw(66.5, 7.5, { to: [66.5, 10.9], period: 1700 })
  // The shaft: a hanging wall on the left, the cliff on the right. Climb it or
  // wall-jump up it.
  .solid(69, 2, 1, 8)
  .floor(73, 18, 4)
  .checkpoint(76, 3)
  .laser(82, 0, 'down', { on: 1000, off: 1400 })
  // The glide: too far to jump, and spikes below.
  .floor(91, 16, 19).spikes(91, 18, 16)
  .floor(107, 6, 10)
  .checkpoint(108, 9)
  .crumble(113, 10, 5)
  .floor(118, 7, 10)
  .cannon(124, 9, -1, { period: 1600 })
  .floor(125, 25, 16)
  .spikes(132, 15, 2)
  .finish(145, 15)
  .build('grinder', 'The Grinder', 5000);

/** Saws everywhere, a wall-jump shaft with a laser across it, crumbling stairs. */
const sawmill = new LevelBuilder(140, 22)
  .floor(0, 12, 18).spawn(2, 17)
  .solid(15, 16, 4, 1).solid(22, 14, 4, 1).solid(29, 16, 4, 1).solid(36, 14, 4, 1)
  .saw(20.5, 11, { to: [20.5, 16.5], period: 1800 })
  .saw(34.5, 11.5, { to: [34.5, 17], period: 1500, offset: 700 })
  .floor(43, 15, 18)
  .checkpoint(45, 17)
  .saw(49, 16.9, { to: [55, 16.9], r: 1.1, period: 2600 })
  .floor(58, 5, 18)
  .solid(58, 4, 1, 12)
  .floor(63, 20, 6)
  .laser(58, 10, 'right', { on: 900, off: 1500 })
  .checkpoint(65, 5)
  .saw(70, 4.9, { to: [79, 4.9], r: 0.9, period: 2200 })
  .crumble(85, 8, 3).crumble(90, 10, 3).crumble(95, 12, 3)
  .floor(100, 40, 18)
  .checkpoint(102, 17)
  .spikes(108, 17, 3).spikes(118, 17, 3)
  .saw(125, 14, { to: [125, 16.8], period: 1200 })
  .cannon(137, 17, -1, { period: 1400 })
  .cannon(137, 15, -1, { period: 1400, offset: 700 })
  .finish(133, 17)
  .build('sawmill', 'Saw Mill', 5000);

/** A laser gauntlet, a staircase over a pit, a guarded bridge and a long glide down. */
const tower = new LevelBuilder(160, 24)
  .floor(0, 14, 20).spawn(2, 19)
  .floor(14, 30, 20)
  .solid(14, 9, 30, 1)
  .laser(18, 9, 'down', { on: 700, off: 1100, offset: 0 })
  .laser(24, 9, 'down', { on: 700, off: 1100, offset: 450 })
  .laser(30, 9, 'down', { on: 700, off: 1100, offset: 900 })
  .laser(36, 9, 'down', { on: 700, off: 1100, offset: 1350 })
  .floor(44, 6, 20)
  .checkpoint(46, 19)
  .solid(52, 17, 2, 1).solid(56, 14, 2, 1).solid(52, 11, 2, 1).solid(56, 8, 2, 1)
  .solid(60, 7, 20, 1)
  .saw(64, 5.8, { to: [76, 5.8], r: 0.9, period: 3000 })
  .cannon(79, 6, -1, { period: 1300 })
  .floor(80, 26, 23).spikes(80, 22, 26)
  .floor(106, 54, 16)
  .checkpoint(108, 15)
  .clear(120, 16, 8, 8)
  .crumble(120, 16, 8)
  .saw(135, 14.9, { to: [143, 14.9], r: 1.1, period: 2400 })
  .cannon(150, 15, -1, { period: 1100 })
  .finish(155, 15)
  .build('tower', 'Burner Tower', 6000);

export const LEVELS: readonly Level[] = [grinder, sawmill, tower];
