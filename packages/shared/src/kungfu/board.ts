import type { Piece, PieceType, Side, Square, Variant } from './types.js';

export type { Variant };

/** Back-rank order, read along each side's home line. */
const BACK_RANK: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

/**
 * A board's geometry: how big it is, which squares exist, and which way each
 * side faces.
 *
 * Pulled out as data because the pieces do not care. A rook slides until it is
 * blocked whatever the board's shape; only the coordinates and the pawns'
 * sense of "forward" change between variants.
 */
export interface BoardSpec {
  readonly variant: Variant;
  /** Boards are square; `size` is the side length in squares. */
  readonly size: number;
  readonly sides: readonly Side[];
  /** False for the cut-away corners of a cruciform board. */
  playable(sq: Square): boolean;
  /** Which way this side's pawns advance, as [fileStep, rankStep]. */
  forward(side: Side): readonly [number, number];
  /** On its starting line, so it may take the double step. */
  pawnHome(side: Side, sq: Square): boolean;
  /** Far enough across to promote. */
  promotes(side: Side, sq: Square): boolean;
  initialPieces(idFor: () => string): Piece[];
}

export const fileOfOn = (spec: BoardSpec, sq: Square): number => sq % spec.size;
export const rankOfOn = (spec: BoardSpec, sq: Square): number => Math.floor(sq / spec.size);
export const squareAt = (spec: BoardSpec, file: number, rank: number): Square =>
  rank * spec.size + file;

export function onBoard(spec: BoardSpec, file: number, rank: number): boolean {
  if (file < 0 || file >= spec.size || rank < 0 || rank >= spec.size) return false;
  return spec.playable(squareAt(spec, file, rank));
}

// --------------------------------------------------------------- classic 8x8

export const CLASSIC: BoardSpec = {
  variant: 'classic',
  size: 8,
  sides: ['w', 'b'],
  playable: () => true,
  forward: (side) => (side === 'w' ? [0, 1] : [0, -1]),
  pawnHome: (side, sq) => Math.floor(sq / 8) === (side === 'w' ? 1 : 6),
  promotes: (side, sq) => Math.floor(sq / 8) === (side === 'w' ? 7 : 0),
  initialPieces(idFor) {
    const out: Piece[] = [];
    for (let file = 0; file < 8; file++) {
      out.push({ id: idFor(), type: BACK_RANK[file]!, side: 'w', square: file, readyAt: 0 });
      out.push({ id: idFor(), type: 'p', side: 'w', square: 8 + file, readyAt: 0 });
      out.push({ id: idFor(), type: 'p', side: 'b', square: 48 + file, readyAt: 0 });
      out.push({ id: idFor(), type: BACK_RANK[file]!, side: 'b', square: 56 + file, readyAt: 0 });
    }
    return out;
  },
};

// ------------------------------------------------------------ cruciform 14x14

const N = 14;
/** The centre band. Outside it on BOTH axes is a cut-away corner. */
const inArm = (v: number) => v >= 3 && v <= 10;

/**
 * Four 3x8 arms around an 8x8 centre, which is the standard four-player board.
 * 196 squares in the grid, 36 cut away at the corners, 160 in play.
 */
export const CRUCIFORM: BoardSpec = {
  variant: 'cruciform',
  size: N,
  // Red faces up from the bottom, then clockwise: blue from the left,
  // yellow from the top, green from the right.
  sides: ['r', 'b', 'y', 'g'],
  playable(sq) {
    const f = sq % N;
    const r = Math.floor(sq / N);
    return inArm(f) || inArm(r);
  },
  forward: (side) =>
    side === 'r' ? [0, 1] : side === 'y' ? [0, -1] : side === 'b' ? [1, 0] : [-1, 0],
  pawnHome(side, sq) {
    const f = sq % N;
    const r = Math.floor(sq / N);
    return side === 'r' ? r === 1 : side === 'y' ? r === 12 : side === 'b' ? f === 1 : f === 12;
  },
  /** The far edge of the centre, which is the eleventh line of travel. */
  promotes(side, sq) {
    const f = sq % N;
    const r = Math.floor(sq / N);
    return side === 'r' ? r >= 10 : side === 'y' ? r <= 3 : side === 'b' ? f >= 10 : f <= 3;
  },
  initialPieces(idFor) {
    const out: Piece[] = [];
    const put = (type: PieceType, side: Side, file: number, rank: number) =>
      out.push({ id: idFor(), type, side, square: rank * N + file, readyAt: 0 });

    for (let i = 0; i < 8; i++) {
      const line = 3 + i;          // files 3..10 for red/yellow, ranks 3..10 for blue/green
      const piece = BACK_RANK[i]!;
      put(piece, 'r', line, 0);
      put('p', 'r', line, 1);
      put(piece, 'y', line, 13);
      put('p', 'y', line, 12);
      put(piece, 'b', 0, line);
      put('p', 'b', 1, line);
      put(piece, 'g', 13, line);
      put('p', 'g', 12, line);
    }
    return out;
  },
};

export const SPECS: Record<Variant, BoardSpec> = {
  classic: CLASSIC,
  cruciform: CRUCIFORM,
};

export const SIDE_LABEL: Record<Side, string> = {
  w: 'White',
  b: 'Black',
  r: 'Red',
  y: 'Yellow',
  g: 'Green',
};

/** Blue reuses 'b'; which colour it means depends on the variant. */
export const sideLabel = (spec: BoardSpec, side: Side): string =>
  spec.variant === 'cruciform' && side === 'b' ? 'Blue' : SIDE_LABEL[side];

/**
 * How many quarter-turns clockwise the board is rotated so this side sits at
 * the bottom. Every player looks at their own army from behind it, which on a
 * four-way board means rotating rather than merely flipping.
 */
export function viewTurns(spec: BoardSpec, side: Side | null): number {
  if (spec.variant !== 'cruciform') return side === 'b' ? 2 : 0;
  return side === 'g' ? 1 : side === 'y' ? 2 : side === 'b' ? 3 : 0;
}

/**
 * The squares in reading order — left to right, top to bottom — for a viewer
 * on `side`. Cut-away corners are included so the grid stays rectangular; the
 * caller draws them as gaps.
 */
export function viewOrder(spec: BoardSpec, side: Side | null): Square[] {
  const n = spec.size;
  const turns = viewTurns(spec, side);
  const out: Square[] = [];
  for (let dr = 0; dr < n; dr++) {
    for (let dc = 0; dc < n; dc++) {
      let file: number;
      let rank: number;
      switch (turns) {
        case 1: file = dr; rank = dc; break;
        case 2: file = n - 1 - dc; rank = dr; break;
        case 3: file = n - 1 - dr; rank = n - 1 - dc; break;
        default: file = dc; rank = n - 1 - dr; break;
      }
      out.push(squareAt(spec, file, rank));
    }
  }
  return out;
}

/** Light and dark squares, in board coordinates so the pattern does not shift
 *  when the view rotates. */
export function isDarkSquare(spec: BoardSpec, sq: Square): boolean {
  return ((sq % spec.size) + Math.floor(sq / spec.size)) % 2 === 0;
}
