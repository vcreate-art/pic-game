import {
  CALLER_MAX, CELLS, FREE, GRID, LINES_TO_WIN, TURNS_MAX,
  type BingoMode, type BingoPattern,
} from './types.js';

type Rng = () => number;

/** The twelve lines on a card: five rows, five columns, two diagonals. */
export const BINGO_LINES: readonly (readonly number[])[] = (() => {
  const idx = [...Array(GRID).keys()];
  return [
    ...idx.map((r) => idx.map((c) => r * GRID + c)),
    ...idx.map((c) => idx.map((r) => r * GRID + c)),
    idx.map((i) => i * GRID + i),
    idx.map((i) => i * GRID + (GRID - 1 - i)),
  ];
})();

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** 1 to 25 in a random order, as if written in without thinking. */
export function randomTurnsCard(rng: Rng): number[] {
  return shuffle(range(1, TURNS_MAX), rng);
}

/**
 * A 75-ball card: five from 1-15 down the B column, five from 16-30 under I,
 * and so on, with the free square in the middle.
 */
export function randomCallerCard(rng: Rng): number[] {
  const cols = [...Array(GRID).keys()].map((c) => shuffle(range(c * 15 + 1, c * 15 + 15), rng).slice(0, GRID));
  const card = Array.from({ length: CELLS }, (_, i) => cols[i % GRID]![Math.floor(i / GRID)]!);
  card[FREE] = 0;
  return card;
}

/** A turns card someone filled in: each of 1 to 25 exactly once. */
export function validTurnsCard(card: unknown): card is number[] {
  if (!Array.isArray(card) || card.length !== CELLS) return false;
  const seen = new Set<number>();
  for (const n of card) {
    if (!Number.isInteger(n) || n < 1 || n > TURNS_MAX || seen.has(n)) return false;
    seen.add(n);
  }
  return true;
}

export function completedLines(marked: readonly boolean[]): number {
  return BINGO_LINES.filter((line) => line.every((i) => marked[i])).length;
}

export function hasPattern(marked: readonly boolean[], pattern: BingoPattern): boolean {
  return pattern === 'blackout' ? marked.every(Boolean) : completedLines(marked) > 0;
}

export interface BingoGame {
  mode: BingoMode;
  pattern: BingoPattern;
  /** Who is playing, in turn order. */
  order: string[];
  cards: Record<string, number[]>;
  marked: Record<string, boolean[]>;
  called: number[];
  /** Index into `order` of whose call it is (turns). */
  turn: number;
  winners: string[];
}

export function newGame(
  mode: BingoMode,
  pattern: BingoPattern,
  cards: Record<string, number[]>,
): BingoGame {
  const order = Object.keys(cards);
  const marked: Record<string, boolean[]> = {};
  for (const id of order) marked[id] = cards[id]!.map((n) => n === 0);
  return { mode, pattern, order, cards, marked, called: [], turn: 0, winners: [] };
}

export const maxBall = (g: BingoGame) => (g.mode === 'turns' ? TURNS_MAX : CALLER_MAX);

export function uncalled(g: BingoGame): number[] {
  const done = new Set(g.called);
  return range(1, maxBall(g)).filter((n) => !done.has(n));
}

export function lines(g: BingoGame, id: string): number {
  const m = g.marked[id];
  return m ? completedLines(m) : 0;
}

/**
 * Calls a number. In a turns game everyone crosses it off, and anyone who
 * reaches five lines on it wins; two or more at once share the win. In a
 * caller game it is only drawn, unless the app is daubing for everyone.
 * Returns whoever won on this call.
 */
export function callNumber(g: BingoGame, n: number, autoDaub = false): string[] {
  if (g.winners.length) throw new Error('Game is over');
  if (!Number.isInteger(n) || n < 1 || n > maxBall(g) || g.called.includes(n)) throw new Error('Bad number');
  g.called.push(n);
  if (g.mode === 'turns' || autoDaub) {
    for (const id of g.order) {
      const i = g.cards[id]!.indexOf(n);
      if (i >= 0) g.marked[id]![i] = true;
    }
  }
  if (g.mode === 'turns') {
    const won = g.order.filter((id) => lines(g, id) >= LINES_TO_WIN);
    if (won.length) g.winners = won;
    return won;
  }
  return [];
}

/**
 * Daubs, or un-daubs, a square on your own caller card. Only a number that has
 * been called can be daubed, so a card cannot be filled in ahead of the balls.
 */
export function daub(g: BingoGame, id: string, index: number): boolean {
  const card = g.cards[id];
  const marked = g.marked[id];
  if (!card || !marked || index < 0 || index >= CELLS || (index === FREE && card[FREE] === 0)) return false;
  if (!marked[index] && !g.called.includes(card[index]!)) return false;
  marked[index] = !marked[index];
  return true;
}

/** A shout of BINGO: good if the daubs on that card make the pattern. */
export function claim(g: BingoGame, id: string): boolean {
  const marked = g.marked[id];
  if (!marked || g.winners.length) return false;
  if (!hasPattern(marked, g.pattern)) return false;
  g.winners = [id];
  return true;
}

/**
 * Hands the call to the next player who is still around. `skip` says who
 * cannot take a turn (gone, or disconnected). Returns false if nobody can.
 */
export function advanceTurn(g: BingoGame, skip: (id: string) => boolean = () => false): boolean {
  for (let step = 1; step <= g.order.length; step++) {
    const i = (g.turn + step) % g.order.length;
    if (!skip(g.order[i]!)) {
      g.turn = i;
      return true;
    }
  }
  return false;
}

export const turnOf = (g: BingoGame): string | null => g.order[g.turn] ?? null;
