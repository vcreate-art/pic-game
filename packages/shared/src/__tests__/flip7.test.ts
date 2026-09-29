import { describe, expect, it } from 'vitest';
import {
  FLIP7_BONUS, Flip7Error, buildDeck, choose, faceKey, flip7AutoMove, flip7Depart, flip7Turn, hit,
  newFlip7, nextRound, pendingChoice, roundScore, stay,
  type Flip7Card, type Flip7Face, type Flip7Game, type Flip7Hand,
} from '../index.js';

function rng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Faces by shorthand: 7 is a number, '+4' a plus card, 'x2', 'freeze', 'flip3', 'second'.
type F = number | string;
function face(f: F): Flip7Face {
  if (typeof f === 'number') return { kind: 'number', value: f };
  if (f.startsWith('+')) return { kind: 'plus', value: Number(f.slice(1)) };
  if (f === 'x2') return { kind: 'times2' };
  return { kind: f as 'freeze' | 'flip3' | 'second' };
}
/** A deck in draw order, padded with 0s it should never reach. */
const stack = (...fs: F[]): Flip7Card[] =>
  [...fs, ...Array(40).fill(0)].map((f, id) => ({ id: 1000 + id, face: face(f) }));

/** A three-player game, A dealing, so B then C then A get the opening cards. */
const game = (...fs: F[]): Flip7Game => newFlip7(['A', 'B', 'C'], 200, rng(), stack(...fs));
const nums = (g: Flip7Game, id: string) => g.hands[id]!.numbers.map((c) => (c.face.kind === 'number' ? c.face.value : -1));

describe('the deck', () => {
  it('is the 94 cards of the box', () => {
    const d = buildDeck();
    expect(d).toHaveLength(94);
    const count = (k: string) => d.filter((c) => faceKey(c.face) === k).length;
    expect(count('n0')).toBe(1);
    expect(count('n1')).toBe(1);
    expect(count('n7')).toBe(7);
    expect(count('n12')).toBe(12);
    for (const k of ['p2', 'p4', 'p6', 'p8', 'p10', 'x2']) expect(count(k)).toBe(1);
    for (const k of ['freeze', 'flip3', 'second']) expect(count(k)).toBe(3);
    expect(new Set(d.map((c) => c.id)).size).toBe(94);
  });
});

describe('scoring', () => {
  const hand = (fs: F[], status: Flip7Hand['status'] = 'stayed'): Flip7Hand => {
    const cards = stack(...fs).slice(0, fs.length);
    return {
      numbers: cards.filter((c) => c.face.kind === 'number'),
      modifiers: cards.filter((c) => c.face.kind === 'plus' || c.face.kind === 'times2'),
      second: null,
      status,
    };
  };

  it('adds the numbers', () => expect(roundScore(hand([3, 9, 12]))).toBe(24));
  it('doubles the numbers before adding the + cards', () => expect(roundScore(hand([3, 9, 'x2', '+4']))).toBe(28));
  it('gives 15 for a Flip 7', () => expect(roundScore(hand([0, 1, 2, 3, 4, 5, 6], 'flip7'))).toBe(21 + FLIP7_BONUS));
  it('scores nothing on a bust, + cards and all', () => expect(roundScore(hand([8, 8, '+10'], 'bust'))).toBe(0));
});

