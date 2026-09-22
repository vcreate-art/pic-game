import { CLASSIC, onBoard, squareAt, type BoardSpec } from './board.js';
import type { Piece, Square } from './types.js';

export function fileOf(sq: Square, size = 8): number {
  return sq % size;
}
export function rankOf(sq: Square, size = 8): number {
  return Math.floor(sq / size);
}

/** Square lookup by index. Rebuilt per call because the piece list is small
 *  and a stale map is a worse problem than a few array writes. */
export function occupancy(pieces: readonly Piece[], spec: BoardSpec = CLASSIC): Array<Piece | undefined> {
  const board = new Array<Piece | undefined>(spec.size * spec.size);
  for (const p of pieces) board[p.square] = p;
  return board;
}

/** Steps outward until blocked or off the board, for the sliding pieces. */
function ray(
  spec: BoardSpec,
  from: Square,
  df: number,
  dr: number,
  board: Array<Piece | undefined>,
  side: Piece['side'],
  out: Square[],
): void {
  let f = (from % spec.size) + df;
  let r = Math.floor(from / spec.size) + dr;
  while (onBoard(spec, f, r)) {
    const sq = squareAt(spec, f, r);
    const hit = board[sq];
    if (!hit) {
      out.push(sq);
    } else {
      if (hit.side !== side) out.push(sq); // capture, then stop
      return;
    }
    f += df;
    r += dr;
  }
}

function step(
  spec: BoardSpec,
  from: Square,
  df: number,
  dr: number,
  board: Array<Piece | undefined>,
  side: Piece['side'],
  out: Square[],
): void {
  const f = (from % spec.size) + df;
  const r = Math.floor(from / spec.size) + dr;
  if (!onBoard(spec, f, r)) return;
  const sq = squareAt(spec, f, r);
  const hit = board[sq];
  if (!hit || hit.side !== side) out.push(sq);
}

const KNIGHT: Array<[number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const DIAGONALS: Array<[number, number]> = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
const ORTHOGONALS: Array<[number, number]> = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** The two squares a pawn may capture on: forward, rotated a quarter turn each
 *  way. Works for any of the four facings a cruciform board uses. */
export function pawnCaptures(forward: readonly [number, number]): Array<[number, number]> {
  const [df, dr] = forward;
  return df === 0 ? [[-1, dr], [1, dr]] : [[df, -1], [df, 1]];
}

/**
 * Where this piece may legally move right now.
 *
 * Ordinary chess movement with two deliberate omissions: there is no check,
 * pin or checkmate logic, and no castling or en passant. Real-time play has no
 * turn for a king to be "in check" during — you win by capturing it outright —
 * so a move that exposes your king is legal and simply risky.
 */
export function legalDestinations(
  pieces: readonly Piece[],
  piece: Piece,
  spec: BoardSpec = CLASSIC,
): Square[] {
  const board = occupancy(pieces, spec);
  const out: Square[] = [];
  const { square: from, side } = piece;

  switch (piece.type) {
    case 'p': {
      const fwd = spec.forward(side);
      const [df, dr] = fwd;
      const f = from % spec.size;
      const r = Math.floor(from / spec.size);

      if (onBoard(spec, f + df, r + dr)) {
        const one = squareAt(spec, f + df, r + dr);
        if (!board[one]) {
          out.push(one);
          // The double step needs BOTH squares clear, not just the destination.
          if (spec.pawnHome(side, from) && onBoard(spec, f + 2 * df, r + 2 * dr)) {
            const two = squareAt(spec, f + 2 * df, r + 2 * dr);
            if (!board[two]) out.push(two);
          }
        }
      }
      // Pawns capture only on the diagonal, and only when something is there.
      for (const [cf, cr] of pawnCaptures(fwd)) {
        if (!onBoard(spec, f + cf, r + cr)) continue;
        const sq = squareAt(spec, f + cf, r + cr);
        const hit = board[sq];
        if (hit && hit.side !== side) out.push(sq);
      }
      break;
    }
    case 'n':
      for (const [df, dr] of KNIGHT) step(spec, from, df, dr, board, side, out);
      break;
    case 'b':
      for (const [df, dr] of DIAGONALS) ray(spec, from, df, dr, board, side, out);
      break;
    case 'r':
      for (const [df, dr] of ORTHOGONALS) ray(spec, from, df, dr, board, side, out);
      break;
    case 'q':
      for (const [df, dr] of [...DIAGONALS, ...ORTHOGONALS]) ray(spec, from, df, dr, board, side, out);
      break;
    case 'k':
      for (const [df, dr] of [...DIAGONALS, ...ORTHOGONALS]) step(spec, from, df, dr, board, side, out);
      break;
  }
  return out;
}

export function isLegalMove(
  pieces: readonly Piece[],
  piece: Piece,
  to: Square,
  spec: BoardSpec = CLASSIC,
): boolean {
  if (!Number.isInteger(to) || to < 0 || to >= spec.size * spec.size) return false;
  if (!spec.playable(to)) return false;
  return legalDestinations(pieces, piece, spec).includes(to);
}

/** Pawns that have crossed far enough to promote. */
export function isPromotion(piece: Piece, to: Square, spec: BoardSpec = CLASSIC): boolean {
  if (piece.type !== 'p') return false;
  return spec.promotes(piece.side, to);
}

/** Convenience for the classic board, where callers still think in a1..h8. */
export function initialPieces(idFor: (i: number) => string): Piece[] {
  let n = 0;
  return CLASSIC.initialPieces(() => idFor(n++));
}
