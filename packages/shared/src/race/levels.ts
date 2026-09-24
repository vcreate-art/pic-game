import { LevelBuilder, type Level } from './level.js';

/**
 * The cup, in order. Coordinates are tiles, rows counted from the top. A full
 * jump clears about 3.5 tiles up or 6 across; a double jump adds 3 more up;
 * a sprint jump goes 9 across; a glide covers about 4 across for every 1 it
 * drops. Each level's first stretch is written in its own rows and placed
 * with `offset`, which leaves room above it for the climbs.
 */

/** Runs, hops, a wall climb, a glide, then a long shaft up and a staircase down. */
const grinder = new LevelBuilder(232, 42)
  .offset(0, 22)
  .floor(0, 26, 16).spawn(3, 15)
  .floor(30, 22, 16)
  .spikes(36, 15, 2)
  // A saw at head height: walk under it, don't jump.
  .saw(46, 13.5)
  .floor(52, 8, 14)
  .floor(60, 13, 12)
  .checkpoint(62, 11)
  .saw(66.5, 7.5, { to: [66.5, 10.9], period: 1700 })
  // The first climb: a hanging wall on the left, the cliff on the right.
  .solid(69, 2, 1, 8)
  .floor(73, 18, 4)
  // Rock over the cliff top, so the laser cannot be jumped over.
  .solid(73, -22, 18, 22)
  .checkpoint(76, 3)
  .laser(82, 0, 'down', { on: 1000, off: 1400 })
  // The glide: too far to jump, and spikes below.
  .floor(91, 16, 19).spikes(91, 18, 16)
  .floor(107, 6, 10)
  .checkpoint(108, 9)
  .crumble(113, 10, 5)
  .floor(118, 7, 10)
  .cannon(124, 9, -1, { period: 1600 })
  .floor(125, 20, 16)
  .spikes(132, 15, 2)
  .offset(0, 0)
  // The shaft: thirty tiles of wall-jumping, a laser across it half way.
  .floor(145, 4, 38)
  .solid(144, 6, 1, 29)
  .solid(149, 6, 12, 36)
  .checkpoint(146, 37)
  .solid(145, 28).solid(148, 19)
  .laser(144, 23, 'right', { on: 800, off: 1600 })
  .checkpoint(151, 5)
  // Down the steps, between two saws.
  .solid(163, 9, 3, 1).solid(168, 12, 3, 1).solid(173, 15, 3, 1).solid(178, 18, 3, 1)
  .saw(166.5, 8, { to: [166.5, 12], period: 1400 })
  .saw(176.5, 12, { to: [176.5, 17], period: 1300, offset: 500 })
  .floor(161, 22, 41).spikes(161, 40, 22)
  .floor(183, 49, 30)
  .checkpoint(186, 29)
  .saw(192, 28.9, { to: [200, 28.9], r: 1.1, period: 2400 })
  .clear(206, 30, 6, 12).crumble(206, 30, 6)
  .laser(214, 22, 'down', { on: 900, off: 1300, offset: 300 })
  .cannon(229, 29, -1, { period: 1300 })
  .finish(225, 29)
  .path(
    [3, 37], [51, 37], [60, 33], [70, 33, 0.7], [71, 25], [90, 25], [107, 31], [125, 31],
    [130, 37], [146, 37, 0.55], [146, 5], [161, 5], [182, 17], [186, 29], [226, 29],
  )
  .build('grinder', 'The Grinder', 5000);

/** Saws, a laser-crossed shaft, crumbling stairs, then the Drop: a long pipe
 *  with cannons firing across it, taken at a glide, into a hall at the bottom. */
