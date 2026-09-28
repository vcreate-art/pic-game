import { describe, expect, it } from 'vitest';
import {
  BINGO_LINES, CELLS, FREE, advanceTurn, ballLetter, callNumber, claim, completedLines, daub,
  hasPattern, lines, newGame, randomCallerCard, randomTurnsCard, turnOf, uncalled, validTurnsCard,
} from '../index.js';

function rng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** 1 to 25 in reading order, so a row is five consecutive numbers. */
const plain = () => Array.from({ length: CELLS }, (_, i) => i + 1);

describe('cards', () => {
  it('a turns card is 1 to 25, each once', () => {
    const card = randomTurnsCard(rng(3));
    expect(validTurnsCard(card)).toBe(true);
    expect([...card].sort((a, b) => a - b)).toEqual(plain());
  });

  it('rejects filled-in grids that are not 1 to 25', () => {
    expect(validTurnsCard(plain())).toBe(true);
    expect(validTurnsCard(plain().slice(1))).toBe(false);
    expect(validTurnsCard([...plain().slice(1), 2])).toBe(false);
    expect(validTurnsCard([...plain().slice(0, 24), 26])).toBe(false);
    expect(validTurnsCard([...plain().slice(0, 24), 2.5])).toBe(false);
    expect(validTurnsCard('1,2,3')).toBe(false);
  });

  it('a caller card keeps each column to its letter and frees the centre', () => {
    for (let seed = 1; seed < 20; seed++) {
      const card = randomCallerCard(rng(seed));
      expect(card[FREE]).toBe(0);
      expect(new Set(card).size).toBe(CELLS);
      card.forEach((n, i) => {
        if (i === FREE) return;
        const col = i % 5;
        expect(n).toBeGreaterThanOrEqual(col * 15 + 1);
        expect(n).toBeLessThanOrEqual(col * 15 + 15);
      });
    }
  });

  it('names balls by column', () => {
    expect([1, 15, 16, 30, 31, 45, 46, 60, 61, 75].map(ballLetter).join('')).toBe('BBIINNGGOO');
  });
});

describe('lines', () => {
  it('there are twelve: rows, columns and both diagonals', () => {
    expect(BINGO_LINES).toHaveLength(12);
    expect(BINGO_LINES).toContainEqual([0, 6, 12, 18, 24]);
    expect(BINGO_LINES).toContainEqual([4, 8, 12, 16, 20]);
  });

  it('counts completed lines, sharing squares where they cross', () => {
    const m = Array(CELLS).fill(false);
    for (const i of [0, 1, 2, 3, 4]) m[i] = true; // top row
    expect(completedLines(m)).toBe(1);
    for (const i of [5, 10, 15, 20]) m[i] = true; // left column
    expect(completedLines(m)).toBe(2);
    expect(completedLines(Array(CELLS).fill(true))).toBe(12);
  });

  it('knows a line from a full card', () => {
    const m = Array(CELLS).fill(false);
    for (const i of BINGO_LINES[10]!) m[i] = true;
    expect(hasPattern(m, 'line')).toBe(true);
    expect(hasPattern(m, 'blackout')).toBe(false);
    expect(hasPattern(Array(CELLS).fill(true), 'blackout')).toBe(true);
  });
});

describe('a turns game', () => {
  const game = () => newGame('turns', 'line', { a: plain(), b: [...plain()].reverse() });

  it('crosses a called number off every card', () => {
    const g = game();
    callNumber(g, 1);
    expect(g.marked.a![0]).toBe(true);
    expect(g.marked.b![24]).toBe(true);
    expect(uncalled(g)).toHaveLength(24);
  });

  it('will not call a number twice, or one off the grid', () => {
    const g = game();
    callNumber(g, 7);
    expect(() => callNumber(g, 7)).toThrow();
    expect(() => callNumber(g, 26)).toThrow();
    expect(() => callNumber(g, 0)).toThrow();
  });

  it('five lines wins, and whoever gets there on the same call shares it', () => {
    const g = game();
    // Rows 1-4 of `a` (1..20), then the diagonal's last cell (25).
    for (let n = 1; n <= 20; n++) expect(callNumber(g, n)).toEqual([]);
    expect(lines(g, 'a')).toBe(4);
    // `b` is `a` reversed, so the same numbers make the same number of lines.
    expect(lines(g, 'b')).toBe(4);
    expect(callNumber(g, 25)).toEqual(['a', 'b']);
    expect(g.winners).toEqual(['a', 'b']);
    expect(() => callNumber(g, 21)).toThrow();
  });

  it('passes the call round, skipping anyone who is away', () => {
    const g = newGame('turns', 'line', { a: plain(), b: plain(), c: plain() });
    expect(turnOf(g)).toBe('a');
    advanceTurn(g);
    expect(turnOf(g)).toBe('b');
    advanceTurn(g, (id) => id === 'c');
    expect(turnOf(g)).toBe('a');
    expect(advanceTurn(g, () => true)).toBe(false);
  });
});

describe('a caller game', () => {
  const card = () => randomCallerCard(rng(11));

  it('starts with only the free square daubed', () => {
    const g = newGame('caller', 'line', { a: card() });
    expect(g.marked.a!.filter(Boolean)).toHaveLength(1);
    expect(g.marked.a![FREE]).toBe(true);
    expect(uncalled(g)).toHaveLength(75);
  });

  it('only a called number can be daubed, and a daub can be taken back', () => {
    const c = card();
    const g = newGame('caller', 'line', { a: c });
    expect(daub(g, 'a', 0)).toBe(false);
    callNumber(g, c[0]!);
    expect(g.marked.a![0]).toBe(false); // drawing is not daubing
    expect(daub(g, 'a', 0)).toBe(true);
    expect(g.marked.a![0]).toBe(true);
    expect(daub(g, 'a', 0)).toBe(true);
    expect(g.marked.a![0]).toBe(false);
    expect(daub(g, 'a', FREE)).toBe(false);
    expect(daub(g, 'nobody', 0)).toBe(false);
  });

  it('auto-daub marks every card as balls come out', () => {
    const c = card();
    const g = newGame('caller', 'line', { a: c });
    callNumber(g, c[3]!, true);
    expect(g.marked.a![3]).toBe(true);
  });

  it('a BINGO needs the pattern daubed; the first good one wins', () => {
    const a = card();
    const b = randomCallerCard(rng(12));
    const g = newGame('caller', 'line', { a, b });
    expect(claim(g, 'a')).toBe(false);
    // The middle row runs through the free square.
    for (const i of [10, 11, 13, 14]) {
      callNumber(g, a[i]!);
      daub(g, 'a', i);
    }
    expect(claim(g, 'a')).toBe(true);
    expect(g.winners).toEqual(['a']);
    expect(claim(g, 'b')).toBe(false);
  });

  it('blackout needs the whole card', () => {
    const a = card();
    const g = newGame('caller', 'blackout', { a });
    for (const i of [10, 11, 13, 14]) {
      callNumber(g, a[i]!, true);
    }
    expect(claim(g, 'a')).toBe(false);
    for (let i = 0; i < CELLS; i++) if (a[i] && !g.called.includes(a[i]!)) callNumber(g, a[i]!, true);
    expect(claim(g, 'a')).toBe(true);
  });
});
