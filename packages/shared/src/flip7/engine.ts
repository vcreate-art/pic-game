import {
  FLIP7_BONUS, FLIP7_SET,
  type Flip7Card, type Flip7Event, type Flip7Face, type Flip7Hand, type Flip7Pending,
} from './types.js';

type Rng = () => number;

// ---------------------------------------------------------------------- deck

/**
 * The 94-card deck: twelve 12s down to one 1, and one 0; +2, +4, +6, +8,
 * +10 and ×2 once each; three each of Freeze, Flip Three and Second Chance.
 */
export function buildDeck(): Flip7Card[] {
  const faces: Flip7Face[] = [{ kind: 'number', value: 0 }];
  for (let v = 1; v <= 12; v++) for (let i = 0; i < v; i++) faces.push({ kind: 'number', value: v });
  for (const v of [2, 4, 6, 8, 10]) faces.push({ kind: 'plus', value: v });
  faces.push({ kind: 'times2' });
  for (const kind of ['freeze', 'flip3', 'second'] as const) for (let i = 0; i < 3; i++) faces.push({ kind });
  return faces.map((face, id) => ({ id, face }));
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

// ------------------------------------------------------------------ scoring

/**
 * A hand's score for the round: the numbers, doubled by ×2, then the + cards,
 * then 15 for a Flip 7. A bust scores nothing, whatever it holds.
 */
export function roundScore(h: Flip7Hand): number {
  if (h.status === 'bust') return 0;
  let n = h.numbers.reduce((sum, c) => sum + (c.face.kind === 'number' ? c.face.value : 0), 0);
  if (h.modifiers.some((c) => c.face.kind === 'times2')) n *= 2;
  for (const c of h.modifiers) if (c.face.kind === 'plus') n += c.face.value;
  if (h.status === 'flip7') n += FLIP7_BONUS;
  return n;
}

// --------------------------------------------------------------------- game

export type Flip7Stage = 'turn' | 'target' | 'roundEnd' | 'ended';

export interface Flip7Game {
  order: string[];
  target: number;
  rng: Rng;
  /** Top of the deck is the end of the array. */
  deck: Flip7Card[];
  discard: Flip7Card[];
  totals: Record<string, number>;
  round: number;
  /** Index into `order` of this round's dealer. */
  dealer: number;
  hands: Record<string, Flip7Hand>;
  stage: Flip7Stage;
  /** The opening deal is still going round. It only ever pauses for an
   *  action card's target, so no one sees it outside `target`. */
  dealing: boolean;
  /** How many seats have had their opening card. */
  dealt: number;
  /** Turn: index into `order` of whose go it is. */
  turn: number;
  /** Set when the player to move has done so, so play goes on to the next. */
  passTurn: boolean;
  /** Action cards waiting for a target; the first is the one being decided. */
  pending: { card: Flip7Card; by: string }[];
  /** A Flip Three being taken. Action cards it turns up wait in `aside`. */
  flipping: { target: string; left: number; aside: Flip7Card[] } | null;
  /** Set by a Flip 7: the round is over the moment everything settles. */
  roundOver: boolean;
  lastRound: Record<string, number> | null;
  /** What the last input did, card by card. */
  events: Flip7Event[];
  winners: string[];
  /** Players who have left. They take no turns and cannot win. */
  gone: string[];
}

const emptyHand = (): Flip7Hand => ({ numbers: [], modifiers: [], second: null, status: 'active' });

/**
 * A new game, and its first round dealt. `order[0]` deals first. `deck` is for
 * tests: cards in the order they will be drawn, instead of a shuffled deck.
 */
export function newFlip7(order: string[], target: number, rng: Rng, deck?: Flip7Card[]): Flip7Game {
  const g: Flip7Game = {
    order: [...order],
    target,
    rng,
    deck: deck ? [...deck].reverse() : shuffle(buildDeck(), rng),
    discard: [],
    totals: Object.fromEntries(order.map((id) => [id, 0])),
    round: 0,
    dealer: order.length - 1,
    hands: {},
    stage: 'turn',
    dealing: true,
    dealt: 0,
    turn: 0,
    passTurn: false,
    pending: [],
    flipping: null,
    roundOver: false,
    lastRound: null,
    events: [],
    winners: [],
    gone: [],
  };
  startRound(g);
  return g;
}

export class Flip7Error extends Error {}

export const flip7Turn = (g: Flip7Game): string | null =>
  g.stage === 'turn' ? g.order[g.turn] ?? null : null;

export const isActive = (g: Flip7Game, id: string): boolean =>
  g.hands[id]?.status === 'active' && !g.gone.includes(id);

/** The action card being decided, with who it may go to. */
export function pendingChoice(g: Flip7Game): Flip7Pending | null {
  if (g.stage !== 'target' || !g.pending.length) return null;
  const p = g.pending[0]!;
  return { card: p.card, by: p.by, options: targetsFor(g, p.card, p.by) };
}

/**
 * Who an action card may go to. Freeze and Flip Three go to anyone still in
 * the round, the holder included. A spare Second Chance goes to someone else
 * still in who has none.
 */
export function targetsFor(g: Flip7Game, card: Flip7Card, by: string): string[] {
  const live = g.order.filter((id) => isActive(g, id));
  if (card.face.kind === 'second') return live.filter((id) => id !== by && !g.hands[id]!.second);
  return live;
}

function startRound(g: Flip7Game): void {
  for (const h of Object.values(g.hands)) {
    g.discard.push(...h.numbers, ...h.modifiers);
    if (h.second) g.discard.push(h.second);
  }
  g.round++;
  g.dealer = nextSeat(g, g.dealer);
  g.hands = Object.fromEntries(g.order.map((id) => [id, emptyHand()]));
  for (const id of g.gone) g.hands[id]!.status = 'stayed';
  g.stage = 'turn';
  g.dealing = true;
  g.dealt = 0;
  g.pending = [];
  g.flipping = null;
  g.roundOver = false;
  g.passTurn = false;
  run(g);
}

/** The next seat after `from` that belongs to someone still in the game. */
function nextSeat(g: Flip7Game, from: number): number {
  for (let step = 1; step <= g.order.length; step++) {
    const i = (from + step) % g.order.length;
    if (!g.gone.includes(g.order[i]!)) return i;
  }
  return from;
}

/** The top card, reshuffling the discards into a new deck when it runs out. */
function draw(g: Flip7Game): Flip7Card | null {
  if (!g.deck.length && g.discard.length) {
    g.deck = shuffle(g.discard, g.rng);
    g.discard = [];
  }
  return g.deck.pop() ?? null;
}

/** A card arrives in front of a player, and does what it does. */
function give(g: Flip7Game, to: string, card: Flip7Card): void {
  const h = g.hands[to]!;
  const f = card.face;
  if (f.kind === 'number') {
    if (h.numbers.some((c) => c.face.kind === 'number' && c.face.value === f.value)) {
      if (h.second) {
        g.discard.push(card, h.second);
        h.second = null;
        g.events.push({ kind: 'draw', to, card, saved: true });
        return;
      }
      h.numbers.push(card);
      h.status = 'bust';
      g.events.push({ kind: 'draw', to, card, bust: true });
      return;
    }
    h.numbers.push(card);
    if (h.numbers.length >= FLIP7_SET) {
      h.status = 'flip7';
      g.roundOver = true;
      g.events.push({ kind: 'draw', to, card, flip7: true });
      return;
    }
    g.events.push({ kind: 'draw', to, card });
    return;
  }
  g.events.push({ kind: 'draw', to, card });
  if (f.kind === 'plus' || f.kind === 'times2') {
    h.modifiers.push(card);
  } else if (f.kind === 'second' && !h.second) {
    h.second = card;
  } else if (g.flipping?.target === to && f.kind !== 'second') {
    // Freeze and Flip Three turned up by a Flip Three wait until it is done.
    g.flipping.aside.push(card);
  } else {
    g.pending.push({ card, by: to });
  }
}

function apply(g: Flip7Game, card: Flip7Card, by: string, on: string): void {
  g.events.push({ kind: 'action', by, card, on });
  if (card.face.kind === 'second') {
    g.hands[on]!.second = card;
    return;
  }
  g.discard.push(card);
  if (card.face.kind === 'freeze') g.hands[on]!.status = 'frozen';
  else g.flipping = { target: on, left: 3, aside: [] };
}

/**
 * Plays everything out that needs no decision: a Flip Three in progress, then
 * action cards (going to their only possible target, or nowhere), then the
 * opening deal, until a player has to choose something or the round is over.
 */
function run(g: Flip7Game): void {
  for (;;) {
    if (g.roundOver) return endRound(g);

    const fl = g.flipping;
    if (fl) {
      if (fl.left > 0 && isActive(g, fl.target)) {
        const card = draw(g);
        fl.left = card ? fl.left - 1 : 0;
        if (card) give(g, fl.target, card);
        continue;
      }
      g.flipping = null;
      // A player who went bust on it never gets to play what it turned up.
      if (isActive(g, fl.target)) g.pending.unshift(...fl.aside.map((card) => ({ card, by: fl.target })));
      else g.discard.push(...fl.aside);
      continue;
    }

    if (g.pending.length) {
      const p = g.pending[0]!;
      const options = targetsFor(g, p.card, p.by);
      if (options.length > 1 && !g.gone.includes(p.by)) {
        g.stage = 'target';
        return;
      }
      g.pending.shift();
      // One place it can go, or its holder has left and cannot pick.
      if (options.length) apply(g, p.card, p.by, options[Math.floor(g.rng() * options.length)]!);
      else {
        g.discard.push(p.card);
        g.events.push({ kind: 'discard', by: p.by, card: p.card });
      }
      continue;
    }

    if (g.dealing) {
      if (g.dealt < g.order.length) {
        const id = g.order[(g.dealer + 1 + g.dealt) % g.order.length]!;
        g.dealt++;
        if (isActive(g, id)) {
          const card = draw(g);
          if (card) give(g, id, card);
        }
        continue;
      }
      // Dealt: the first turn is the player after the dealer.
      g.dealing = false;
      g.turn = g.dealer;
      g.passTurn = true;
    }

    if (!g.order.some((id) => isActive(g, id))) return endRound(g);

    g.stage = 'turn';
    if (g.passTurn || !isActive(g, g.order[g.turn]!)) {
      g.passTurn = false;
      for (let step = 1; step <= g.order.length; step++) {
        const i = (g.turn + step) % g.order.length;
        if (isActive(g, g.order[i]!)) {
          g.turn = i;
          break;
        }
      }
    }
    return;
  }
}

function endRound(g: Flip7Game): void {
  // A Flip 7 can land partway through a Flip Three; what it had set aside goes.
  if (g.flipping) g.discard.push(...g.flipping.aside);
  g.flipping = null;
  for (const p of g.pending) g.discard.push(p.card);
  g.pending = [];
  const scores: Record<string, number> = {};
  for (const id of g.order) {
    scores[id] = g.gone.includes(id) ? 0 : roundScore(g.hands[id]!);
    g.totals[id] = (g.totals[id] ?? 0) + scores[id]!;
  }
  g.lastRound = scores;
  g.events.push({ kind: 'round', round: g.round, scores });
  const here = g.order.filter((id) => !g.gone.includes(id));
  const best = Math.max(...here.map((id) => g.totals[id]!));
  const leaders = here.filter((id) => g.totals[id] === best);
  // A tie at the top plays on until someone is clear.
  if (best >= g.target && leaders.length === 1) {
    g.winners = leaders;
    g.stage = 'ended';
  } else {
    g.stage = 'roundEnd';
  }
}

// ---------------------------------------------------------------- moves

function mustMove(g: Flip7Game, id: string): void {
  if (flip7Turn(g) !== id) throw new Flip7Error('It is not your turn.');
}

export function hit(g: Flip7Game, id: string): void {
  mustMove(g, id);
  g.events = [];
  const card = draw(g);
  if (!card) throw new Flip7Error('The deck is empty. You will have to stay.');
  give(g, id, card);
  g.passTurn = true;
  run(g);
}

export function stay(g: Flip7Game, id: string): void {
  mustMove(g, id);
  g.events = [];
  g.hands[id]!.status = 'stayed';
  g.events.push({ kind: 'stay', by: id });
  g.passTurn = true;
  run(g);
}

/** The holder of an action card says who it goes to. */
export function choose(g: Flip7Game, id: string, on: string): void {
  const p = pendingChoice(g);
  if (!p || p.by !== id) throw new Flip7Error('Nothing for you to choose.');
  if (!p.options.includes(on)) throw new Flip7Error('That player cannot take it.');
  g.events = [];
  g.pending.shift();
  apply(g, p.card, id, on);
  g.stage = 'turn';
  run(g);
}

export function nextRound(g: Flip7Game): void {
  if (g.stage !== 'roundEnd') throw new Flip7Error('The round is not over.');
  g.events = [];
  startRound(g);
}

/**
 * Moves play past someone who is not there: an action card goes to a random
 * player it may, and a turn is a stay.
 */
export function flip7AutoMove(g: Flip7Game): void {
  const p = pendingChoice(g);
  if (p) return choose(g, p.by, p.options[Math.floor(g.rng() * p.options.length)]!);
  const id = flip7Turn(g);
  if (id) stay(g, id);
}

/** A player leaves for good: their hand stops where it is and play goes on. */
export function flip7Depart(g: Flip7Game, id: string): void {
  if (!g.order.includes(id) || g.gone.includes(id)) return;
  g.gone.push(id);
  if (g.stage === 'roundEnd' || g.stage === 'ended') return;
  g.events = [];
  if (g.hands[id]!.status === 'active') g.hands[id]!.status = 'stayed';
  if (g.flipping?.target === id) g.flipping.left = 0;
  const wasTurn = g.order[g.turn] === id && g.stage === 'turn';
  if (wasTurn) g.passTurn = true;
  run(g);
}
