import { EXPLORER, EXPLORER_SUPPLY, STARTING_DECK, TRADE_DECK_DEFS, TRADE_ROW_SIZE, cardDef } from './cards.js';
import {
  REALMS_SIDES, type CardInstance, type Effect, type PlayerPublic,
  type RealmsPublic, type RealmsSettings, type RealmsSide,
} from './types.js';

export interface BaseInPlay extends CardInstance {
  /** Its ability is once a turn; this says whether it has been used. */
  used: boolean;
}

export interface PlayerZones {
  authority: number;
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  /** Ships played this turn. */
  inPlay: CardInstance[];
  bases: BaseInPlay[];
  /** Instance ids whose ally ability has already fired this turn. */
  allied: string[];
  /** Forced discards owed at the start of this player's turn. */
  owedDiscards: number;
}

export interface RealmsState {
  settings: RealmsSettings;
  phase: 'playing' | 'ended';
  turn: RealmsSide;
  trade: number;
  combat: number;
  players: Record<RealmsSide, PlayerZones>;
  tradeDeck: CardInstance[];
  tradeRow: CardInstance[];
  explorersLeft: number;
  scrapHeap: CardInstance[];
  winner: RealmsSide | null;
}

export type Rng = () => number;
export type MakeId = () => string;

export const other = (side: RealmsSide): RealmsSide => (side === 'a' ? 'b' : 'a');

/** Fisher-Yates, taking its randomness so games can be replayed in a test. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function zones(deck: CardInstance[], authority: number): PlayerZones {
  return {
    authority, deck, hand: [], discard: [], inPlay: [], bases: [],
    allied: [], owedDiscards: 0,
  };
}

export function createGame(settings: RealmsSettings, rng: Rng, makeId: MakeId): RealmsState {
  const deckFor = () =>
    shuffle(STARTING_DECK.map((key) => ({ id: makeId(), key })), rng);

  const tradeDeck = shuffle(
    TRADE_DECK_DEFS.flatMap((d) =>
      Array.from({ length: d.copies ?? 1 }, () => ({ id: makeId(), key: d.key })),
    ),
    rng,
  );

  const state: RealmsState = {
    settings,
    phase: 'playing',
    turn: 'a',
    trade: 0,
    combat: 0,
    players: {
      a: zones(deckFor(), settings.startingAuthority),
      b: zones(deckFor(), settings.startingAuthority),
    },
    tradeDeck,
    tradeRow: [],
    explorersLeft: EXPLORER_SUPPLY,
    scrapHeap: [],
    winner: null,
  };

  refillTradeRow(state);
  // The player going first draws three, not five. Going first with a full hand
  // is a real advantage in a game this fast.
  drawCards(state.players.a, 3, rng);
  drawCards(state.players.b, 5, rng);
  return state;
}

export function refillTradeRow(state: RealmsState): void {
  while (state.tradeRow.length < TRADE_ROW_SIZE && state.tradeDeck.length > 0) {
    state.tradeRow.push(state.tradeDeck.pop()!);
  }
}

/** Draws n, reshuffling the discard pile in when the deck runs dry. */
export function drawCards(p: PlayerZones, n: number, rng: Rng): CardInstance[] {
  const drawn: CardInstance[] = [];
  for (let i = 0; i < n; i++) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) break; // nothing left anywhere
      p.deck = shuffle(p.discard, rng);
      p.discard = [];
    }
    const card = p.deck.pop();
    if (!card) break;
    p.hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

function applyEffect(state: RealmsState, side: RealmsSide, e: Effect, rng: Rng): void {
  const me = state.players[side];
  if (e.trade) state.trade += e.trade;
  if (e.combat) state.combat += e.combat;
  if (e.authority) me.authority += e.authority;
  if (e.draw) drawCards(me, e.draw, rng);
  if (e.opponentDiscards) state.players[other(side)].owedDiscards += e.opponentDiscards;
}

/** Every card of this player's that is face up right now. */
function cardsInPlay(p: PlayerZones): CardInstance[] {
  return [...p.inPlay, ...p.bases];
}

/**
 * Fires ally abilities for any card that now has a faction-mate on the table.
 *
 * Run after anything enters play, and run over every card rather than just the
 * new one: playing a second Blob card triggers the ally on the first one too,
 * which is easy to miss if you only look at what was just played.
 */