describe('a round', () => {
  it('deals one card each, from the left of the dealer, and B goes first', () => {
    const g = game(5, 6, 7);
    expect(nums(g, 'B')).toEqual([5]);
    expect(nums(g, 'C')).toEqual([6]);
    expect(nums(g, 'A')).toEqual([7]);
    expect(flip7Turn(g)).toBe('B');
  });

  it('hitting takes a card and passes the turn; only the player to move may', () => {
    const g = game(5, 6, 7, 9);
    expect(() => hit(g, 'C')).toThrow(Flip7Error);
    hit(g, 'B');
    expect(nums(g, 'B')).toEqual([5, 9]);
    expect(flip7Turn(g)).toBe('C');
  });

  it('a duplicate busts you, and play skips you after', () => {
    const g = game(5, 6, 7, 5);
    hit(g, 'B');
    expect(g.hands.B!.status).toBe('bust');
    expect(g.events.at(-1)).toMatchObject({ kind: 'draw', to: 'B', bust: true });
    stay(g, 'C');
    stay(g, 'A');
    expect(g.stage).toBe('roundEnd');
    expect(g.lastRound).toEqual({ A: 7, B: 0, C: 6 });
  });

  it('a Second Chance takes the hit instead, and is used up', () => {
    const g = game(5, 6, 7, 'second', 1, 2, 5, 3, 4, 5);
    hit(g, 'B'); // Second Chance
    expect(g.hands.B!.second).not.toBeNull();
    hit(g, 'C');
    hit(g, 'A');
    hit(g, 'B'); // the duplicate 5
    expect(g.hands.B!.status).toBe('active');
    expect(g.hands.B!.second).toBeNull();
    expect(nums(g, 'B')).toEqual([5]);
    expect(g.events.at(-1)).toMatchObject({ saved: true });
  });

  it('seven different numbers is a Flip 7: the round ends at once, +15', () => {
    const g = game(0, 9, 10, 1, 2, 3, 4, 5, 6);
    hit(g, 'B');
    stay(g, 'C');
    stay(g, 'A');
    // B is the only one left in, so it is B's go every time.
    for (let i = 0; i < 5; i++) hit(g, 'B');
    expect(g.hands.B!.status).toBe('flip7');
    expect(g.stage).toBe('roundEnd');
    expect(g.lastRound!.B).toBe(21 + FLIP7_BONUS);
  });

  it('stays until nobody is left, then banks everyone', () => {
    const g = game(5, 6, 7);
    stay(g, 'B');
    stay(g, 'C');
    expect(g.stage).toBe('turn');
    stay(g, 'A');
    expect(g.stage).toBe('roundEnd');
    expect(g.totals).toEqual({ A: 7, B: 5, C: 6 });
  });

  it('the next round clears the table and the deal moves on', () => {
    const g = game(5, 6, 7, 1, 2, 3);
    stay(g, 'B');
    stay(g, 'C');
    stay(g, 'A');
    nextRound(g);
    expect(g.round).toBe(2);
    // B deals now, so C, A, B take the opening cards and C goes first.
    expect(nums(g, 'C')).toEqual([1]);
    expect(nums(g, 'A')).toEqual([2]);
    expect(nums(g, 'B')).toEqual([3]);
    expect(flip7Turn(g)).toBe('C');
    expect(g.discard).toHaveLength(3);
  });
});

describe('action cards', () => {
  it('Freeze: the holder picks anyone still in, and they bank and stop', () => {
    const g = game(5, 6, 7, 'freeze');
    hit(g, 'B');
    expect(g.stage).toBe('target');
    expect(pendingChoice(g)).toMatchObject({ by: 'B', options: ['A', 'B', 'C'] });
    expect(() => choose(g, 'C', 'A')).toThrow(Flip7Error);
    choose(g, 'B', 'C');
    expect(g.hands.C!.status).toBe('frozen');
    // B's go is over, and C is out, so it is A.
    expect(flip7Turn(g)).toBe('A');
  });

  it('with only one player it can go to, it goes there without asking', () => {
    const g = game(5, 6, 7, 'freeze');
    stay(g, 'B');
    stay(g, 'C');
    hit(g, 'A'); // A is the only one left
    expect(g.hands.A!.status).toBe('frozen');
    expect(g.stage).toBe('roundEnd');
  });

  it('Flip Three: three cards, one at a time, stopping at a bust', () => {
    const g = game(5, 6, 7, 'flip3', 1, 6, 9);
    hit(g, 'B');
    choose(g, 'B', 'C');
    expect(nums(g, 'C')).toEqual([6, 1, 6]);
    expect(g.hands.C!.status).toBe('bust');
    // The 9 was never drawn.
    expect(g.deck.at(-1)!.face).toEqual({ kind: 'number', value: 9 });
  });

  it('actions turned up by a Flip Three wait until it is over', () => {
    const g = game(5, 6, 7, 'flip3', 1, 'freeze', 2);
    hit(g, 'B');
    choose(g, 'B', 'C');
    expect(nums(g, 'C')).toEqual([6, 1, 2]);
    // Now C, who took the Freeze, chooses where it goes.
    expect(pendingChoice(g)).toMatchObject({ by: 'C' });
    choose(g, 'C', 'A');
    expect(g.hands.A!.status).toBe('frozen');
  });

  it('a Flip 7 partway through a Flip Three ends the round, and loses no cards', () => {
    const g = game(0, 9, 10, 1, 2, 3, 4, 'flip3', 'freeze', 5, 6);
    hit(g, 'B');
    stay(g, 'C');
    stay(g, 'A');
    for (let i = 0; i < 3; i++) hit(g, 'B');
    hit(g, 'B'); // Flip Three, and B is the only one it can go to
    expect(g.hands.B!.status).toBe('flip7');
    expect(g.stage).toBe('roundEnd');
    expect(g.discard.map((c) => c.face.kind)).toEqual(['flip3', 'freeze']);
  });

  it('a bust on a Flip Three throws away what it turned up', () => {
    const g = game(5, 6, 7, 'flip3', 'freeze', 6);
    hit(g, 'B');
    choose(g, 'B', 'C');
    expect(g.hands.C!.status).toBe('bust');
    expect(g.stage).toBe('turn');
    expect(Object.values(g.hands).some((h) => h.status === 'frozen')).toBe(false);
  });

  it('a second Second Chance must go to someone without one', () => {
    const g = game(5, 6, 7, 'second', 1, 2, 'second');
    hit(g, 'B');
    hit(g, 'C');
    hit(g, 'A');
    hit(g, 'B');
    expect(pendingChoice(g)).toMatchObject({ by: 'B', options: ['A', 'C'] });
    choose(g, 'B', 'A');
    expect(g.hands.A!.second).not.toBeNull();
  });

  it('with nobody to take a spare Second Chance, it is discarded', () => {
    const g = game(5, 6, 7, 'second', 'second');
    stay(g, 'B');
    stay(g, 'C');
    hit(g, 'A');
    hit(g, 'A');
    expect(g.events.at(-1)).toMatchObject({ kind: 'discard', by: 'A' });
  });

  it('an action card in the opening deal is played before the deal goes on', () => {
    const g = game(5, 'freeze', 6, 7);
    // C drew the Freeze and must choose; A has not had a card yet.
    expect(pendingChoice(g)).toMatchObject({ by: 'C' });
    expect(nums(g, 'A')).toEqual([]);
    choose(g, 'C', 'B');
    expect(g.hands.B!.status).toBe('frozen');
    expect(nums(g, 'A')).toEqual([6]);
    // C got no number, but is still in: C goes first after B is frozen.
    expect(flip7Turn(g)).toBe('C');
  });
});

