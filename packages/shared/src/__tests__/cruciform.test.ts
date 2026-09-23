import { describe, expect, it } from 'vitest';
import {
  CLASSIC, CRUCIFORM, isDarkSquare, isLegalMove, isPromotion, legalDestinations,
  onBoard, pawnCaptures, sideLabel, squareAt, viewOrder,
  type Piece, type PieceType, type Side,
} from '../index.js';

const N = 14;
const sq = (file: number, rank: number) => rank * N + file;
const pc = (side: Side, type: PieceType, file: number, rank: number): Piece =>
  ({ id: `${side}${type}${file}${rank}`, side, type, square: sq(file, rank), readyAt: 0 });
const dests = (pieces: Piece[], p: Piece) => legalDestinations(pieces, p, CRUCIFORM);

describe('cruciform geometry', () => {
  it('cuts away the four 3x3 corners, leaving 160 squares', () => {
    let playable = 0;
    for (let i = 0; i < N * N; i++) if (CRUCIFORM.playable(i)) playable++;
    expect(playable).toBe(160);
    expect(N * N - playable).toBe(36);
  });

  it('rejects the corners specifically', () => {
    expect(CRUCIFORM.playable(sq(0, 0))).toBe(false);   // bottom-left
    expect(CRUCIFORM.playable(sq(13, 0))).toBe(false);  // bottom-right
    expect(CRUCIFORM.playable(sq(0, 13))).toBe(false);  // top-left
    expect(CRUCIFORM.playable(sq(2, 2))).toBe(false);   // inside the corner
    expect(CRUCIFORM.playable(sq(3, 0))).toBe(true);    // start of red's back line
    expect(CRUCIFORM.playable(sq(0, 3))).toBe(true);    // start of blue's back line
  });

  it('knows what is off the board', () => {
    expect(onBoard(CRUCIFORM, -1, 5)).toBe(false);
    expect(onBoard(CRUCIFORM, 14, 5)).toBe(false);
    expect(onBoard(CRUCIFORM, 1, 1)).toBe(false); // cut-away corner
    expect(onBoard(CRUCIFORM, 7, 7)).toBe(true);  // centre
  });
});

describe('cruciform setup', () => {
  const pieces = CRUCIFORM.initialPieces((() => { let n = 0; return () => `p${n++}`; })());

  it('deals four full armies', () => {
    expect(pieces).toHaveLength(64);
    for (const side of ['r', 'b', 'y', 'g'] as Side[]) {
      expect(pieces.filter((p) => p.side === side)).toHaveLength(16);
      expect(pieces.filter((p) => p.side === side && p.type === 'k')).toHaveLength(1);
      expect(pieces.filter((p) => p.side === side && p.type === 'p')).toHaveLength(8);
    }
  });

  it('puts every piece on a playable square, none overlapping', () => {
    expect(pieces.every((p) => CRUCIFORM.playable(p.square))).toBe(true);
    expect(new Set(pieces.map((p) => p.square)).size).toBe(64);
  });

  it('seats each army on its own edge', () => {
    const rankOf = (p: Piece) => Math.floor(p.square / N);
    const fileOf = (p: Piece) => p.square % N;
    expect(pieces.filter((p) => p.side === 'r').every((p) => rankOf(p) <= 1)).toBe(true);
    expect(pieces.filter((p) => p.side === 'y').every((p) => rankOf(p) >= 12)).toBe(true);
    expect(pieces.filter((p) => p.side === 'b').every((p) => fileOf(p) <= 1)).toBe(true);
    expect(pieces.filter((p) => p.side === 'g').every((p) => fileOf(p) >= 12)).toBe(true);
  });
});

describe('four pawn directions', () => {
  it('each side advances toward the centre', () => {
    expect(CRUCIFORM.forward('r')).toEqual([0, 1]);
    expect(CRUCIFORM.forward('y')).toEqual([0, -1]);
    expect(CRUCIFORM.forward('b')).toEqual([1, 0]);
    expect(CRUCIFORM.forward('g')).toEqual([-1, 0]);
  });

  it('derives capture diagonals by rotating forward a quarter turn each way', () => {
    expect(pawnCaptures([0, 1])).toEqual([[-1, 1], [1, 1]]);    // red
    expect(pawnCaptures([1, 0])).toEqual([[1, -1], [1, 1]]);    // blue
    expect(pawnCaptures([-1, 0])).toEqual([[-1, -1], [-1, 1]]); // green
  });

  it("lets a blue pawn step and double-step sideways", () => {
    const p = pc('b', 'p', 1, 5);
    expect(dests([p], p).sort((a, b) => a - b)).toEqual([sq(2, 5), sq(3, 5)]);
  });

  it('gives a blue pawn its own diagonals, not red’s', () => {
    const p = pc('b', 'p', 1, 5);
    const prey = [pc('r', 'p', 2, 4), pc('r', 'p', 2, 6)];
    const got = dests([p, ...prey], p);
    expect(got).toContain(sq(2, 4));
    expect(got).toContain(sq(2, 6));
  });

  it('will not let a yellow pawn move like a red one', () => {
    const p = pc('y', 'p', 7, 12);
    const got = dests([p], p);
    expect(got).toContain(sq(7, 11)); // downward
    expect(got).toContain(sq(7, 10)); // double step
    expect(got).not.toContain(sq(7, 13));
  });
});

