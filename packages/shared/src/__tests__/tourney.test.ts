import { describe, expect, it } from 'vitest';
import {
  MK11_ROSTER, TOURNEY_DEFAULTS, alive, bonusesFor, cancelMatch, endNow, feeFor, lapQueue,
  newEntrant, newTourney, pointsInPlay, report, riseAfter, standings, startMatch, startTourney,
  swapNext, validateTourney, type TourneySettings, type TourneyState,
} from '../index.js';

function rng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const NO_BONUS = { clean: 0, streak: 0, flawless: 0, fatality: 0, brutality: 0 };

function tourney(n: number, settings: Partial<TourneySettings> = {}, seed = 1): TourneyState {
  const t = newTourney({ ...TOURNEY_DEFAULTS, ...settings });
  for (let i = 0; i < n; i++) t.entrants.push(newEntrant(`p${i}`, `P${i}`, null, null));
  startTourney(t, rng(seed));
  return t;
}
const e = (t: TourneyState, id: string) => t.entrants.find((x) => x.id === id)!;
/** Plays the match up next, with `pick` choosing the winner. */
function play(t: TourneyState, pick: (a: string, b: string) => string = (a) => a, score: '2-0' | '2-1' = '2-1') {
  startMatch(t);
  const { a, b } = t.current!;
  return report(t, pick(a, b), score, [], null, rng(9));
}

describe('the entry fee', () => {
  it('rises like blinds, to the nearest 10', () => {
    const s = { ...TOURNEY_DEFAULTS, entryFee: 100, riseEvery: 3, risePercent: 50 };
    expect([1, 2, 3, 4, 6, 7, 10].map((n) => feeFor(s, n))).toEqual([100, 100, 100, 150, 150, 230, 340]);
    expect(riseAfter(s, 3)).toBe(true);
    expect(riseAfter(s, 4)).toBe(false);
  });

  it('can stay flat', () => {
    const s = { ...TOURNEY_DEFAULTS, riseEvery: 0 };
    expect(feeFor(s, 1)).toBe(feeFor(s, 99));
  });
});

describe('the circle', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

  it('has n matches a lap, with everyone playing both neighbours', () => {
    for (let n = 2; n <= 12; n++) {
      const circle = ids(n);
      const q = lapQueue(circle);
      expect(q).toHaveLength(n);
      for (const id of circle) expect(q.filter((m) => m.includes(id))).toHaveLength(2);
      for (let i = 0; i < n; i++) {
        const [x, y] = [circle[i]!, circle[(i + 1) % n]!];
        expect(q.some(([a, b]) => (a === x && b === y) || (a === y && b === x))).toBe(true);
      }
    }
  });

  it('two players meet twice', () => {
    expect(lapQueue(['a', 'b'])).toEqual([['a', 'b'], ['b', 'a']]);
  });

  it('nobody fights twice in a row from five players up', () => {
    for (let n = 5; n <= 16; n++) {
      const q = lapQueue(ids(n));
      for (let i = 1; i < q.length; i++) expect(q[i]!.some((id) => q[i - 1]!.includes(id))).toBe(false);
    }
  });

  it('a new lap seats a fresh circle of whoever is left', () => {
    const t = tourney(5, { riseEvery: 0, bonuses: NO_BONUS });
    expect(t.lap).toBe(1);
    expect([...t.circle].sort()).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    for (let i = 0; i < 5; i++) play(t);
    expect(t.lap).toBe(2);
    expect(t.queue).toHaveLength(5);
  });

  it('skips the rest of a lap for someone knocked out', () => {
    // A fee as big as the stack: every loser is out on the spot.
    const t = tourney(5, { startPoints: 100, entryFee: 100, riseEvery: 0, bonuses: NO_BONUS });
    const r = play(t);
    const out = r.winner === r.a ? r.b : r.a;
    expect(e(t, out).outOnTurn).toBe(1);
    expect(t.queue.flat()).not.toContain(out);
    while (t.phase === 'ready') {
      expect(t.queue[0]!.every((id) => e(t, id).outOnTurn === null)).toBe(true);
      if (!t.circle.includes(out)) break;
      play(t);
    }
  });
});

