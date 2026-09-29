import { hexDistance, randomBoard } from './board.js';

type Rng = () => number;
import {
  ANIMALS, HEXES, SHAPES, TERRAINS,
  type CryptidClue, type CryptidClueBase, type CryptidBoard, type StructColor,
} from './types.js';

// ------------------------------------------------------------------ the list

/** Every clue the game can deal: 23 in the standard game, 48 in the advanced
 *  one (black structures, and "not" of everything). */
export function allClues(advanced: boolean): CryptidClue[] {
  const base: CryptidClueBase[] = [];
  for (let i = 0; i < TERRAINS.length; i++) {
    for (let j = i + 1; j < TERRAINS.length; j++) {
      base.push({ kind: 'terrains', terrains: [TERRAINS[i]!, TERRAINS[j]!] });
    }
  }
  for (const terrain of TERRAINS) base.push({ kind: 'nearTerrain', terrain });
  base.push({ kind: 'nearAnimal' });
  for (const shape of SHAPES) base.push({ kind: 'nearShape', shape });
  for (const animal of ANIMALS) base.push({ kind: 'nearAnimalKind', animal });
  const colors: StructColor[] = advanced ? ['white', 'green', 'blue', 'black'] : ['white', 'green', 'blue'];
  for (const color of colors) base.push({ kind: 'nearColor', color });
  const yes = base.map((b) => ({ ...b, not: false }));
  return advanced ? [...yes, ...base.map((b) => ({ ...b, not: true }))] : yes;
}

/** A stable key, for comparing clues and for checking one sent by a client. */
export function clueKey(c: CryptidClue): string {
  const tail =
    c.kind === 'terrains' ? c.terrains.join('+')
      : c.kind === 'nearTerrain' ? c.terrain
        : c.kind === 'nearAnimalKind' ? c.animal
          : c.kind === 'nearShape' ? c.shape
            : c.kind === 'nearColor' ? c.color
              : '';
  return `${c.not ? '!' : ''}${c.kind}:${tail}`;
}

const TERRAIN_NAME: Record<string, string> = {
  forest: 'forest', desert: 'desert', water: 'water', swamp: 'swamp', mountain: 'mountain',
};
const SHAPE_NAME = { stone: 'a standing stone', shack: 'an abandoned shack' } as const;

/** The clue as it would be printed on the card, with "not" in capitals. */
export function clueText(c: CryptidClue): string {
  const not = c.not ? 'NOT ' : '';
  switch (c.kind) {
    case 'terrains':
      return `The habitat is ${not}on ${TERRAIN_NAME[c.terrains[0]]} or ${TERRAIN_NAME[c.terrains[1]]}`;
    case 'nearTerrain':
      return `The habitat is ${not}within one space of ${TERRAIN_NAME[c.terrain]}`;
    case 'nearAnimal':
      return `The habitat is ${not}within one space of either animal territory`;
    case 'nearAnimalKind':
      return `The habitat is ${not}within two spaces of ${c.animal} territory`;
    case 'nearShape':
      return `The habitat is ${not}within two spaces of ${SHAPE_NAME[c.shape]}`;
    case 'nearColor':
      return `The habitat is ${not}within three spaces of a ${c.color} structure`;
  }
}

/** The kind of clue, for grouping the reference list. */
export const CLUE_GROUPS: { title: string; kinds: CryptidClue['kind'][] }[] = [
  { title: 'On one of two terrains', kinds: ['terrains'] },
  { title: 'Within one space', kinds: ['nearTerrain', 'nearAnimal'] },
  { title: 'Within two spaces', kinds: ['nearShape', 'nearAnimalKind'] },
  { title: 'Within three spaces', kinds: ['nearColor'] },
];

// --------------------------------------------------------------- evaluation

/** Spaces as bits: bit h set means space h. 108 bits, so a bigint. */
export type HexMask = bigint;

export const hexBit = (hex: number): HexMask => 1n << BigInt(hex);
export const hasHex = (m: HexMask, hex: number): boolean => ((m >> BigInt(hex)) & 1n) === 1n;
export const FULL_MASK: HexMask = (1n << BigInt(HEXES)) - 1n;

export function popcount(m: HexMask): number {
  let n = 0;
  while (m) {
    m &= m - 1n;
    n++;
  }
  return n;
}

export function maskHexes(m: HexMask): number[] {
  const out: number[] = [];
  for (let h = 0; h < HEXES; h++) if (hasHex(m, h)) out.push(h);
  return out;
}

/** Every space within `range` of any of `sources`. */
function within(sources: number[], range: number): HexMask {
  let m = 0n;
  for (let h = 0; h < HEXES; h++) {
    if (sources.some((s) => hexDistance(s, h) <= range)) m |= hexBit(h);
  }
  return m;
}

