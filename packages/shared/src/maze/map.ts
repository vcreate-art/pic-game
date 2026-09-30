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

/** What a tile is. Wall and cover both stop players and bullets; they
 *  differ only in how a theme draws them. */
export const TILE_KIND = { FLOOR: 0, WALL: 1, COVER: 2 } as const;

/** An opened-up area, in tiles, for themes to decorate. */
export interface MazeRoom {
  x: number;
  y: number;
  w: number;
  h: number;
  arena: boolean;
}

export interface MazeMap {
  /** Size in maze cells. */
  cols: number;
  rows: number;
  /** Size in tiles: each cell is CELL_FLOOR tiles of floor plus a wall. */
  w: number;
  h: number;
  /** TILE_KIND per tile, row-major. */
  walls: Uint8Array;
  rooms?: MazeRoom[];
}

/** How big a maze for this many players: roomier the more there are. */
export function mazeSize(players: number): { cols: number; rows: number } {
  const cols = 10 + Math.max(2, Math.min(10, players));
  return { cols, rows: Math.round(cols * 0.7) };
}

export const worldW = (m: MazeMap) => m.w * MAZE_TILE;
export const worldH = (m: MazeMap) => m.h * MAZE_TILE;

/** Whether the tile at (tx, ty) is solid: wall or cover. Off the map counts. */
export function wallAt(m: MazeMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return true;
  return m.walls[ty * m.w + tx] !== TILE_KIND.FLOOR;
}

/** What the tile at (tx, ty) is. Off the map is wall. */
export function mazeTileAt(m: MazeMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return TILE_KIND.WALL;
  return m.walls[ty * m.w + tx]!;
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
 * dead ends are knocked through and a scattering of other walls go too. Then
 * open ground: an arena in the middle and rooms around the map, each opened
 * right up and given cover (crates where the old cell corners stood, and
 * some along the old cell walls) to fight round. What is left has loops
 * everywhere, corridors to stalk down and rooms to hold.
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

  const rooms: MazeRoom[] = [];
  const room = (c0: number, r0: number, cw: number, rh: number, arena: boolean) => {
    const x = c0 * CELL + 1;
    const y = r0 * CELL + 1;
    const rw = cw * CELL - 1;
    const rhT = rh * CELL - 1;
    for (let ty = y; ty < y + rhT; ty++) for (let tx = x; tx < x + rw; tx++) carve(tx, ty);
    rooms.push({ x, y, w: rw, h: rhT, arena });
    // Cover on the lines where the cell walls were: never on a cell's middle
    // three tiles across, so the lanes through stay open.
    const put = (tx: number, ty: number) => {
      if (tx > 0 && ty > 0 && tx < w - 1 && ty < h - 1) walls[ty * w + tx] = TILE_KIND.COVER;
    };
    for (let r = r0; r < r0 + rh; r++) {
      for (let c = c0; c < c0 + cw; c++) {
        const jx = (c + 1) * CELL;
        const jy = (r + 1) * CELL;
        const inX = c < c0 + cw - 1;
        const inY = r < r0 + rh - 1;
        if (inX && inY && rng() < 0.55) put(jx, jy);
        if (inX && rng() < 0.25) put(jx, r * CELL + 2);
        if (inY && rng() < 0.25) put(c * CELL + 2, jy);
      }
    }
  };

  // The arena, in the middle.
  const aw = Math.max(2, Math.min(4, Math.floor(cols / 3)));
  const ah = Math.max(2, Math.min(3, Math.floor(rows / 3)));
  room(Math.floor((cols - aw) / 2), Math.floor((rows - ah) / 2), aw, ah, true);
  // Rooms, scattered.
  const count = Math.max(2, Math.round((cols * rows) / 45));
  for (let i = 0; i < count; i++) {
    const cw = 2 + pick(2);
    const rh = 2 + pick(2);
    room(pick(cols - cw + 1), pick(rows - rh + 1), cw, rh, false);
  }

  const m: MazeMap = { cols, rows, w, h, walls, rooms };
  unblock(m);
  return m;
}

/**
 * Makes sure every open tile can be reached. Cover sits off the lanes, so this
 * should never find anything; if it does, it lifts the cover beside whatever
 * was cut off, a piece at a time, until nothing is.
 */
function unblock(m: MazeMap): void {
  const [sx, sy] = cellCentre(0, 0).map((v) => Math.floor(v / MAZE_TILE)) as [number, number];
  for (let pass = 0; pass < 50; pass++) {
    const seen = new Uint8Array(m.w * m.h);
    const todo = [sy * m.w + sx];
    seen[todo[0]!] = 1;
    while (todo.length) {
      const i = todo.pop()!;
      const x = i % m.w;
      const y = (i - x) / m.w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n = (y + dy) * m.w + x + dx;
        if (seen[n] || wallAt(m, x + dx, y + dy)) continue;
        seen[n] = 1;
        todo.push(n);
      }
    }
    let lifted = false;
    for (let i = 0; i < m.walls.length; i++) {
      if (m.walls[i] !== TILE_KIND.FLOOR || seen[i]) continue;
      const x = i % m.w;
      for (const n of [i - 1, i + 1, i - m.w, i + m.w]) {
        if (m.walls[n] === TILE_KIND.COVER && (n % m.w === x || Math.abs((n % m.w) - x) === 1)) {
          m.walls[n] = TILE_KIND.FLOOR;
          lifted = true;
        }
      }
    }
    if (!lifted) return;
  }
}
