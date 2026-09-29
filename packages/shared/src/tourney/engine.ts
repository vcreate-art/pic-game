import {
  MANUAL_BONUSES, MK11_ROSTER, TOURNEY_BOUNDS, TOURNEY_DEFAULTS,
  type BonusKind, type Entrant, type ManualBonus, type MatchScore, type TourneySettings,
  type TourneyState, type TurnRecord,
} from './types.js';

type Rng = () => number;

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function newTourney(settings: TourneySettings = TOURNEY_DEFAULTS): TourneyState {
  return {
    phase: 'setup',
    settings: structuredClone(settings),
    entrants: [],
    turn: 1,
    lap: 0,
    circle: [],
    queue: [],
    current: null,
    history: [],
    winners: [],
  };
}

export function newEntrant(id: string, name: string, main: string | null, playerId: string | null): Entrant {
  return {
    id, name, main, playerId,
    points: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0, bonusPoints: 0, outOnTurn: null,
  };
}

export const isMain = (m: unknown): m is string => typeof m === 'string' && MK11_ROSTER.includes(m);

/** The entry on a given turn: up by `risePercent` every `riseEvery` turns, to the nearest 10. */
export function feeFor(s: TourneySettings, turn: number): number {
  const steps = s.riseEvery > 0 ? Math.floor((turn - 1) / s.riseEvery) : 0;
  const fee = s.entryFee * (1 + s.risePercent / 100) ** steps;
  return Math.max(10, Math.round(fee / 10) * 10);
}

/** The fee goes up after this turn. */
export const riseAfter = (s: TourneySettings, turn: number) => feeFor(s, turn + 1) > feeFor(s, turn);

/**
 * The matches for one lap of a circle: every seat against the next, the last
 * wrapping to the first, so each player fights both neighbours. n players make
 * n matches. The even edges go first and then the odd ones, which keeps anyone
 * from fighting twice in a row wherever the numbers allow it (from five up).
 */
export function lapQueue(circle: readonly string[]): [string, string][] {
  const n = circle.length;
  if (n < 2) return [];
  const edge = (i: number): [string, string] => [circle[i]!, circle[(i + 1) % n]!];
  const idx = [...Array(n).keys()];
  return [...idx.filter((i) => i % 2 === 0), ...idx.filter((i) => i % 2 === 1)].map(edge);
}

export const alive = (t: TourneyState) => t.entrants.filter((e) => e.outOnTurn === null);
const byId = (t: TourneyState, id: string) => t.entrants.find((e) => e.id === id);
const isIn = (t: TourneyState, id: string) => byId(t, id)?.outOnTurn === null;

/**
 * Keeps the queue to matches that can be played: drops every pair with someone
 * knocked out, and seats a fresh circle when the lap is done.
 * A new circle is shuffled a few times over to avoid opening with someone
 * from the match just played.
 */
export function prepareNext(t: TourneyState, rng: Rng): void {
  t.queue = t.queue.filter((pair) => pair.every((id) => isIn(t, id)));
  if (t.queue.length) return;
  const ids = alive(t).map((e) => e.id);
  if (ids.length < 2) return;
  const last = t.history.at(-1);
  let circle = shuffle(ids, rng);
  for (let tries = 0; tries < 20 && last && ids.length > 3; tries++) {
    const [a, b] = lapQueue(circle)[0]!;
    if (![a, b].some((id) => id === last.a || id === last.b)) break;
    circle = shuffle(ids, rng);
  }
  t.circle = circle;
  t.queue = lapQueue(circle);
  t.lap += 1;
}

/** Starts the tournament: fresh stacks for everyone, and the first circle. */
export function startTourney(t: TourneyState, rng: Rng): void {
  if (t.entrants.length < TOURNEY_BOUNDS.entrants.min) throw new Error('Too few entrants');
  for (const e of t.entrants) {
    Object.assign(e, newEntrant(e.id, e.name, e.main, e.playerId), { points: t.settings.startPoints });
  }
  Object.assign(t, { phase: 'ready', turn: 1, lap: 0, circle: [], queue: [], current: null, history: [], winners: [] });
  prepareNext(t, rng);
}

/**
 * Both fighters pay in. Someone short of the fee goes all-in, and the other
 * only matches what they could put up, so nobody wins more than they risked.
 */
