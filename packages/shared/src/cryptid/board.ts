import {
  COLS, HEXES, ROWS,
  type Animal, type CryptidBoard, type Shape, type StructColor, type Structure, type Terrain,
} from './types.js';

type Rng = () => number;

// ------------------------------------------------------------------ geometry
//
// Flat-topped hexes in columns, odd columns sitting half a hex lower ("odd-q").
// A hex is its row-major index, r * COLS + c.

export const hexAt = (c: number, r: number): number => r * COLS + c;
export const colOf = (hex: number): number => hex % COLS;
export const rowOf = (hex: number): number => Math.floor(hex / COLS);

/** Column letter and row number, as printed round the map: A1 is top left. */
export function hexLabel(hex: number): string {
  return `${String.fromCharCode(65 + colOf(hex))}${rowOf(hex) + 1}`;
}

function cube(hex: number): [number, number, number] {
  const c = colOf(hex);
  const r = rowOf(hex);
  const x = c;
  const z = r - (c - (c & 1)) / 2;
  return [x, -x - z, z];
}

/** Steps between two spaces. A space is zero from itself. */
export function hexDistance(a: number, b: number): number {
  const [ax, ay, az] = cube(a);
  const [bx, by, bz] = cube(b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

/**
 * Neighbour offsets by side, for even and odd columns. The sides run clockwise
 * from the lower right, matching the corner order a renderer walks (0° is
 * east, and y grows downwards): SE, S, SW, NW, N, NE.
 */
const SIDES_EVEN: readonly [number, number][] = [[1, 0], [0, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const SIDES_ODD: readonly [number, number][] = [[1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, 0]];

/** The space across side `side` (0–5), or null off the edge of the map. */
export function neighbour(hex: number, side: number): number | null {
  const c = colOf(hex);
  const [dc, dr] = (c & 1 ? SIDES_ODD : SIDES_EVEN)[side]!;
  const nc = c + dc;
  const nr = rowOf(hex) + dr;
  return nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS ? null : hexAt(nc, nr);
}

export function neighbours(hex: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < 6; s++) {
    const n = neighbour(hex, s);
    if (n !== null) out.push(n);
  }
  return out;
}

// --------------------------------------------------------------------- tiles
//
// Six tiles of 6×3 spaces, laid two across and three down. Each has a patch of
// one animal's territory. Turning a tile round maps (c, r) to (5 - c, 2 - r),
// which is still a proper hex tile: the column parity flips along with which
// way the columns are staggered.

export const TILE_COLS = 6;
export const TILE_ROWS = 3;

const T: Record<string, Terrain> = { F: 'forest', D: 'desert', W: 'water', S: 'swamp', M: 'mountain' };
const A: Record<string, Animal | null> = { b: 'bear', c: 'cougar', '.': null };

interface Tile {
  terrain: string[];
  animal: string[];
}

export const TILES: readonly Tile[] = [
  { terrain: ['WWWWFF', 'SSWDFF', 'SSDDDF'], animal: ['......', '.b....', 'bb....'] },
  { terrain: ['SFFFFF', 'SSFDDD', 'SMMMMD'], animal: ['......', '....cc', '.....c'] },
  { terrain: ['SSSMMM', 'SSMMWW', 'FFFMWW'], animal: ['...cc.', '...c..', '......'] },
  { terrain: ['DDDWWW', 'MMDWWF', 'MMDFFF'], animal: ['......', '....b.', '....bb'] },
  { terrain: ['FFMMMD', 'FFMDDD', 'WWWWSS'], animal: ['..cc..', '..c...', '......'] },
  { terrain: ['DDSSSW', 'DDSSWW', 'MMMDDW'], animal: ['......', 'b.....', 'bb....'] },
];

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The spaces of the tile in slot `slot` (0–5: left then right, top down). */
export function slotHexes(slot: number): number[] {
  const c0 = (slot % 2) * TILE_COLS;
  const r0 = Math.floor(slot / 2) * TILE_ROWS;
  const out: number[] = [];
  for (let r = 0; r < TILE_ROWS; r++) for (let c = 0; c < TILE_COLS; c++) out.push(hexAt(c0 + c, r0 + r));
  return out;
}

/** Lays the tiles as given: `tiles[slot]` is which tile, and whether it is turned. */
export function layTiles(tiles: { tile: number; flipped: boolean }[]): Pick<CryptidBoard, 'terrain' | 'animal'> {
  const terrain: Terrain[] = Array(HEXES);
  const animal: (Animal | null)[] = Array(HEXES).fill(null);
  tiles.forEach(({ tile, flipped }, slot) => {
    const t = TILES[tile]!;
    const c0 = (slot % 2) * TILE_COLS;
    const r0 = Math.floor(slot / 2) * TILE_ROWS;
    for (let r = 0; r < TILE_ROWS; r++) {
      for (let c = 0; c < TILE_COLS; c++) {
        const sc = flipped ? TILE_COLS - 1 - c : c;
        const sr = flipped ? TILE_ROWS - 1 - r : r;
        const hex = hexAt(c0 + c, r0 + r);
        terrain[hex] = T[t.terrain[sr]![sc]!]!;
        animal[hex] = A[t.animal[sr]![sc]!]!;
      }
    }
  });
  return { terrain, animal };
}

/** The structures in play: stone and shack in each colour, black only in the
 *  advanced game. */
export function structureSet(advanced: boolean): { shape: Shape; color: StructColor }[] {
  const colors: StructColor[] = advanced ? ['white', 'green', 'blue', 'black'] : ['white', 'green', 'blue'];
  return colors.flatMap((color) => (['stone', 'shack'] as const).map((shape) => ({ shape, color })));
}

/** Structures stand at least this far apart, so none crowds another. */
const STRUCT_SPACING = 3;

/**
 * A fresh map: tiles in a random order, each maybe turned round, then the
 * structures scattered one to a tile (the advanced game's extra two land on
 * tiles at random), never too close together.
 */
export function randomBoard(advanced: boolean, rng: Rng): CryptidBoard {
  for (;;) {
    const tiles = shuffle([0, 1, 2, 3, 4, 5], rng).map((tile) => ({ tile, flipped: rng() < 0.5 }));
    const laid = layTiles(tiles);
    const pieces = shuffle(structureSet(advanced), rng);
    const slots = [...shuffle([0, 1, 2, 3, 4, 5], rng), ...shuffle([0, 1, 2, 3, 4, 5], rng)];
    const structures: Structure[] = [];
    let ok = true;
    for (let i = 0; i < pieces.length && ok; i++) {
      const free = slotHexes(slots[i]!).filter((h) =>
        structures.every((s) => hexDistance(s.hex, h) >= STRUCT_SPACING),
      );
      if (!free.length) ok = false;
      else structures.push({ ...pieces[i]!, hex: free[Math.floor(rng() * free.length)]! });
    }
    if (ok) return { ...laid, structures, tiles };
  }
}
