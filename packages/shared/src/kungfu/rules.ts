import type { Piece, PieceType, Side, Square } from './types.js';

/** Back rank layout, a-file to h-file. */
const BACK_RANK: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

export function initialPieces(idFor: (i: number) => string): Piece[] {
  const pieces: Piece[] = [];
  let n = 0;
  for (let file = 0; file < 8; file++) {
    pieces.push({ id: idFor(n++), type: BACK_RANK[file]!, side: 'w', square: file, readyAt: 0 });
    pieces.push({ id: idFor(n++), type: 'p', side: 'w', square: 8 + file, readyAt: 0 });
    pieces.push({ id: idFor(n++), type: 'p', side: 'b', square: 48 + file, readyAt: 0 });
    pieces.push({ id: idFor(n++), type: BACK_RANK[file]!, side: 'b', square: 56 + file, readyAt: 0 });
  }
  return pieces;
}

export function fileOf(sq: Square): number {
  return sq % 8;
}
export function rankOf(sq: Square): number {
  return (sq / 8) | 0;
}

/** Square lookup by index. Rebuilt per call because the piece list is small
 *  (32 max) and a stale map is a worse problem than a few array writes. */
export function occupancy(pieces: readonly Piece[]): Array<Piece | undefined> {
  const board = new Array<Piece | undefined>(64);
  for (const p of pieces) board[p.square] = p;
  return board;
}

/** Steps outward from `from` until blocked, for the sliding pieces. */
function ray(
  from: Square,
  df: number,
  dr: number,
  board: Array<Piece | undefined>,
  side: Side,
  out: Square[],
): void {
  let f = fileOf(from) + df;
  let r = rankOf(from) + dr;
  while (f >= 0 && f < 8 && r >= 0 && r < 8) {
    const sq = r * 8 + f;
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
  from: Square,
  df: number,
  dr: number,
  board: Array<Piece | undefined>,
  side: Side,
  out: Square[],
): void {
  const f = fileOf(from) + df;
  const r = rankOf(from) + dr;
  if (f < 0 || f > 7 || r < 0 || r > 7) return;
  const sq = r * 8 + f;
  const hit = board[sq];
  if (!hit || hit.side !== side) out.push(sq);
}

const KNIGHT: Array<[number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const DIAGONALS: Array<[number, number]> = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
const ORTHOGONALS: Array<[number, number]> = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/**
 * Where this piece may legally move right now.
 *
 * Ordinary chess movement with two deliberate omissions: there is no check,
 * pin or checkmate logic, and no castling or en passant. Real-time play has no
 * turn for a king to be "in check" during — you win by capturing it outright —
 * so a move that exposes your king is legal and simply risky.
 */
export function legalDestinations(pieces: readonly Piece[], piece: Piece): Square[] {
  const board = occupancy(pieces);
  const out: Square[] = [];
  const { square: from, side } = piece;

  switch (piece.type) {
    case 'p': {
      const dir = side === 'w' ? 1 : -1;
      const startRank = side === 'w' ? 1 : 6;
      const r = rankOf(from);
      const f = fileOf(from);

      const one = (r + dir) * 8 + f;
      if (r + dir >= 0 && r + dir < 8 && !board[one]) {
        out.push(one);
        // The double step needs BOTH squares clear, not just the destination.
        const two = (r + 2 * dir) * 8 + f;
        if (r === startRank && !board[two]) out.push(two);
      }
      // Pawns capture only diagonally, and only when something is there.
      for (const df of [-1, 1]) {
        const cf = f + df;
        const cr = r + dir;
        if (cf < 0 || cf > 7 || cr < 0 || cr > 7) continue;
        const sq = cr * 8 + cf;
        const hit = board[sq];
        if (hit && hit.side !== side) out.push(sq);
      }
      break;
    }
    case 'n':
      for (const [df, dr] of KNIGHT) step(from, df, dr, board, side, out);
      break;
    case 'b':
      for (const [df, dr] of DIAGONALS) ray(from, df, dr, board, side, out);
      break;
    case 'r':
      for (const [df, dr] of ORTHOGONALS) ray(from, df, dr, board, side, out);
      break;
    case 'q':
      for (const [df, dr] of [...DIAGONALS, ...ORTHOGONALS]) ray(from, df, dr, board, side, out);
      break;
    case 'k':
      for (const [df, dr] of [...DIAGONALS, ...ORTHOGONALS]) step(from, df, dr, board, side, out);
      break;
  }
  return out;
}

export function isLegalMove(pieces: readonly Piece[], piece: Piece, to: Square): boolean {
  if (!Number.isInteger(to) || to < 0 || to > 63) return false;
  return legalDestinations(pieces, piece).includes(to);
}

/** Pawns that reach the far rank. */
export function isPromotion(piece: Piece, to: Square): boolean {
  if (piece.type !== 'p') return false;
  return piece.side === 'w' ? rankOf(to) === 7 : rankOf(to) === 0;
}
