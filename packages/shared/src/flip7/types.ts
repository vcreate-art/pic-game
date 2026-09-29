/**
 * Flip 7: push your luck.
 *
 * Each round everyone is dealt a card, then takes turns to hit (flip another)
 * or stay (bank what they have). Draw a number you already hold and you bust,
 * scoring nothing for the round. Collect seven different numbers and it is a
 * Flip 7: the round ends on the spot and you score 15 extra. First to the
 * target score at the end of a round wins.
 *
 * Every card is played face up, so nothing about the game is private except
 * the order of the deck, which never leaves the server.
 */

export type Flip7Face =
  /** 0 to 12. There are as many of each number as it says, and one 0. */
  | { kind: 'number'; value: number }
  /** Added to your round score, after any ×2. Never busts you. */
  | { kind: 'plus'; value: number }
  /** Doubles the numbers in your round score, not the + cards. */
  | { kind: 'times2' }
  /** Played on any player still in: they bank what they have and stop. */
  | { kind: 'freeze' }
  /** Played on any player still in: they must take three cards. */
  | { kind: 'flip3' }
  /** Kept: the next duplicate you draw is discarded with it, not a bust. */
  | { kind: 'second' };

export interface Flip7Card {
  /** Unique within a deck, so a card can be followed as it moves. */
  id: number;
  face: Flip7Face;
}

export type Flip7Status = 'active' | 'stayed' | 'frozen' | 'bust' | 'flip7';

export interface Flip7Hand {
  numbers: Flip7Card[];
  /** +2 … +10 and ×2. */
  modifiers: Flip7Card[];
  second: Flip7Card | null;
  status: Flip7Status;
}

export interface Flip7Settings {
  /** Points that end the game, checked at the end of a round. */
  target: number;
}

export const FLIP7_DEFAULTS: Flip7Settings = { target: 200 };
export const FLIP7_TARGETS = [100, 150, 200, 300] as const;
export const FLIP7_MIN_PLAYERS = 2;
export const FLIP7_MAX_PLAYERS = 10;
/** Different numbers that make a Flip 7. */
export const FLIP7_SET = 7;
export const FLIP7_BONUS = 15;

/**
 * - turn: the player to move hits or stays
 * - target: someone drew an action card and must pick who it hits (this can
 *   happen in the opening deal too, which otherwise plays out at once)
 * - roundEnd: scores are in; the host deals the next round
 * - ended: someone reached the target
 */
export type Flip7Phase = 'lobby' | 'turn' | 'target' | 'roundEnd' | 'ended';

/** An action card waiting for its holder to say who it is for. */
export interface Flip7Pending {
  card: Flip7Card;
  /** Who drew it, and so who chooses. */
  by: string;
  /** Who it may go to. */
  options: string[];
}

export type Flip7Event =
  | { kind: 'draw'; to: string; card: Flip7Card; bust?: boolean; saved?: boolean; flip7?: boolean }
  | { kind: 'stay'; by: string }
  | { kind: 'action'; by: string; card: Flip7Card; on: string }
  | { kind: 'discard'; by: string; card: Flip7Card }
  | { kind: 'round'; round: number; scores: Record<string, number> };

export interface Flip7Public {
  phase: Flip7Phase;
  settings: Flip7Settings;
  /** Everyone in this game, in seat order. Late arrivals watch. */
  players: string[];
  round: number;
  dealer: string | null;
  turn: string | null;
  hands: Record<string, Flip7Hand>;
  /** Banked points, not counting the round being played. */
  totals: Record<string, number>;
  /** What each player scored in the round just finished. */
  lastRound: Record<string, number> | null;
  pending: Flip7Pending | null;
  /** Someone taking a Flip Three, and how many cards they still have to take. */
  flipping: { target: string; left: number } | null;
  deckCount: number;
  discardCount: number;
  /** What is still in the deck, by face, not in order. Anyone who has been
   *  watching the table could count this up; it is here to save them doing so. */
  remaining: Record<string, number>;
  /** The last move's cards, in the order they came, for the table to animate. */
  events: Flip7Event[];
  winners: string[];
}

/** A face as a short key, for counting: n7, p4, x2, freeze, flip3, second. */
export function faceKey(f: Flip7Face): string {
  switch (f.kind) {
    case 'number': return `n${f.value}`;
    case 'plus': return `p${f.value}`;
    case 'times2': return 'x2';
    default: return f.kind;
  }
}
