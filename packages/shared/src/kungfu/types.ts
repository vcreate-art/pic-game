/** Two sides in the classic game, four on the cruciform board. 'b' is black
 *  in one and blue in the other; the board spec decides which. */
export type Side = 'w' | 'b' | 'r' | 'y' | 'g';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

/**
 * A square index into a board of `size * size`, counting from the bottom-left:
 * `file = i % size`, `rank = (i / size) | 0`. On the classic 8x8 that makes
 * 0 = a1 and 63 = h8.
 */
export type Square = number;

export interface Piece {
  id: string;
  type: PieceType;
  side: Side;
  square: Square;
  /** Server epoch ms before which this piece cannot move again. */
  readyAt: number;
}

export type KungFuPhase = 'lobby' | 'playing' | 'ended';

/** Which board a room plays on. Declared here rather than in board.ts so the
 *  settings can name it without the two modules importing each other. */
export type Variant = 'classic' | 'cruciform';

export const VARIANTS: readonly Variant[] = ['classic', 'cruciform'];

export const VARIANT_LABELS: Record<Variant, { name: string; blurb: string; seats: number }> = {
  classic: { name: '1 v 1', blurb: 'The usual board, two armies.', seats: 2 },
  cruciform: { name: '4 player', blurb: 'A cross-shaped board, four armies, last king standing.', seats: 4 },
};

export interface KungFuSettings {
  /** Base cooldown in ms; each piece type scales off this. */
  cooldownMs: number;
  variant: Variant;
}

export const KUNGFU_DEFAULTS: KungFuSettings = {
  cooldownMs: 4000,
  variant: 'classic',
};

/** Pawns always promote to a queen. It is not a setting: with promotion off, a
 *  pawn reaching the last rank has no legal move at all and is stuck there,
 *  which is a trap rather than a choice. */
export const PROMOTES_TO = 'q' as const;

export const KUNGFU_BOUNDS = {
  cooldownMs: { min: 1000, max: 15000 },
} as const;

/**
 * Heavier pieces rest longer. Without this a queen is simply the best piece in
 * every situation, since real-time play removes the turn cost that normally
 * prices her power.
 */
export const COOLDOWN_SCALE: Record<PieceType, number> = {
  p: 0.6,
  n: 1.0,
  b: 1.0,
  r: 1.25,
  q: 1.6,
  k: 0.9,
};

export function cooldownFor(type: PieceType, base: number): number {
  return Math.round(base * COOLDOWN_SCALE[type]);
}

/** playerId per side; absent or null while a seat is open. Which sides exist
 *  depends on the board, so this is keyed loosely rather than by fixed fields. */
export type KungFuSeats = Partial<Record<Side, string | null>>;

export type KungFuEnding = 'king-captured' | 'opponent-left' | null;

export interface KungFuPublic {
  phase: KungFuPhase;
  settings: KungFuSettings;
  seats: KungFuSeats;
  pieces: Piece[];
  /** Sides that are out. Their pieces stay on the board as obstacles. */
  eliminated: Side[];
  /** Set once the game is over. */
  winner: Side | null;
  /** Why it ended, for the result overlay. */
  reason: KungFuEnding;
}

export const FILES = 'abcdefgh';

export function squareName(sq: Square): string {
  return `${FILES[sq % 8]}${((sq / 8) | 0) + 1}`;
}
