import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE, SPY_WORDS, UNLIMITED, clueProblem, deal, giveClue, guessesFor, parseCustomWords,
  passTurn, remaining, reveal, validCount, type CardColor, type SpiesGame, type SpyTeam,
} from '../index.js';

/** A seeded generator, so a dealt board is the same every run. */
function rng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const game = (starting: SpyTeam = 'red') => deal(SPY_WORDS, rng(7), starting);
const first = (g: SpiesGame, color: CardColor) => g.key.findIndex((c, i) => c === color && g.revealed[i] === null);

describe('the word list', () => {
  it('has plenty of distinct words', () => {
    expect(new Set(SPY_WORDS).size).toBe(SPY_WORDS.length);
    expect(SPY_WORDS.length).toBeGreaterThan(350);
  });

  it('keeps two-word entries together', () => {
    expect(SPY_WORDS).toContain('ICE CREAM');
    expect(SPY_WORDS).not.toContain('CREAM');
  });
});

describe('dealing', () => {
  it('deals 25 words with 9, 8, 7 and an assassin', () => {
    const g = game('blue');
    expect(g.words).toHaveLength(BOARD_SIZE);
    expect(new Set(g.words).size).toBe(BOARD_SIZE);
    const count = (c: CardColor) => g.key.filter((k) => k === c).length;
    expect(count('blue')).toBe(9);
    expect(count('red')).toBe(8);
    expect(count('neutral')).toBe(7);
    expect(count('assassin')).toBe(1);
    expect(g.turn).toBe('blue');
    expect(g.phase).toBe('clue');
  });

  it('refuses a pool too small for a board', () => {
    expect(() => deal(SPY_WORDS.slice(0, 10), rng())).toThrow();
  });
});

describe('custom words', () => {
  it('splits, tidies, de-duplicates and drops junk', () => {
    const w = parseCustomWords('pizza, Pizza\n  dog   house ;x;<script>;a-ha;THIS WORD IS WAY TOO LONG TO USE');
    expect(w).toEqual(['PIZZA', 'DOG HOUSE', 'A-HA']);
  });
});

describe('clues', () => {
  it('must be a single real word', () => {
    const g = game();
    expect(clueProblem(g, '')).toMatch(/Give/);
    expect(clueProblem(g, 'two words')).toMatch(/One word/);
    expect(clueProblem(g, 'h4x!')).toMatch(/Letters/);
    expect(clueProblem(g, 'zyzzyva')).toBeNull();
  });

  it('cannot be a word on the board, or part of one', () => {
    const g = game();
    const board = g.words[0]!;
    expect(clueProblem(g, board.toLowerCase())).toMatch(/on the board/);
    g.words[1] = 'WATERFALL';
    g.words[2] = 'ICE CREAM';
    expect(clueProblem(g, 'water')).toMatch(/too close/);
    expect(clueProblem(g, 'cream')).toMatch(/part of/);
  });

  it('frees up a word once its card is revealed', () => {
    const g = game();
    giveClue(g, 'thing', UNLIMITED);
    const i = first(g, 'red');
    const word = g.words[i]!;
    reveal(g, i);
    passTurn(g);
    expect(clueProblem(g, word)).toBeNull();
  });

  it('allows one extra guess, or none for 0 and ∞', () => {
    expect(guessesFor(2)).toBe(3);
    expect(guessesFor(0)).toBe(UNLIMITED);
    expect(guessesFor(UNLIMITED)).toBe(UNLIMITED);
    expect(validCount(10)).toBe(false);
    expect(validCount(UNLIMITED)).toBe(true);
    expect(validCount(1.5)).toBe(false);
  });
});

describe('guessing', () => {
  it('keeps going on your own agent, up to the number plus one', () => {
    const g = game('red');
    giveClue(g, 'thing', 1);
    expect(reveal(g, first(g, 'red')).turnOver).toBe(false);
    expect(reveal(g, first(g, 'red')).turnOver).toBe(true);
    expect(g.turn).toBe('blue');
    expect(remaining(g, 'red')).toBe(7);
  });

  it('ends the turn on a bystander', () => {
    const g = game('red');
    giveClue(g, 'thing', 3);
    expect(reveal(g, first(g, 'neutral'))).toEqual({ color: 'neutral', turnOver: true });
    expect(g.turn).toBe('blue');
    expect(g.phase).toBe('clue');
  });

  it("ends the turn on the other side's agent, and counts it for them", () => {
    const g = game('red');
    giveClue(g, 'thing', 3);
    reveal(g, first(g, 'blue'));
    expect(g.turn).toBe('blue');
    expect(remaining(g, 'blue')).toBe(7);
  });

  it('loses the game on the assassin', () => {
    const g = game('red');
    giveClue(g, 'thing', 3);
    reveal(g, first(g, 'assassin'));
    expect(g.phase).toBe('ended');
    expect(g.winner).toBe('blue');
    expect(g.reason).toBe('assassin');
  });

  it('wins when the last agent is found', () => {
    const g = game('red');
    giveClue(g, 'thing', UNLIMITED);
    for (let i = 0; i < 9; i++) reveal(g, first(g, 'red'));
    expect(g.winner).toBe('red');
    expect(g.reason).toBe('agents');
  });

  it("hands the win to the other side when you find their last agent", () => {
    const g = game('red');
    for (let i = 0; i < 7; i++) g.revealed[first(g, 'blue')] = 'blue';
    giveClue(g, 'thing', 2);
    reveal(g, first(g, 'blue'));
    expect(g.winner).toBe('blue');
  });

  it('logs every clue with what was guessed on it', () => {
    const g = game('red');
    giveClue(g, 'thing', 2);
    reveal(g, first(g, 'red'));
    reveal(g, first(g, 'neutral'));
    giveClue(g, null, 1);
    expect(g.log).toHaveLength(2);
    expect(g.log[0]!.guesses.map((x) => x.color)).toEqual(['red', 'neutral']);
    expect(g.log[1]).toMatchObject({ team: 'blue', word: null, count: 1 });
  });

  it('refuses to reveal a card twice or outside the guess phase', () => {
    const g = game('red');
    expect(() => reveal(g, 0)).toThrow();
    giveClue(g, 'thing', UNLIMITED);
    const i = first(g, 'red');
    reveal(g, i);
    expect(() => reveal(g, i)).toThrow();
  });
});