describe('a match', () => {
  it('takes the fee from both and pays the pot to the winner', () => {
    const t = tourney(3, { bonuses: NO_BONUS });
    startMatch(t);
    const { a, b, pot } = t.current!;
    expect(pot).toBe(200);
    expect(e(t, a).points).toBe(900);
    report(t, a, '2-1', [], null, rng());
    expect(e(t, a).points).toBe(1100);
    expect(e(t, b).points).toBe(900);
    expect(e(t, a).wins).toBe(1);
    expect(e(t, b).losses).toBe(1);
  });

  it('goes all-in when a stack is short, and the other side only matches it', () => {
    const t = tourney(2, { bonuses: NO_BONUS, riseEvery: 0 });
    const [a, b] = t.queue[0]!;
    e(t, a).points = 40;
    startMatch(t);
    expect(t.current!.stake).toBe(40);
    expect(t.current!.pot).toBe(80);
    expect(e(t, a).points).toBe(0);
    expect(e(t, b).points).toBe(960);
    report(t, b, '2-0', [], null, rng());
    expect(e(t, a).outOnTurn).toBe(1);
    expect(t.phase).toBe('ended');
    expect(t.winners).toEqual([b]);
  });

  it('refuses a winner who was not in it', () => {
    const t = tourney(3);
    startMatch(t);
    const other = t.entrants.find((x) => x.id !== t.current!.a && x.id !== t.current!.b)!;
    expect(() => report(t, other.id, '2-0', [], null, rng())).toThrow();
    expect(() => report(t, t.current!.a, '3-0' as '2-0', [], null, rng())).toThrow();
  });

  it('can be called off, with the entries back', () => {
    const t = tourney(3);
    const pair = [...t.queue[0]!];
    const before = pointsInPlay(t);
    startMatch(t);
    cancelMatch(t);
    expect(t.queue[0]).toEqual(pair);
    expect(t.entrants.every((x) => x.points === 1000)).toBe(true);
    expect(pointsInPlay(t)).toBe(before);
  });

  it('can swap in someone else before it starts', () => {
    const t = tourney(4);
    const [a, b] = t.queue[0]!;
    const sub = t.entrants.find((x) => x.id !== a && x.id !== b)!.id;
    swapNext(t, 1, sub);
    expect(t.queue[0]).toEqual([a, sub]);
    expect(() => swapNext(t, 1, a)).toThrow();
  });
});

describe('bonuses', () => {
  it('pays a clean 2-0, a growing streak and what the host ticks', () => {
    const t = tourney(2, { riseEvery: 0 });
    const winner = t.queue[0]![0];
    const r1 = play(t, () => winner, '2-1');
    expect(r1.bonuses).toEqual([]);
    const r2 = play(t, () => winner, '2-0');
    expect(r2.bonuses).toEqual([{ kind: 'clean', points: 50 }, { kind: 'streak', points: 50 }]);
    startMatch(t);
    expect(bonusesFor(t, winner, '2-1', ['fatality', 'flawless']).map((b) => [b.kind, b.points])).toEqual([
      ['streak', 100], ['flawless', 50], ['fatality', 100],
    ]);
  });

  it('a loss ends the streak', () => {
    const t = tourney(2, { riseEvery: 0 });
    const [x, y] = t.queue[0]!;
    play(t, () => x);
    play(t, () => x);
    expect(e(t, x).streak).toBe(2);
    play(t, () => y);
    expect(e(t, x).streak).toBe(0);
    expect(e(t, x).bestStreak).toBe(2);
  });

  it('a bonus set to 0 is not paid', () => {
    const t = tourney(2, { bonuses: { ...TOURNEY_DEFAULTS.bonuses, clean: 0 } });
    expect(play(t, (a) => a, '2-0').bonuses).toEqual([]);
  });
});

