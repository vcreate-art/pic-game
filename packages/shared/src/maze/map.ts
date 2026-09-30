import { CELL, CELL_FLOOR, MAZE_TILE } from './types.js';

/** A small seeded generator (mulberry32), so every client builds the same maze
 *  from the seed the server sends. */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MazeMap {
  /** Size in maze cells. */
  cols: number;
  rows: number;
  /** Size in tiles: each cell is CELL_FLOOR tiles of floor plus a wall. */
  w: number;
  h: number;
  /** 1 for wall, row-major by tile. */
  walls: Uint8Array;
}

/** How big a maze for this many players: roomier the more there are. */
export function mazeSize(players: number): { cols: number; rows: number } {
  const cols = 10 + Math.max(2, Math.min(10, players));
  return { cols, rows: Math.round(cols * 0.7) };
}

export const worldW = (m: MazeMap) => m.w * MAZE_TILE;
export const worldH = (m: MazeMap) => m.h * MAZE_TILE;

/** Whether the tile at (tx, ty) is wall. Off the map counts as wall. */
export function wallAt(m: MazeMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return true;
  return m.walls[ty * m.w + tx] === 1;
}

/** Whether the world point (x, y) is inside a wall. */
export const mazeSolidAt =(m: MazeMap, x: number, y: number): boolean =>
  wallAt(m, Math.floor(x / MAZE_TILE), Math.floor(y / MAZE_TILE));

/** The middle of a cell in world units: always open floor, with room round it. */
export function cellCentre(c: number, r: number): [number, number] {
  return [(c * CELL + 1 + CELL_FLOOR / 2) * MAZE_TILE, (r * CELL + 1 + CELL_FLOOR / 2) * MAZE_TILE];
}

/**
 * Builds the maze.
 *
 * Starts as a perfect maze (a random depth-first walk, one path between any
 * two cells), which is a poor arena: every chase ends in a dead end. So most
 * dead ends are knocked through, a scattering of other walls go too, and a few
 * two-by-two blocks are opened into rooms, pillars and all. What is left has
 * loops everywhere and places to fight in the open.
 */
export function generateMaze(seed: number, cols: number, rows: number): MazeMap {
  const rng = seededRng(seed);
  const pick = (n: number) => Math.floor(rng() * n);
  // Passages between cells: east[c,r] opens (c,r)-(c+1,r); south opens (c,r)-(c,r+1).
  const east = new Uint8Array(cols * rows);
  const south = new Uint8Array(cols * rows);
  const at = (c: number, r: number) => r * cols + c;

  const seen = new Uint8Array(cols * rows);
  const stack: [number, number][] = [[pick(cols), pick(rows)]];
  seen[at(...stack[0]!)] = 1;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1]!;
    const next: [number, number][] = [];
    if (c > 0 && !seen[at(c - 1, r)]) next.push([c - 1, r]);
    if (c < cols - 1 && !seen[at(c + 1, r)]) next.push([c + 1, r]);
    if (r > 0 && !seen[at(c, r - 1)]) next.push([c, r - 1]);
    if (r < rows - 1 && !seen[at(c, r + 1)]) next.push([c, r + 1]);
    if (!next.length) {
      stack.pop();
      continue;
    }
    const [nc, nr] = next[pick(next.length)]!;
    open(c, r, nc, nr);
    seen[at(nc, nr)] = 1;
    stack.push([nc, nr]);
  }

  function open(c: number, r: number, nc: number, nr: number): void {
    if (nr === r) east[at(Math.min(c, nc), r)] = 1;
    else south[at(c, Math.min(r, nr))] = 1;
  }
  const links = (c: number, r: number) =>
    (c > 0 && east[at(c - 1, r)] ? 1 : 0) + (c < cols - 1 && east[at(c, r)] ? 1 : 0)
    + (r > 0 && south[at(c, r - 1)] ? 1 : 0) + (r < rows - 1 && south[at(c, r)] ? 1 : 0);

  // Braid: most dead ends get a second way out.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (links(c, r) !== 1 || rng() > 0.8) continue;
      const shut: [number, number][] = [];
      if (c > 0 && !east[at(c - 1, r)]) shut.push([c - 1, r]);
      if (c < cols - 1 && !east[at(c, r)]) shut.push([c + 1, r]);
      if (r > 0 && !south[at(c, r - 1)]) shut.push([c, r - 1]);
      if (r < rows - 1 && !south[at(c, r)]) shut.push([c, r + 1]);
      if (shut.length) open(c, r, ...shut[pick(shut.length)]!);
    }
  }
  // And a scattering of other walls, for more ways round.
  for (let i = 0; i < Math.round(cols * rows * 0.08); i++) {
    const c = pick(cols - 1);
    const r = pick(rows - 1);
    if (rng() < 0.5) east[at(c, r)] = 1;
    else south[at(c, r)] = 1;
  }

  const w = cols * CELL + 1;
  const h = rows * CELL + 1;
  const walls = new Uint8Array(w * h).fill(1);
  const carve = (tx: number, ty: number) => {
    if (tx > 0 && ty > 0 && tx < w - 1 && ty < h - 1) walls[ty * w + tx] = 0;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c * CELL + 1;
      const y0 = r * CELL + 1;
      for (let dy = 0; dy < CELL_FLOOR; dy++) for (let dx = 0; dx < CELL_FLOOR; dx++) carve(x0 + dx, y0 + dy);
      if (c < cols - 1 && east[at(c, r)]) for (let dy = 0; dy < CELL_FLOOR; dy++) carve(x0 + CELL_FLOOR, y0 + dy);
      if (r < rows - 1 && south[at(c, r)]) for (let dx = 0; dx < CELL_FLOOR; dx++) carve(x0 + dx, y0 + CELL_FLOOR);
    }
  }

  // Rooms: a two-by-two block of cells opened right up, pillar included.
  const rooms = Math.max(2, Math.round((cols * rows) / 60));
  for (let i = 0; i < rooms; i++) {
    const c = pick(cols - 1);
    const r = pick(rows - 1);
    for (let ty = r * CELL + 1; ty < (r + 2) * CELL; ty++) {
      for (let tx = c * CELL + 1; tx < (c + 2) * CELL; tx++) carve(tx, ty);
    }
  }

  return { cols, rows, w, h, walls };
}