export function startMatch(t: TourneyState): void {
  if (t.phase !== 'ready' || !t.queue.length) throw new Error('No match ready');
  const [aId, bId] = t.queue.shift()!;
  const a = byId(t, aId)!;
  const b = byId(t, bId)!;
  const fee = feeFor(t.settings, t.turn);
  const stake = Math.min(fee, a.points, b.points);
  a.points -= stake;
  b.points -= stake;
  t.current = { a: aId, b: bId, fee, stake, pot: stake * 2 };
  t.phase = 'fighting';
}

/** Called off before a result: the entries go back and the pair is up next again. */
export function cancelMatch(t: TourneyState): void {
  const m = t.current;
  if (t.phase !== 'fighting' || !m) throw new Error('No match on');
  byId(t, m.a)!.points += m.stake;
  byId(t, m.b)!.points += m.stake;
  t.queue.unshift([m.a, m.b]);
  t.current = null;
  t.phase = 'ready';
}

/** What a win is worth on top of the pot. */
export function bonusesFor(
  t: TourneyState,
  winner: string,
  score: MatchScore,
  ticked: readonly ManualBonus[],
): { kind: BonusKind; points: number }[] {
  const b = t.settings.bonuses;
  const out: { kind: BonusKind; points: number }[] = [];
  if (score === '2-0' && b.clean) out.push({ kind: 'clean', points: b.clean });
  const run = (byId(t, winner)?.streak ?? 0) + 1;
  if (run >= 2 && b.streak) out.push({ kind: 'streak', points: b.streak * (run - 1) });
  for (const k of MANUAL_BONUSES) if (ticked.includes(k) && b[k]) out.push({ kind: k, points: b[k] });
  return out;
}

/**
 * The host's result. The winner takes the pot and their bonuses, the loser's
 * streak ends, and a loser left on nothing is out. With one player left, it is over.
 */
export function report(
  t: TourneyState,
  winner: string,
  score: MatchScore,
  ticked: readonly ManualBonus[],
  chars: TurnRecord['chars'],
  rng: Rng,
): TurnRecord {
  const m = t.current;
  if (t.phase !== 'fighting' || !m) throw new Error('No match on');
  if (winner !== m.a && winner !== m.b) throw new Error('Winner is not in this match');
  if (score !== '2-0' && score !== '2-1') throw new Error('Bad score');
  const w = byId(t, winner)!;
  const l = byId(t, winner === m.a ? m.b : m.a)!;
  const bonuses = bonusesFor(t, winner, score, ticked);
  const extra = bonuses.reduce((s, x) => s + x.points, 0);

  w.points += m.pot + extra;
  w.bonusPoints += extra;
  w.wins += 1;
  w.streak += 1;
  w.bestStreak = Math.max(w.bestStreak, w.streak);
  l.losses += 1;
  l.streak = 0;
  if (l.points <= 0) {
    l.points = 0;
    l.outOnTurn = t.turn;
  }

  const record: TurnRecord = { n: t.turn, lap: t.lap, a: m.a, b: m.b, fee: m.fee, pot: m.pot, winner, score, bonuses, chars };
  t.history.push(record);
  t.current = null;
  t.turn += 1;

  const left = alive(t);
  if (left.length < 2) {
    t.phase = 'ended';
    t.winners = left.map((e) => e.id);
    t.queue = [];
  } else {
    t.phase = 'ready';
    prepareNext(t, rng);
  }
  return record;
}

/** Puts someone else in the match up next, for a player who has stepped away. */
export function swapNext(t: TourneyState, side: 0 | 1, id: string): void {
  if (t.phase !== 'ready' || !t.queue.length) throw new Error('No match ready');
  const pair = t.queue[0]!;
  if (!isIn(t, id) || pair[1 - side] === id) throw new Error('Cannot play them');
  pair[side] = id;
}

/** The host calls it: any match on is refunded, and the leader wins, ties shared. */
export function endNow(t: TourneyState): void {
  if (t.phase === 'fighting') cancelMatch(t);
  if (t.phase !== 'ready') throw new Error('Not running');
  const top = Math.max(...t.entrants.map((e) => e.points));
  t.winners = t.entrants.filter((e) => e.points === top).map((e) => e.id);
  t.phase = 'ended';
  t.queue = [];
}

/** Best first: points, then who lasted longer, then wins, then fewer losses. */
export function standings(t: TourneyState): Entrant[] {
  return [...t.entrants].sort(
    (x, y) =>
      y.points - x.points ||
      (y.outOnTurn ?? Infinity) - (x.outOnTurn ?? Infinity) ||
      y.wins - x.wins ||
      x.losses - y.losses ||
      x.name.localeCompare(y.name),
  );
}

