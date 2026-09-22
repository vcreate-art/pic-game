export type Side = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

/**
 * Squares are 0..63 with 0 = a1 and 63 = h8, so `file = i % 8` and
 * `rank = (i / 8) | 0`, and white advances by +8.
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

export interface KungFuSettings {
  /** Base cooldown in ms; each piece type scales off this. */
  cooldownMs: number;
}

export const KUNGFU_DEFAULTS: KungFuSettings = {
  cooldownMs: 4000,
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

export interface KungFuSeats {
  /** playerId, or null while the seat is open. */
  w: string | null;
  b: string | null;
}

export interface KungFuPublic {
  phase: KungFuPhase;
  settings: KungFuSettings;
  seats: KungFuSeats;
  pieces: Piece[];
  /** Set once the game is over. */
  winner: Side | null;
  /** Why it ended, for the result overlay. */
  reason: 'king-captured' | 'resigned' | 'opponent-left' | null;
}

export const FILES = 'abcdefgh';

export function squareName(sq: Square): string {
  return `${FILES[sq % 8]}${((sq / 8) | 0) + 1}`;
}
