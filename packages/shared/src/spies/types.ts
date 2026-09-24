export type SpyTeam = 'red' | 'blue';
export const SPY_TEAMS: readonly SpyTeam[] = ['red', 'blue'];
export type SpyRole = 'spymaster' | 'operative';

/** What a card really is. Only spymasters know, until it is revealed. */
export type CardColor = 'red' | 'blue' | 'neutral' | 'assassin';

export const BOARD_SIZE = 25;
/** The starting team has one more agent to find, to make up for going first. */
export const FIRST_AGENTS = 9;
export const SECOND_AGENTS = 8;

export type ClueMode = 'typed' | 'spoken';
export type WordSource = 'builtin' | 'mixed' | 'custom';

export interface SpiesSettings {
  /** Typed: the spymaster types the clue into the app. Spoken: they say it
   *  out loud in the room, and only enter the number. */
  clueMode: ClueMode;
  wordSource: WordSource;
  customWords: string[];
  /** Seconds for giving a clue, and for guessing; 0 is no limit. */
  clueSeconds: number;
  guessSeconds: number;
}

export const SPIES_DEFAULTS: SpiesSettings = {
  clueMode: 'typed',
  wordSource: 'builtin',
  customWords: [],
  clueSeconds: 0,
  guessSeconds: 0,
};

export const SPIES_BOUNDS = {
  seconds: { min: 0, max: 300 },
  customWords: { max: 400, minForGame: BOARD_SIZE },
  word: { max: 20 },
} as const;

/** The number that goes with a clue. UNLIMITED is the "infinity" clue. */
export const UNLIMITED = -1;
export const MAX_CLUE_COUNT = 9;

export interface Clue {
  team: SpyTeam;
  /** Null for a clue that was spoken aloud. */
  word: string | null;
  count: number;
  /** Words revealed on this clue, in order, with what they turned out to be. */
  guesses: { word: string; color: CardColor }[];
}

export type SpiesPhase = 'lobby' | 'clue' | 'guess' | 'ended';

export interface SpiesCard {
  word: string;
  /** Null until revealed; then everyone may know. */
  revealed: CardColor | null;
}

export interface SpiesTeamSeats {
  spymaster: string | null;
  operatives: string[];
}

export interface SpiesPublic {
  phase: SpiesPhase;
  settings: SpiesSettings;
  teams: Record<SpyTeam, SpiesTeamSeats>;
  board: SpiesCard[];
  turn: SpyTeam;
  starting: SpyTeam;
  /** The clue being played, while guessing. */
  clue: Clue | null;
  /** Guesses left on this clue; UNLIMITED for no cap. */
  guessesLeft: number;
  /** Agents still hidden, per team. */
  remaining: Record<SpyTeam, number>;
  /** Every clue so far, oldest first. */
  log: Clue[];
  /** Who has pointed at which card this turn, by card index. */
  marks: Record<number, string[]>;
  /** When the current clue or guess phase runs out; 0 when untimed. */
  endsAt: number;
  winner: SpyTeam | null;
  reason: 'agents' | 'assassin' | null;
  /** The full key, but only once the game is over. */
  key: CardColor[] | null;
}

export const otherTeam = (t: SpyTeam): SpyTeam => (t === 'red' ? 'blue' : 'red');