describe('winning', () => {
  it('ends when someone is at the target after a round, clear of the rest', () => {
    const g = newFlip7(['A', 'B'], 10, rng(), stack(3, 12, 4, 12));
    stay(g, 'B'); // 3
    stay(g, 'A'); // 12
    expect(g.stage).toBe('ended');
    expect(g.winners).toEqual(['A']);
  });

  it('a tie at the top plays another round', () => {
    const g = newFlip7(['A', 'B'], 10, rng(), stack(12, 12));
    stay(g, 'B');
    stay(g, 'A');
    expect(g.totals).toEqual({ A: 12, B: 12 });
    expect(g.stage).toBe('roundEnd');
  });
});

describe('the deck running out', () => {
  it('shuffles the discards back in', () => {
    const g = newFlip7(['A', 'B'], 500, rng(), stack(1, 2).slice(0, 2));
    stay(g, 'B');
    stay(g, 'A');
    nextRound(g);
    expect(g.round).toBe(2);
    expect(nums(g, 'A').length + nums(g, 'B').length).toBe(2);
  });
});

describe('players who are not there', () => {
  it('an away turn is a stay; an away choice goes somewhere it may', () => {
    const g = game(5, 6, 7, 'freeze');
    flip7AutoMove(g);
    expect(g.hands.B!.status).toBe('stayed');
    hit(g, 'C');
    flip7AutoMove(g);
    expect(Object.values(g.hands).filter((h) => h.status === 'frozen')).toHaveLength(1);
  });

  it('a player who leaves takes no more turns and cannot win', () => {
    const g = newFlip7(['A', 'B', 'C'], 5, rng(), stack(5, 6, 12));
    flip7Depart(g, 'B');
    expect(flip7Turn(g)).toBe('C');
    stay(g, 'C');
    stay(g, 'A');
    expect(g.winners).toEqual(['A']);
  });
});

describe('whole games at random', () => {
  /** Every card is somewhere: the deck, the discards, or in front of someone. */
  function cardCount(g: Flip7Game): number {
    let n = g.deck.length + g.discard.length + g.pending.length + (g.flipping?.aside.length ?? 0);
    for (const h of Object.values(g.hands)) n += h.numbers.length + h.modifiers.length + (h.second ? 1 : 0);
    return n;
  }

  it('never lose a card, never stall, and always end with a winner', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const players = ['A', 'B', 'C', 'D', 'E'].slice(0, 2 + (seed % 4));
      const g = newFlip7(players, 150, r);
      let moves = 0;
      while (g.stage !== 'ended') {
        expect(cardCount(g)).toBe(94);
        if (++moves > 5000) throw new Error(`seed ${seed} never ended`);
        const p = pendingChoice(g);
        if (p) choose(g, p.by, p.options[Math.floor(r() * p.options.length)]!);
        else if (g.stage === 'roundEnd') nextRound(g);
        else {
          const id = flip7Turn(g);
          expect(id).not.toBeNull();
          if (r() < 0.65) hit(g, id!);
          else stay(g, id!);
        }
      }
      expect(g.winners).toHaveLength(1);
      expect(g.totals[g.winners[0]!]).toBeGreaterThanOrEqual(150);
    }
  });
});