function positiveMask(b: CryptidBoard, c: CryptidClue): HexMask {
  const where = (pred: (h: number) => boolean) => {
    const out: number[] = [];
    for (let h = 0; h < HEXES; h++) if (pred(h)) out.push(h);
    return out;
  };
  switch (c.kind) {
    case 'terrains':
      return within(where((h) => c.terrains.includes(b.terrain[h]!)), 0);
    case 'nearTerrain':
      return within(where((h) => b.terrain[h] === c.terrain), 1);
    case 'nearAnimal':
      return within(where((h) => b.animal[h] !== null), 1);
    case 'nearAnimalKind':
      return within(where((h) => b.animal[h] === c.animal), 2);
    case 'nearShape':
      return within(b.structures.filter((s) => s.shape === c.shape).map((s) => s.hex), 2);
    case 'nearColor':
      return within(b.structures.filter((s) => s.color === c.color).map((s) => s.hex), 3);
  }
}

/** Masks already worked out, per board. A board never changes once dealt,
 *  and the server asks the same few clues about it all game. */
const cache = new WeakMap<CryptidBoard, Map<string, HexMask>>();

/** The spaces where this clue allows the creature to be. */
export function clueMask(b: CryptidBoard, c: CryptidClue): HexMask {
  let known = cache.get(b);
  if (!known) cache.set(b, (known = new Map()));
  const key = clueKey(c);
  let m = known.get(key);
  if (m === undefined) {
    const pos = positiveMask(b, c);
    m = c.not ? FULL_MASK & ~pos : pos;
    known.set(key, m);
  }
  return m;
}

/** Whether this clue allows the creature on this space. */
export function clueAllows(b: CryptidBoard, c: CryptidClue, hex: number): boolean {
  return hasHex(clueMask(b, c), hex);
}

// ------------------------------------------------------------------ puzzles

export interface Puzzle {
  board: CryptidBoard;
  /** One per player, in seat order. */
  clues: CryptidClue[];
  answer: number;
}

/**
 * Checks a hand of clues makes a fair puzzle: together they allow exactly one
 * space, and every one of them is needed to get there. A clue the others make
 * redundant would leave its holder with nothing to hide.
 */
export function isFair(masks: HexMask[]): number | null {
  let all = FULL_MASK;
  for (const m of masks) all &= m;
  if (popcount(all) !== 1) return null;
  for (let i = 0; i < masks.length; i++) {
    let rest = FULL_MASK;
    masks.forEach((m, j) => {
      if (j !== i) rest &= m;
    });
    if (popcount(rest) < 2) return null;
  }
  return maskHexes(all)[0]!;
}

/** Clues that allow nearly everywhere, or nearly nowhere, make for a dull hand. */
const MIN_SPACES = 12;
const MAX_SPACES = 90;
/** An advanced hand still leans on positive clues; all "nots" is a slog. */
const MAX_NOTS = 2;

/**
 * Deals a fair hand of `players` clues on a fresh map.
 *
 * Works backwards from a space: picks where the creature lives, keeps only the
 * clues that allow it there, and tries hands of those until one pins it down.
 * A map that yields nothing is thrown away for another; in practice the first
 * one nearly always works.
 */
export function generatePuzzle(players: number, advanced: boolean, rng: Rng): Puzzle {
  const clues = allClues(advanced);
  for (;;) {
    const board = randomBoard(advanced, rng);
    const masks = clues.map((c) => clueMask(board, c));
    const usable = clues
      .map((_, i) => i)
      .filter((i) => {
        const n = popcount(masks[i]!);
        return n >= MIN_SPACES && n <= MAX_SPACES;
      });

    for (let tryHex = 0; tryHex < 40; tryHex++) {
      const answer = Math.floor(rng() * HEXES);
      const fits = usable.filter((i) => hasHex(masks[i]!, answer));
      if (fits.length < players) continue;
      for (let attempt = 0; attempt < 400; attempt++) {
        const pick = sample(fits, players, rng);
        if (pick.filter((i) => clues[i]!.not).length > MAX_NOTS) continue;
        // A clue and its own "not" would leave nowhere at all.
        if (new Set(pick.map((i) => clueKey({ ...clues[i]!, not: false }))).size < players) continue;
        if (isFair(pick.map((i) => masks[i]!)) === answer) {
          return { board, clues: pick.map((i) => clues[i]!), answer };
        }
      }
    }
  }
}

function sample(from: number[], n: number, rng: Rng): number[] {
  const pool = [...from];
  const out: number[] = [];
  for (let k = 0; k < n && pool.length; k++) {
    const j = Math.floor(rng() * pool.length);
    out.push(pool[j]!);
    pool.splice(j, 1);
  }
  return out;
}
