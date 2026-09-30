import { MAZE_TILE, wallAt, type MazeMap } from '@pic-game/shared';

/**
 * How far along one ray you can see from (x, y) before a wall: a walk
 * through the tile grid, one tile edge at a time (a DDA), so no wall is
 * stepped over however thin the angle.
 */
function ray(m: MazeMap, x: number, y: number, a: number, range: number): number {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let tx = Math.floor(x / MAZE_TILE);
  let ty = Math.floor(y / MAZE_TILE);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const deltaX = Math.abs(MAZE_TILE / (dx || 1e-9));
  const deltaY = Math.abs(MAZE_TILE / (dy || 1e-9));
  let sideX = ((dx > 0 ? (tx + 1) * MAZE_TILE - x : x - tx * MAZE_TILE) / MAZE_TILE) * deltaX;
  let sideY = ((dy > 0 ? (ty + 1) * MAZE_TILE - y : y - ty * MAZE_TILE) / MAZE_TILE) * deltaY;
  for (;;) {
    let dist: number;
    if (sideX < sideY) {
      dist = sideX;
      sideX += deltaX;
      tx += stepX;
    } else {
      dist = sideY;
      sideY += deltaY;
      ty += stepY;
    }
    if (dist >= range) return range;
    if (wallAt(m, tx, ty)) return dist;
  }
}

/**
 * What can be seen from (x, y): the outline where rays round the circle
 * first meet a wall, out to `range`. Points are in world coordinates.
 */
export function visibility(m: MazeMap, x: number, y: number, range: number, rays = 360): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    // A little way into the wall, so the lit face of the wall itself shows.
    const d = Math.min(range, ray(m, x, y, a, range) + 10);
    out.push([x + Math.cos(a) * d, y + Math.sin(a) * d]);
  }
  return out;
}

export interface Light {
  x: number;
  y: number;
  r: number;
  /** 0 to 1: how fully it cuts through the dark at its centre. */
  k: number;
}
