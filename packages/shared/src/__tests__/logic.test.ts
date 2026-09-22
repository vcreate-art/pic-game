import { describe, expect, it } from 'vitest';
import {
  drawerPoints, guessPoints, judge, levenshtein, maskOf, normalize,
  pickHintPositions, quantize, dequantize, sanitizePoints, QUANT, LOGICAL_W, LOGICAL_H,
} from '../index.js';

describe('normalize', () => {
  it('folds case, punctuation and accents together', () => {
    expect(normalize('Ice-Cream')).toBe('ice cream');
    expect(normalize('  CAFÉ!! ')).toBe('cafe');
    expect(normalize('yo-yo')).toBe('yo yo');
  });
});

describe('levenshtein', () => {
  it('measures edit distance', () => {
    expect(levenshtein('cat', 'cat')).toBe(0);
    expect(levenshtein('cat', 'cot')).toBe(1);
    expect(levenshtein('cat', 'cats')).toBe(1);
  });

  it('bails out past the cap instead of computing the true distance', () => {
    expect(levenshtein('apple', 'zzzzzzzzz', 2)).toBeGreaterThan(2);
  });
});

describe('judge', () => {
  it('accepts the word regardless of case and spacing', () => {
    expect(judge('Ice Cream', 'ice cream')).toBe('correct');
    // Dropping the space is not a mistake worth punishing.
    expect(judge('  icecream ', 'ice cream')).toBe('correct');
    expect(judge('yoyo', 'yo-yo')).toBe('correct');
    expect(judge('ELEPHANT', 'elephant')).toBe('correct');
  });

  it('flags a one-letter miss on a long word as close', () => {
    expect(judge('elephent', 'elephant')).toBe('close');
    expect(judge('rocket', 'rockets')).toBe('close');
  });

  it('never calls a short word close, which would give away too much', () => {
    // 'cat' vs 'bat' is distance 1, but on a 3-letter word that narrows
    // the answer to almost nothing.
    expect(judge('bat', 'cat')).toBe('wrong');
  });

  it('rejects empty and unrelated guesses', () => {
    expect(judge('', 'cat')).toBe('wrong');
    expect(judge('helicopter', 'cat')).toBe('wrong');
  });
});

describe('maskOf', () => {
  it('hides letters but keeps word shape', () => {
    expect(maskOf('cat')).toBe('___');
    expect(maskOf('ice cream')).toBe('___ _____');
    expect(maskOf('yo-yo')).toBe('__-__');
  });
});

describe('pickHintPositions', () => {
  const seq = () => 0.5;

  it('never reveals more than half the letters minus one', () => {
    // 'cat' has 3 letters -> cap is floor(3/2)-1 = 0
    expect(pickHintPositions('cat', 2, seq)).toHaveLength(0);
    // 'elephant' has 8 -> cap is 3
    expect(pickHintPositions('elephant', 99, seq)).toHaveLength(3);
  });

  it('only ever points at letters, never spaces or hyphens', () => {
    const word = 'ice cream';
    for (const i of pickHintPositions(word, 3, Math.random)) {
      expect(word[i]).not.toBe(' ');
      expect(word[i]).not.toBe('-');
    }
  });

  it('returns positions in order', () => {
    const got = pickHintPositions('xylophone', 3, Math.random);
    expect([...got].sort((a, b) => a - b)).toEqual(got);
  });
});

describe('guessPoints', () => {
  it('pays more the earlier the guess lands', () => {
    const fast = guessPoints(70_000, 80, 1);
    const slow = guessPoints(5_000, 80, 1);
    expect(fast).toBeGreaterThan(slow);
  });

  it('adds a bonus for being first and only for being first', () => {
    expect(guessPoints(40_000, 80, 0)).toBeGreaterThan(guessPoints(40_000, 80, 1));
    expect(guessPoints(40_000, 80, 1)).toBe(guessPoints(40_000, 80, 2));
  });

  it('still pays something at the buzzer, and never goes negative', () => {
    expect(guessPoints(0, 80, 3)).toBeGreaterThan(0);
    expect(guessPoints(-5_000, 80, 3)).toBeGreaterThan(0);
  });
});

describe('drawerPoints', () => {
  it('pays nothing when nobody understood the drawing', () => {
    expect(drawerPoints(0, 5)).toBe(0);
  });

  it('pays more as more players guess', () => {
    expect(drawerPoints(5, 5)).toBeGreaterThan(drawerPoints(1, 5));
  });

  it('handles a room with no eligible guessers', () => {
    expect(drawerPoints(0, 0)).toBe(0);
  });
});

describe('quantize round-trip', () => {
  it('survives the wire with sub-pixel error', () => {
    for (const [x, y] of [[0, 0], [400, 300], [799.4, 599.2]] as const) {
      const [qx, qy] = quantize(x, y);
      const [rx, ry] = dequantize(qx, qy);
      expect(Math.abs(rx - x)).toBeLessThan(0.5);
      expect(Math.abs(ry - y)).toBeLessThan(0.5);
    }
  });

  it('clamps out-of-bounds input rather than emitting junk', () => {
    expect(quantize(-50, -50)).toEqual([0, 0]);
    expect(quantize(99_999, 99_999)).toEqual([QUANT, QUANT]);
  });

  it('maps the far corner to the canvas bounds', () => {
    const [x, y] = dequantize(QUANT, QUANT);
    expect(x).toBeCloseTo(LOGICAL_W);
    expect(y).toBeCloseTo(LOGICAL_H);
  });
});

describe('sanitizePoints', () => {
  it('accepts well-formed pairs', () => {
    expect(sanitizePoints([0, 0, 100, 200])).toEqual([0, 0, 100, 200]);
  });

  it('rejects anything a hand-written client might send', () => {
    expect(sanitizePoints([1, 2, 3])).toBeNull();          // odd length
    expect(sanitizePoints([])).toBeNull();                  // empty
    expect(sanitizePoints('nope')).toBeNull();              // not an array
    expect(sanitizePoints([1.5, 2])).toBeNull();            // non-integer
    expect(sanitizePoints([-1, 0])).toBeNull();             // out of range
    expect(sanitizePoints([QUANT + 1, 0])).toBeNull();      // above the grid
    expect(sanitizePoints([NaN, 0])).toBeNull();
  });

  it('refuses an oversized array', () => {
    expect(sanitizePoints(new Array(20_000).fill(0))).toBeNull();
  });
});
