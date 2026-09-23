import { describe, expect, it } from 'vitest';
import {
  cooldownFor, initialPieces, isLegalMove, isPromotion, legalDestinations,
  occupancy, squareName, type Piece, type PieceType, type Side,
} from '../index.js';

let n = 0;
const fresh = () => initialPieces(() => `p${n++}`);

/** Builds a sparse board from "e4:wq" style descriptors. */
function board(...spec: string[]): Piece[] {
  return spec.map((s, i) => {
    const [sq, code] = s.split(':');
    const file = 'abcdefgh'.indexOf(sq![0]!);
    const rank = Number(sq![1]) - 1;
    return {
      id: `t${i}`,
      side: code![0] as Side,
      type: code![1] as PieceType,
      square: rank * 8 + file,
      readyAt: 0,
    };
  });
}
const at = (pieces: Piece[], sq: string) => pieces.find((p) => squareName(p.square) === sq)!;
// Wrapped, not passed bare: .map hands the index along, which squareName
// would take as the board size.
const names = (pieces: Piece[], p: Piece) =>
  legalDestinations(pieces, p).map((s) => squareName(s)).sort();

describe('squares', () => {
  it('maps index 0 to a1 and 63 to h8', () => {
    expect(squareName(0)).toBe('a1');
    expect(squareName(63)).toBe('h8');
    expect(squareName(4)).toBe('e1');
  });
});

describe('initial position', () => {
  it('sets up 32 pieces', () => {
    const p = fresh();
    expect(p).toHaveLength(32);
    expect(p.filter((x) => x.side === 'w')).toHaveLength(16);
    expect(p.filter((x) => x.type === 'k')).toHaveLength(2);
  });

  it('puts the kings on e1 and e8', () => {
    const p = fresh();
    expect(squareName(p.find((x) => x.type === 'k' && x.side === 'w')!.square)).toBe('e1');
    expect(squareName(p.find((x) => x.type === 'k' && x.side === 'b')!.square)).toBe('e8');
  });

  it('gives every piece a distinct square', () => {
    const p = fresh();
    expect(new Set(p.map((x) => x.square)).size).toBe(32);
  });

  it('starts everything off cooldown', () => {
    expect(fresh().every((p) => p.readyAt === 0)).toBe(true);
  });
});

describe('pawns', () => {
  it('may step one or two from the start rank', () => {
    const p = board('e2:wp');
    expect(names(p, at(p, 'e2'))).toEqual(['e3', 'e4']);
  });

  it('may only step one after that', () => {
    const p = board('e3:wp');
    expect(names(p, at(p, 'e3'))).toEqual(['e4']);
  });

  it('cannot jump a piece on the double step', () => {
    const p = board('e2:wp', 'e3:bp');
    expect(names(p, at(p, 'e2'))).toEqual([]);
  });

  it('cannot capture straight ahead', () => {
    const p = board('e4:wp', 'e5:bp');
    expect(names(p, at(p, 'e4'))).toEqual([]);
  });

  it('captures diagonally only', () => {
    const p = board('e4:wp', 'd5:bp', 'f5:bp');
    expect(names(p, at(p, 'e4'))).toEqual(['d5', 'e5', 'f5']);
  });

  it('does not capture its own side', () => {
    const p = board('e4:wp', 'd5:wp');
    expect(names(p, at(p, 'e4'))).toEqual(['e5']);
  });

  it('moves down the board for black', () => {
    const p = board('e7:bp');
    expect(names(p, at(p, 'e7'))).toEqual(['e5', 'e6']);
  });

  it('does not wrap around the board edge', () => {
    const p = board('a4:wp', 'h5:bp');
    expect(names(p, at(p, 'a4'))).toEqual(['a5']);
  });
});

describe('knights', () => {
  it('reaches all eight squares from the middle', () => {
    const p = board('d4:wn');
    expect(names(p, at(p, 'd4'))).toEqual(['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5']);
  });

  it('is not blocked by pieces in between', () => {
    // The knight is hemmed in by its own pawns yet still reaches every square
    // its L-shape allows: f3 is empty, and e2/h3 are beyond the blockers.
    const p = board('g1:wn', 'g2:wp', 'f2:wp', 'f1:wp');
    expect(names(p, at(p, 'g1'))).toEqual(['e2', 'f3', 'h3']);
  });

  it('stays on the board from a corner', () => {
    const p = board('a1:wn');
    expect(names(p, at(p, 'a1'))).toEqual(['b3', 'c2']);
  });
});

describe('sliding pieces', () => {
  it('a rook sweeps rank and file', () => {
    const p = board('a1:wr');
    expect(names(p, at(p, 'a1'))).toHaveLength(14);
  });

  it('a rook stops before its own piece and on an enemy', () => {
    const p = board('a1:wr', 'a4:wp', 'd1:bp');
    expect(names(p, at(p, 'a1'))).toEqual(['a2', 'a3', 'b1', 'c1', 'd1']);
  });

  it('a bishop cannot pass through anything', () => {
    const p = board('c1:wb', 'd2:wp');
    expect(names(p, at(p, 'c1'))).toEqual(['a3', 'b2']);
  });

  it('a queen is a rook plus a bishop', () => {
    const p = board('d4:wq');
    expect(legalDestinations(p, at(p, 'd4'))).toHaveLength(27);
  });
});

describe('king', () => {
  it('moves one square in any direction', () => {
    const p = board('d4:wk');
    expect(names(p, at(p, 'd4'))).toHaveLength(8);
  });

  it('may walk into danger — there is no check in real time', () => {
    // A rook bears down on e-file; the king may still step there. Capturing
    // the king IS the win condition, so nothing forbids the move.
    const p = board('d4:wk', 'e8:br');
    expect(names(p, at(p, 'd4'))).toContain('e4');
  });
});

describe('isLegalMove', () => {
  it('rejects destinations off the board or not reachable', () => {
    const p = board('e2:wp');
    const pawn = at(p, 'e2');
    expect(isLegalMove(p, pawn, 28)).toBe(true); // e4
    expect(isLegalMove(p, pawn, 36)).toBe(false); // e5
    expect(isLegalMove(p, pawn, -1)).toBe(false);
    expect(isLegalMove(p, pawn, 64)).toBe(false);
    expect(isLegalMove(p, pawn, 3.5)).toBe(false);
  });
});

describe('promotion', () => {
  it('triggers only for pawns reaching the far rank', () => {
    const p = board('a7:wp', 'a2:bp', 'h7:wr');
    expect(isPromotion(at(p, 'a7'), 56)).toBe(true);   // a8
    expect(isPromotion(at(p, 'a2'), 0)).toBe(true);    // a1 for black
    expect(isPromotion(at(p, 'a7'), 48)).toBe(false);  // a7 -> a7-ish, not last
    expect(isPromotion(at(p, 'h7'), 63)).toBe(false);  // a rook, not a pawn
  });
});

describe('cooldowns', () => {
  it('scales so heavy pieces rest longer than pawns', () => {
    const base = 4000;
    expect(cooldownFor('p', base)).toBeLessThan(cooldownFor('n', base));
    expect(cooldownFor('n', base)).toBeLessThan(cooldownFor('r', base));
    expect(cooldownFor('r', base)).toBeLessThan(cooldownFor('q', base));
  });
});

describe('occupancy', () => {
  it('indexes pieces by square', () => {
    const p = fresh();
    const b = occupancy(p);
    expect(b[4]?.type).toBe('k');
    expect(b[32]).toBeUndefined(); // a5, empty at the start
  });
});
