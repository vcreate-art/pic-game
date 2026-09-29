/**
 * Cryptid: a deduction game on a hex map.
 *
 * Somewhere on the map lives a creature nobody has photographed. Each player
 * holds one clue about its habitat, and the clues together point at exactly
 * one space. Nobody sees anyone else's clue; you learn them by asking.
 *
 * On your turn you either question another player about a space (they answer
 * with a disk for "could be" or a cube for "cannot be"), or search a space your
 * own clue allows, and everyone else answers in turn until someone says no.
 * Whoever searches the one space every clue allows wins.
 *
 * At the table the answers are honour-system. Here the server holds every
 * clue, so it answers for each player and cannot be lied to or mistaken.
 */

export type Terrain = 'forest' | 'desert' | 'water' | 'swamp' | 'mountain';
export const TERRAINS: readonly Terrain[] = ['forest', 'desert', 'water', 'swamp', 'mountain'];

export type Animal = 'bear' | 'cougar';
export const ANIMALS: readonly Animal[] = ['bear', 'cougar'];

export type Shape = 'stone' | 'shack';
export const SHAPES: readonly Shape[] = ['stone', 'shack'];

/** Black structures only come out in the advanced game. */
export type StructColor = 'white' | 'green' | 'blue' | 'black';
export const STRUCT_COLORS: readonly StructColor[] = ['white', 'green', 'blue', 'black'];

export interface Structure {
  hex: number;
  shape: Shape;
  color: StructColor;
}

/** The map, 12 columns by 9 rows of flat-topped hexes, row-major. */
export interface CryptidBoard {
  terrain: Terrain[];
  animal: (Animal | null)[];
  structures: Structure[];
  /** How the six tiles were laid: which tile went in each slot, and whether it
   *  was turned round. Kept so a board can be described and rebuilt. */
  tiles: { tile: number; flipped: boolean }[];
}

export const COLS = 12;
export const ROWS = 9;
export const HEXES = COLS * ROWS;

/**
 * The clue kinds, as in the box:
 *  - on one of two terrains
 *  - within one space of a terrain, or of either animal territory
 *  - within two spaces of a shape of structure, or of one animal's territory
 *  - within three spaces of a colour of structure
 * The advanced game adds the negation of every one of them.
 */
export type CryptidClueBase =
  | { kind: 'terrains'; terrains: [Terrain, Terrain] }
  | { kind: 'nearTerrain'; terrain: Terrain }
  | { kind: 'nearAnimal' }
  | { kind: 'nearAnimalKind'; animal: Animal }
  | { kind: 'nearShape'; shape: Shape }
  | { kind: 'nearColor'; color: StructColor };

export type CryptidClue = CryptidClueBase & { not: boolean };

export interface CryptidSettings {
  /** Black structures and "not" clues. */
  advanced: boolean;
}

export const CRYPTID_DEFAULTS: CryptidSettings = { advanced: false };

export const CRYPTID_MIN_PLAYERS = 3;
export const CRYPTID_MAX_PLAYERS = 5;
/** Cubes each player puts down before the first turn. */
export const SETUP_CUBES = 2;

/**
 * Every phase after the lobby:
 *  - setup: in turn, each player puts down cubes where their clue rules the
 *    creature out, twice round the table
 *  - turn: the player to move questions or searches
 *  - penalty: they were told no, and owe a cube of their own
 */
export type CryptidPhase = 'lobby' | 'setup' | 'turn' | 'penalty' | 'ended';

export interface CryptidAnswer {
  id: string;
  yes: boolean;
}

/** One thing that happened, for the history and the banner over the map. */
export type CryptidAction =
  | { kind: 'cube'; by: string; hex: number; why: 'setup' | 'penalty' | 'auto' }
  | { kind: 'question'; by: string; target: string; hex: number; yes: boolean }
  | { kind: 'search'; by: string; hex: number; answers: CryptidAnswer[]; found: boolean }
  | { kind: 'skip'; by: string };

export interface CryptidPublic {
  phase: CryptidPhase;
  settings: CryptidSettings;
  board: CryptidBoard | null;
  /** Everyone in this game, in turn order. Seat colours follow this order. */
  players: string[];
  turn: string | null;
  /** Setup: cubes still to go down, all players together. */
  setupLeft: number;
  /** Per hex: who has a disk there, in the order they went down. */
  disks: string[][];
  /** Per hex: whose cube is there, if any. A cube closes a space for good. */
  cubes: (string | null)[];
  log: CryptidAction[];
  winner: string | null;
  /** Clues everyone may read: players who left mid-game, whose clue still
   *  counts, and every clue once the game is over. */
  openClues: Record<string, CryptidClue>;
  /** Names kept for players who have left, so the history still reads. */
  departed: Record<string, string>;
  /** The creature's space, once the game is over. */
  answer: number | null;
}

/** Seat colours, in turn order. Bright, and far from the terrain colours, so
 *  a piece reads on any space. */
export const SEAT_COLORS = ['#e11d48', '#facc15', '#22d3ee', '#d946ef', '#f97316'] as const;
