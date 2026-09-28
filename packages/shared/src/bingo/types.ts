/**
 * Two games under one name.
 *
 * Turns: the one played on paper. Everyone writes 1 to 25 on their own 5×5
 * grid in whatever order they like, then players take turns calling a number
 * and everybody crosses it off. Each full row, column or diagonal crosses out
 * a letter of B-I-N-G-O; five lines wins.
 *
 * Caller: the hall game. Everyone gets a random 75-ball card, balls are drawn
 * on a clock, players daub their own cards and shout BINGO on a line.
 */
export type BingoMode = 'turns' | 'caller';
export const BINGO_MODES: readonly BingoMode[] = ['turns', 'caller'];

/** What wins a caller game: any one line, or every square on the card. */
export type BingoPattern = 'line' | 'blackout';

export interface BingoSettings {
  mode: BingoMode;
  /** Turns: seconds to call a number before one is picked for you; 0 is no limit. */
  turnSeconds: number;
  /** Caller: seconds between balls; 0 means the host calls each one. */
  callSeconds: number;
  pattern: BingoPattern;
  /** Caller: the app daubs every card as balls are drawn. BINGO still has to be called. */
  autoDaub: boolean;
}

export const BINGO_DEFAULTS: BingoSettings = {
  mode: 'turns',
  turnSeconds: 0,
  callSeconds: 5,
  pattern: 'line',
  autoDaub: false,
};

export const BINGO_BOUNDS = {
  turnSeconds: { min: 0, max: 120 },
  callSeconds: { min: 0, max: 30 },
} as const;

export const GRID = 5;
export const CELLS = GRID * GRID;
/** The centre square of a caller card, free and daubed from the start. */
export const FREE = 12;
/** Turns games use the numbers 1 to 25; caller games 75 balls. */
export const TURNS_MAX = 25;
export const CALLER_MAX = 75;
/** Lines that win a turns game: one per letter of BINGO. */
export const LINES_TO_WIN = 5;

export type BingoPhase = 'lobby' | 'arrange' | 'play' | 'ended';

export interface BingoPublic {
  phase: BingoPhase;
  settings: BingoSettings;
  /** Everyone playing this game, in turn order. Late arrivals watch. */
  players: string[];
  /** Arrange phase: who has filled in their grid. */
  ready: string[];
  /** Every number called so far, oldest first. */
  called: number[];
  /** Turns: whose call it is. */
  turn: string | null;
  /** Lines each player has completed. Public, as it is at the table, where
   *  people cross out their letters where everyone can see. */
  lines: Record<string, number>;
  /** Caller: the draw is on hold. */
  paused: boolean;
  /** When the current turn or the next ball is due; 0 when untimed. */
  endsAt: number;
  winners: string[];
  /** Every card, but only once the game is over. */
  cards: Record<string, number[]> | null;
}

/** A player's own card and daubs. Sent to their socket alone. */
export interface BingoCard {
  /** Row-major, 25 numbers. 0 is the free centre of a caller card. */
  numbers: number[];
  marked: boolean[];
}

export const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;

/** The column letter a 75-ball number is called with: B 1-15 … O 61-75. */
export const ballLetter = (n: number): string => BINGO_LETTERS[Math.min(4, Math.floor((n - 1) / 15))]!;