const sawmill = new LevelBuilder(200, 70)
  .floor(0, 12, 18).spawn(2, 17)
  .solid(15, 16, 4, 1).solid(22, 14, 4, 1).solid(29, 16, 4, 1).solid(36, 14, 4, 1)
  .floor(12, 31, 28).spikes(12, 27, 31)
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
  .floor(83, 17, 28).spikes(83, 27, 17)
  .floor(100, 40, 18)
  .checkpoint(102, 17)
  .spikes(108, 17, 3).spikes(118, 17, 3)
  .saw(125, 14, { to: [125, 16.8], period: 1200 })
  .checkpoint(136, 17)
  // The Drop. Rock to the right of it, so there is no way round.
  .solid(147, 0, 53, 46)
  .solid(147, 46, 1, 13)
  .spikes(140, 22, 36, 'right')
  .spikes(146, 22, 36, 'left')
  // Somewhere to stand on the way down.
  .solid(140, 30, 2, 1).solid(145, 40, 2, 1).solid(140, 50, 2, 1)
  .checkpoint(145, 39)
  .cannon(139, 25, 1, { period: 1400 })
  .cannon(147, 28, -1, { period: 1400, offset: 700 })
  .cannon(139, 34, 1, { period: 1200 })
  .cannon(147, 37, -1, { period: 1300, offset: 400 })
  .cannon(139, 44, 1, { period: 1100, offset: 200 })
  .cannon(147, 47, -1, { period: 1100, offset: 750 })
  .cannon(139, 54, 1, { period: 1000 })
  .cannon(147, 56, -1, { period: 1000, offset: 500 })
  // The hall at the bottom: up a stair of ledges, then a glide over spikes.
  .floor(140, 60, 66)
  .checkpoint(143, 65)
  .spikes(150, 65, 3)
  .solid(156, 62, 4, 1).solid(162, 58, 4, 1).solid(168, 54, 4, 1)
  .saw(174, 50, { to: [174, 60], period: 1600 })
  .spikes(176, 65, 10)
  .laser(190, 46, 'down', { on: 900, off: 1300 })
  .finish(195, 65)
  .path(
    [2, 17], [58, 17], [60, 17, 0.7], [61, 5], [83, 5], [100, 17], [143, 17, 0.4], [143, 64], [196, 64],
  )
  .build('sawmill', 'Saw Mill', 5000);

/** A laser gauntlet, a guarded bridge and a glide, then the tower itself:
 *  zigzag ledges up past lasers and saws, and a long glide down through saws. */
const tower = new LevelBuilder(262, 52)
  .offset(0, 28)
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
  .offset(0, 0)
  // The tower: in under the left wall, up the zigzag, out at the top right.
  .floor(160, 22, 44)
  .solid(161, 6, 1, 35)
  .solid(161, 0, 20, 6)
  .solid(181, 0, 1, 6).solid(181, 9, 1, 35)
  .checkpoint(163, 43)
  .solid(162, 40, 5, 1).solid(169, 36, 5, 1).solid(176, 32, 5, 1).solid(169, 28, 5, 1)
  .solid(162, 24, 5, 1).solid(169, 20, 5, 1).solid(176, 16, 5, 1).solid(169, 12, 5, 1)
  .solid(176, 9, 5, 1)
  .laser(161, 30, 'right', { on: 900, off: 1500, offset: 700 })
  .laser(161, 18, 'right', { on: 900, off: 1500 })
  .saw(171.5, 23.5, { to: [171.5, 27], period: 1500 })
  .saw(178, 14.5, { to: [178, 11], period: 1700, offset: 600 })
  .checkpoint(178, 8)
  // The bridge out, and the long glide down through the saws.
  .solid(182, 9, 26, 1)
  .cannon(207, 8, -1, { period: 1200 })
  .floor(208, 28, 51).spikes(208, 50, 28)
  .saw(213, 16, { r: 0.9 }).saw(219, 22, { r: 0.9 }).saw(214, 28, { r: 0.9 })
  .saw(225, 18, { r: 0.9 }).saw(230, 27, { to: [230, 31], r: 0.9, period: 1400 }).saw(222, 34, { r: 0.9 })
  .floor(236, 26, 40)
  .checkpoint(238, 39)
  .laser(246, 30, 'down', { on: 900, off: 1300 })
  .finish(256, 39)
  .path(
    [2, 47], [49, 47], [55, 40], [60, 34], [79, 34], [106, 43], [160, 43], [171, 43, 0.55],
    [171, 8], [181, 8], [207, 8, 0.8], [236, 39], [257, 39],
  )
  .build('tower', 'Burner Tower', 6000);

export const LEVELS: readonly Level[] = [grinder, sawmill, tower];