/** Every point that exists: stacks plus whatever is in the pot. */
export const pointsInPlay = (t: TourneyState) =>
  t.entrants.reduce((s, e) => s + e.points, 0) + (t.current?.pot ?? 0);

// -------------------------------------------------------------- restoring

const int = (n: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
const str = (s: unknown, max = 64): s is string => typeof s === 'string' && s.length > 0 && s.length <= max;

/**
 * A saved tournament coming back from a host's browser, checked all the way
 * through before it is trusted: shapes, ranges, and that every id it mentions
 * is an entrant. Returns a clean copy, or null.
 */
export function validateTourney(x: unknown): TourneyState | null {
  try {
    const t = x as TourneyState;
    if (!t || typeof t !== 'object') return null;
    if (!['setup', 'ready', 'fighting', 'ended'].includes(t.phase)) return null;
    const s = t.settings;
    const B = TOURNEY_BOUNDS;
    if (!str(s?.name, B.name.max) || !int(s.startPoints, B.startPoints.min, B.startPoints.max)
      || !int(s.entryFee, B.entryFee.min, B.entryFee.max) || !int(s.riseEvery, B.riseEvery.min, B.riseEvery.max)
      || !int(s.risePercent, B.risePercent.min, B.risePercent.max)) return null;
    const bonuses = s.bonuses;
    for (const k of ['clean', 'streak', ...MANUAL_BONUSES] as const) if (!int(bonuses?.[k], B.bonus.min, B.bonus.max)) return null;
    if (!Array.isArray(t.entrants) || t.entrants.length > B.entrants.max) return null;
    const ids = new Set<string>();
    for (const e of t.entrants) {
      if (!str(e?.id) || ids.has(e.id) || !str(e.name, 20) || !(e.main === null || isMain(e.main))) return null;
      if (![e.points, e.wins, e.losses, e.streak, e.bestStreak, e.bonusPoints].every((n) => int(n))) return null;
      if (!(e.outOnTurn === null || int(e.outOnTurn, 1))) return null;
      ids.add(e.id);
    }
    const known = (id: unknown) => typeof id === 'string' && ids.has(id);
    const pair = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(known) && p[0] !== p[1];
    if (!int(t.turn, 1) || !int(t.lap) || !Array.isArray(t.circle) || !t.circle.every(known)) return null;
    if (!Array.isArray(t.queue) || !t.queue.every(pair)) return null;
    if (!Array.isArray(t.winners) || !t.winners.every(known)) return null;
    const m = t.current;
    if (m !== null && !(pair([m?.a, m?.b]) && int(m.fee) && int(m.stake) && m.pot === m.stake * 2)) return null;
    if ((t.phase === 'fighting') !== (m !== null)) return null;
    if (!Array.isArray(t.history) || t.history.length > 10_000) return null;
    for (const h of t.history) {
      if (!int(h?.n, 1) || !int(h.lap) || !pair([h.a, h.b]) || ![h.a, h.b].includes(h.winner)) return null;
      if (!int(h.fee) || !int(h.pot) || (h.score !== '2-0' && h.score !== '2-1') || !Array.isArray(h.bonuses)) return null;
      if (!h.bonuses.every((b) => ['clean', 'streak', ...MANUAL_BONUSES].includes(b?.kind) && int(b.points))) return null;
      if (!(h.chars === null || ([h.chars?.a, h.chars?.b].every((c) => c === null || isMain(c))))) return null;
    }
    return structuredClone({
      phase: t.phase, settings: { name: s.name, startPoints: s.startPoints, entryFee: s.entryFee, riseEvery: s.riseEvery, risePercent: s.risePercent, bonuses: { clean: bonuses.clean, streak: bonuses.streak, flawless: bonuses.flawless, fatality: bonuses.fatality, brutality: bonuses.brutality } },
      entrants: t.entrants.map((e) => ({ id: e.id, name: e.name, main: e.main, playerId: null, points: e.points, wins: e.wins, losses: e.losses, streak: e.streak, bestStreak: e.bestStreak, bonusPoints: e.bonusPoints, outOnTurn: e.outOnTurn })),
      turn: t.turn, lap: t.lap, circle: t.circle, queue: t.queue, current: m, history: t.history, winners: t.winners,
    });
  } catch {
    return null;
  }
}