describe('pieces respect the cut-away corners', () => {
  it('a rook on the arm cannot slide into a corner', () => {
    // b4 in the left arm: sliding down stops where the board ends at rank 3.
    const rook = pc('r', 'r', 1, 4);
    const got: Array<[number, number]> = dests([rook], rook).map((s) => [s % N, Math.floor(s / N)]);
    expect(got.every(([f, r]) => CRUCIFORM.playable(squareAt(CRUCIFORM, f, r)))).toBe(true);
    expect(got).not.toContainEqual([1, 2]); // would be a corner square
    expect(got).toContainEqual([1, 3]);
  });

  it('a knight cannot land in a corner', () => {
    const n = pc('r', 'n', 4, 4);
    const got = dests([n], n);
    expect(got.every((s) => CRUCIFORM.playable(s))).toBe(true);
    expect(got).not.toContain(sq(2, 3) - N); // sq(2,2), a corner
  });

  it('a queen in the centre stays on playable squares', () => {
    const q = pc('r', 'q', 7, 7);
    expect(dests([q], q).every((s) => CRUCIFORM.playable(s))).toBe(true);
  });
});

describe('promotion lines', () => {
  it('each side promotes on the far edge of the centre', () => {
    expect(isPromotion(pc('r', 'p', 7, 9), sq(7, 10), CRUCIFORM)).toBe(true);
    expect(isPromotion(pc('r', 'p', 7, 8), sq(7, 9), CRUCIFORM)).toBe(false);
    expect(isPromotion(pc('y', 'p', 7, 4), sq(7, 3), CRUCIFORM)).toBe(true);
    expect(isPromotion(pc('b', 'p', 9, 7), sq(10, 7), CRUCIFORM)).toBe(true);
    expect(isPromotion(pc('g', 'p', 4, 7), sq(3, 7), CRUCIFORM)).toBe(true);
  });
});

describe('isLegalMove on a cruciform board', () => {
  it('refuses a destination in a cut-away corner', () => {
    const q = pc('r', 'q', 3, 3);
    expect(isLegalMove([q], q, sq(2, 2), CRUCIFORM)).toBe(false);
  });
  it('refuses an index past the end of the board', () => {
    const q = pc('r', 'q', 7, 7);
    expect(isLegalMove([q], q, 196, CRUCIFORM)).toBe(false);
  });
});

describe('side labels', () => {
  it("calls 'b' black on the classic board and blue on the cruciform one", () => {
    expect(sideLabel(CLASSIC, 'b')).toBe('Black');
    expect(sideLabel(CRUCIFORM, 'b')).toBe('Blue');
    expect(sideLabel(CRUCIFORM, 'r')).toBe('Red');
  });
});

describe('the classic board is unchanged by all this', () => {
  it('still deals 32 pieces on 64 squares', () => {
    const p = CLASSIC.initialPieces((() => { let n = 0; return () => `c${n++}`; })());
    expect(p).toHaveLength(32);
    expect(CLASSIC.playable(0)).toBe(true);
  });
  it('still moves a white pawn up the board', () => {
    const pawn: Piece = { id: 'x', side: 'w', type: 'p', square: 12, readyAt: 0 };
    expect(legalDestinations([pawn], pawn, CLASSIC).sort((a, b) => a - b)).toEqual([20, 28]);
  });
});

describe('view rotation', () => {
  const bottomRow = (side: Side) => {
    const order = viewOrder(CRUCIFORM, side);
    return order.slice(order.length - N); // last display row
  };

  it('puts each side’s home line along the bottom of their view', () => {
    // Red's home is rank 0, blue's is file 0, yellow's rank 13, green's file 13.
    expect(bottomRow('r').every((s) => Math.floor(s / N) === 0)).toBe(true);
    expect(bottomRow('y').every((s) => Math.floor(s / N) === 13)).toBe(true);
    expect(bottomRow('b').every((s) => s % N === 0)).toBe(true);
    expect(bottomRow('g').every((s) => s % N === 13)).toBe(true);
  });

  it('shows every square exactly once, whoever is looking', () => {
    for (const side of ['r', 'b', 'y', 'g'] as Side[]) {
      const order = viewOrder(CRUCIFORM, side);
      expect(order).toHaveLength(N * N);
      expect(new Set(order).size).toBe(N * N);
    }
  });

  it('rotates rather than mirrors, so the board is never handed backwards', () => {
    // Under a rotation the square diagonally adjacent stays diagonally
    // adjacent; a mirror would swap the two diagonals.
    for (const side of ['r', 'b', 'y', 'g'] as Side[]) {
      const order = viewOrder(CRUCIFORM, side);
      const at = (dr: number, dc: number) => order[dr * N + dc]!;
      const a = at(5, 5);
      const right = at(5, 6);
      const down = at(6, 5);
      const df = (x: number, y: number) => (x % N) - (y % N);
      const dk = (x: number, y: number) => Math.floor(x / N) - Math.floor(y / N);
      // Moving one cell right and one cell down must be perpendicular steps.
      const cross = df(right, a) * dk(down, a) - dk(right, a) * df(down, a);
      expect(Math.abs(cross)).toBe(1);
    }
  });

  it('leaves the classic board the way it was: white up, black flipped', () => {
    const white = viewOrder(CLASSIC, 'w');
    const black = viewOrder(CLASSIC, 'b');
    expect(white[0]).toBe(56);           // a8 top-left for white
    expect(white[63]).toBe(7);           // h1 bottom-right
    expect(black[0]).toBe(7);            // flipped for black
    expect(black[63]).toBe(56);
  });
});

describe('square colouring', () => {
  it('is computed from board coordinates, so it does not shift when the view rotates', () => {
    const sqA = squareAt(CRUCIFORM, 5, 5);
    expect(isDarkSquare(CRUCIFORM, sqA)).toBe(isDarkSquare(CRUCIFORM, sqA));
    expect(isDarkSquare(CRUCIFORM, squareAt(CRUCIFORM, 5, 6))).toBe(!isDarkSquare(CRUCIFORM, sqA));
  });
});