export function resolveAllies(state: RealmsState, side: RealmsSide, rng: Rng): void {
  const me = state.players[side];
  const present = cardsInPlay(me);
  const counts = new Map<string, number>();
  for (const c of present) {
    const f = cardDef(c.key).faction;
    if (f === 'neutral') continue;
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  for (const c of present) {
    const d = cardDef(c.key);
    if (!d.ally || d.faction === 'neutral') continue;
    if ((counts.get(d.faction) ?? 0) < 2) continue;
    if (me.allied.includes(c.id)) continue;
    me.allied.push(c.id);
    applyEffect(state, side, d.ally, rng);
  }
}

export type Fail = { ok: false; reason: string };
export type Ok = { ok: true };
export type Result = Ok | Fail;
const no = (reason: string): Fail => ({ ok: false, reason });
const yes: Ok = { ok: true };

/** Forced discards are settled before anything else can happen. */
function blockedByDiscards(state: RealmsState, side: RealmsSide): Fail | null {
  const owed = state.players[side].owedDiscards;
  return owed > 0 ? no(`Discard ${owed} card${owed > 1 ? 's' : ''} first.`) : null;
}

export function discardForced(state: RealmsState, side: RealmsSide, cardId: string): Result {
  const me = state.players[side];
  if (state.turn !== side) return no('Not your turn.');
  if (me.owedDiscards <= 0) return no('Nothing to discard.');
  const i = me.hand.findIndex((c) => c.id === cardId);
  if (i < 0) return no('That card is not in your hand.');
  me.discard.push(...me.hand.splice(i, 1));
  me.owedDiscards -= 1;
  return yes;
}

export function playCard(state: RealmsState, side: RealmsSide, cardId: string, rng: Rng): Result {
  if (state.phase !== 'playing') return no('The game is over.');
  if (state.turn !== side) return no('Not your turn.');
  const blocked = blockedByDiscards(state, side);
  if (blocked) return blocked;

  const me = state.players[side];
  const i = me.hand.findIndex((c) => c.id === cardId);
  if (i < 0) return no('That card is not in your hand.');

  const card = me.hand.splice(i, 1)[0]!;
  const d = cardDef(card.key);

  if (d.type === 'ship') {
    me.inPlay.push(card);
    // A ship with options has none applied now; its owner picks, as with a base.
    if (d.primary) applyEffect(state, side, d.primary, rng);
    if (d.options) me.bases.push({ ...card, used: false });
  } else {
    me.bases.push({ ...card, used: false });
  }
  resolveAllies(state, side, rng);
  return yes;
}

/**
 * Uses a base's ability, or picks between a card's options. Kept as an action
 * the owner takes rather than something that fires automatically, because
 * several cards offer a choice and a choice is a decision, not an event.
 */
export function useCard(
  state: RealmsState,
  side: RealmsSide,
  cardId: string,
  optionIndex: number,
  rng: Rng,
): Result {
  if (state.phase !== 'playing') return no('The game is over.');
  if (state.turn !== side) return no('Not your turn.');
  const blocked = blockedByDiscards(state, side);
  if (blocked) return blocked;

  const me = state.players[side];
  const entry = me.bases.find((b) => b.id === cardId);
  if (!entry) return no('That card is not in play.');
  if (entry.used) return no('Already used this turn.');

  const d = cardDef(entry.key);
  const effect = d.options ? d.options[optionIndex] : d.primary;
  if (!effect) return no('Nothing to use on that card.');

  entry.used = true;
  applyEffect(state, side, effect, rng);
  return yes;
}

/** Scrapping is permanent: the card leaves the game rather than the deck. */
export function scrapCard(state: RealmsState, side: RealmsSide, cardId: string, rng: Rng): Result {
  if (state.phase !== 'playing') return no('The game is over.');
  if (state.turn !== side) return no('Not your turn.');
  const me = state.players[side];

  const inPlayIdx = me.inPlay.findIndex((c) => c.id === cardId);
  const baseIdx = me.bases.findIndex((b) => b.id === cardId);
  if (inPlayIdx < 0 && baseIdx < 0) return no('That card is not in play.');

  const card = inPlayIdx >= 0 ? me.inPlay[inPlayIdx]! : me.bases[baseIdx]!;
  const d = cardDef(card.key);
  if (!d.scrap) return no('That card has nothing to scrap for.');

  if (inPlayIdx >= 0) me.inPlay.splice(inPlayIdx, 1);
  else me.bases.splice(baseIdx, 1);
  me.allied = me.allied.filter((id) => id !== card.id);
  state.scrapHeap.push({ id: card.id, key: card.key });
  applyEffect(state, side, d.scrap, rng);
  return yes;
}

export function buyCard(state: RealmsState, side: RealmsSide, cardId: string): Result {
  if (state.phase !== 'playing') return no('The game is over.');
  if (state.turn !== side) return no('Not your turn.');
  const blocked = blockedByDiscards(state, side);
  if (blocked) return blocked;

  const me = state.players[side];

  if (cardId === 'explorer') {
    if (state.explorersLeft <= 0) return no('No Explorers left.');
    if (state.trade < EXPLORER.cost) return no('Not enough trade.');
    state.trade -= EXPLORER.cost;
    state.explorersLeft -= 1;
    me.discard.push({ id: `${cardId}-${state.explorersLeft}-${side}`, key: EXPLORER.key });
    return yes;
  }

  const i = state.tradeRow.findIndex((c) => c.id === cardId);
  if (i < 0) return no('That card is not for sale.');
  const card = state.tradeRow[i]!;
  const cost = cardDef(card.key).cost;
  if (state.trade < cost) return no('Not enough trade.');

  state.trade -= cost;
  state.tradeRow.splice(i, 1);
  me.discard.push(card);
  refillTradeRow(state);
  return yes;
}

export type AttackTarget = { kind: 'player' } | { kind: 'base'; cardId: string };

export function attack(state: RealmsState, side: RealmsSide, target: AttackTarget): Result {
  if (state.phase !== 'playing') return no('The game is over.');
  if (state.turn !== side) return no('Not your turn.');
  const blocked = blockedByDiscards(state, side);
  if (blocked) return blocked;

  const foe = state.players[other(side)];
  const outposts = foe.bases.filter((b) => cardDef(b.key).type === 'outpost');

  if (target.kind === 'player') {
    // Outposts shield everything behind them; that is the whole point of one.
    if (outposts.length > 0) return no('Destroy their outposts first.');
    if (state.combat <= 0) return no('No combat to spend.');
    foe.authority -= state.combat;
    state.combat = 0;
    if (foe.authority <= 0) {
      foe.authority = 0;
      state.phase = 'ended';
      state.winner = side;
    }
    return yes;
  }

  const idx = foe.bases.findIndex((b) => b.id === target.cardId);
  if (idx < 0) return no('That base is not in play.');
  const base = foe.bases[idx]!;
  const d = cardDef(base.key);
  if (outposts.length > 0 && d.type !== 'outpost') return no('Destroy their outposts first.');

  const defense = d.defense ?? 0;
  if (state.combat < defense) return no(`Needs ${defense} combat.`);
  state.combat -= defense;
  foe.bases.splice(idx, 1);
  foe.discard.push({ id: base.id, key: base.key });
  return yes;
}

export function endTurn(state: RealmsState, rng: Rng): Result {
  if (state.phase !== 'playing') return no('The game is over.');
  const side = state.turn;
  const me = state.players[side];
  const blocked = blockedByDiscards(state, side);
  if (blocked) return blocked;

  // Everything played and everything still held goes to the discard pile;
  // bases stay, which is what makes them worth their cost.
  me.discard.push(...me.inPlay, ...me.hand);
  me.inPlay = [];
  me.hand = [];
  me.allied = [];
  for (const b of me.bases) b.used = false;

  // You draw your OWN next hand as you finish, rather than the incoming player
  // drawing at the start of theirs — they already hold one, and drawing for
  // them again hands them ten cards.
  drawCards(me, 5, rng);

  state.trade = 0;
  state.combat = 0;
  state.turn = other(side);
  return yes;
}

/**
 * Everything everyone is allowed to see.
 *
 * Hands and deck order are absent by construction rather than by being
 * stripped out: PlayerPublic has no field capable of carrying them, so a
 * future change cannot leak one by accident. A player's own hand travels
 * separately, addressed to their socket alone.
 */
export function publicView(
  state: RealmsState,
  seats: Partial<Record<RealmsSide, string | null>>,
  phase: 'lobby' | 'playing' | 'ended',
): RealmsPublic {
  const project = (p: PlayerZones): PlayerPublic => ({
    authority: p.authority,
    deckCount: p.deck.length,
    handCount: p.hand.length,
    // The discard pile is face up in this game, so its top card is no secret.
    discardCount: p.discard.length,
    discardTop: p.discard.length > 0 ? { ...p.discard[p.discard.length - 1]! } : null,
    inPlay: p.inPlay.map((c) => ({ ...c })),
    bases: p.bases.map((b) => ({ id: b.id, key: b.key, used: b.used })),
  });

  return {
    phase,
    settings: state.settings,
    seats: { ...seats },
    turn: state.turn,
    trade: state.trade,
    combat: state.combat,
    players: { a: project(state.players.a), b: project(state.players.b) },
    tradeRow: state.tradeRow.map((c) => ({ ...c })),
    tradeDeckCount: state.tradeDeck.length,
    explorersLeft: state.explorersLeft,
    scrapHeapCount: state.scrapHeap.length,
    winner: state.winner,
  };
}

/** How many discards a side still owes, which the client needs to prompt. */
export function owedDiscards(state: RealmsState, side: RealmsSide): number {
  return state.players[side].owedDiscards;
}

export { REALMS_SIDES };