describe('the end', () => {
  it('the host can call it: the leader wins, ties shared', () => {
    const t = tourney(3, { bonuses: NO_BONUS });
    endNow(t);
    expect(t.phase).toBe('ended');
    expect(t.winners).toHaveLength(3);
    const u = tourney(3, { bonuses: NO_BONUS });
    const r = play(u);
    startMatch(u);
    endNow(u);
    expect(u.entrants.reduce((s, x) => s + x.points, 0)).toBe(3000);
    expect(u.winners).toEqual([r.winner]);
  });

  it('ranks by points, then by who lasted longer', () => {
    const t = tourney(4, { startPoints: 100, entryFee: 100, riseEvery: 0, bonuses: NO_BONUS });
    // The lower id always wins, so it ends. (Always the first-listed seat would
    // not: two players swap sides each lap and would trade the same pot forever.)
    const favourite = (a: string, b: string) => (a < b ? a : b);
    for (let guard = 0; t.phase === 'ready' && guard < 50; guard++) play(t, favourite);
    expect(t.phase).toBe('ended');
    const order = standings(t);
    expect(order[0]!.id).toBe(t.winners[0]);
    const outs = order.slice(1).map((x) => x.outOnTurn!);
    expect([...outs].sort((a, b) => b - a)).toEqual(outs);
  });
});

describe('whole games', () => {
  it('always finish with one winner, and points only appear as bonuses', () => {
    for (let n = 2; n <= 12; n++) {
      for (let seed = 1; seed <= 4; seed++) {
        const r = rng(seed * 100 + n);
        const t = tourney(n, {}, seed);
        let bonus = 0;
        let guard = 0;
        while (t.phase === 'ready' && guard++ < 5000) {
          const before = pointsInPlay(t);
          startMatch(t);
          expect(pointsInPlay(t)).toBe(before);
          const { a, b } = t.current!;
          const rec = report(t, r() < 0.5 ? a : b, r() < 0.5 ? '2-0' : '2-1', r() < 0.2 ? ['fatality'] : [], null, r);
          bonus += rec.bonuses.reduce((s, x) => s + x.points, 0);
          expect(t.entrants.every((x) => x.points >= 0)).toBe(true);
          expect(pointsInPlay(t)).toBe(n * 1000 + bonus);
          // Nobody who is out is ever lined up.
          for (const pair of t.queue) expect(pair.every((id) => e(t, id).outOnTurn === null)).toBe(true);
        }
        expect(t.phase).toBe('ended');
        expect(t.winners).toHaveLength(1);
        expect(alive(t)).toHaveLength(1);
      }
    }
  });
});

describe('restoring a saved tournament', () => {
  it('takes back a real one, minus the room links', () => {
    const t = tourney(4);
    t.entrants[0]!.playerId = 'someone';
    t.entrants[1]!.main = MK11_ROSTER[0]!;
    play(t);
    startMatch(t);
    const back = validateTourney(JSON.parse(JSON.stringify(t)))!;
    expect(back).not.toBeNull();
    expect(back.entrants[0]!.playerId).toBeNull();
    expect({ ...back, entrants: back.entrants.map((x) => ({ ...x, playerId: 'x' })) })
      .toEqual({ ...t, entrants: t.entrants.map((x) => ({ ...x, playerId: 'x' })) });
  });

  it('refuses one that does not add up', () => {
    const t = tourney(3);
    const bad = (f: (x: any) => void) => {
      const c = JSON.parse(JSON.stringify(t));
      f(c);
      return validateTourney(c);
    };
    expect(bad(() => {})).not.toBeNull();
    expect(bad((c) => (c.entrants[0].points = -5))).toBeNull();
    expect(bad((c) => (c.queue[0] = ['p0', 'ghost']))).toBeNull();
    expect(bad((c) => (c.entrants[1].id = c.entrants[0].id))).toBeNull();
    expect(bad((c) => (c.entrants[0].main = 'Goro'))).toBeNull();
    expect(bad((c) => (c.phase = 'fighting'))).toBeNull();
    expect(bad((c) => (c.settings.entryFee = 1e9))).toBeNull();
    expect(validateTourney(null)).toBeNull();
    expect(validateTourney('nope')).toBeNull();
  });
});
