/**
 * A points tournament for real Mortal Kombat 11. The app plays no fights: it
 * keeps the stacks, the running order and the results, and the host reports
 * each match as it is played on the console.
 *
 * Everyone starts with the same stack. Players sit in a random circle and each
 * fights both neighbours, so everyone plays twice a lap even with an odd count.
 * Both fighters pay an entry fee that rises like poker blinds; the winner of the
 * best-of-3 takes the pot and any bonuses. Last one with points wins, or the
 * host calls it and the leader does.
 */

export interface TourneyBonuses {
  /** Won 2-0. */
  clean: number;
  /** Per win in a row from the second: 2 in a row pays this, 3 pays double… */
  streak: number;
  /** Ticked by the host from what happened on screen. */
  flawless: number;
  fatality: number;
  brutality: number;
}

export interface TourneySettings {
  name: string;
  startPoints: number;
  /** The fee on the first turn. */
  entryFee: number;
  /** The fee goes up every this many turns; 0 is never. */
  riseEvery: number;
  risePercent: number;
  bonuses: TourneyBonuses;
}

export const TOURNEY_DEFAULTS: TourneySettings = {
  name: 'MK11 Tournament',
  startPoints: 1000,
  entryFee: 100,
  riseEvery: 3,
  risePercent: 50,
  bonuses: { clean: 50, streak: 50, flawless: 50, fatality: 100, brutality: 50 },
};

export const TOURNEY_BOUNDS = {
  startPoints: { min: 100, max: 100_000 },
  entryFee: { min: 10, max: 100_000 },
  riseEvery: { min: 0, max: 20 },
  risePercent: { min: 0, max: 200 },
  bonus: { min: 0, max: 10_000 },
  entrants: { min: 2, max: 32 },
  name: { max: 40 },
} as const;

export type ManualBonus = 'flawless' | 'fatality' | 'brutality';
export const MANUAL_BONUSES: readonly ManualBonus[] = ['flawless', 'fatality', 'brutality'];
export type BonusKind = 'clean' | 'streak' | ManualBonus;

/** A best-of-3 won either way. */
export type MatchScore = '2-0' | '2-1';

export interface Entrant {
  id: string;
  name: string;
  /** Their MK11 main, from `MK11_ROSTER`. */
  main: string | null;
  /** The room player this is, if they have the app open. */
  playerId: string | null;
  points: number;
  wins: number;
  losses: number;
  /** Matches won in a row right now. */
  streak: number;
  bestStreak: number;
  bonusPoints: number;
  /** The turn they hit zero on; null while still in. */
  outOnTurn: number | null;
}

export interface TurnRecord {
  n: number;
  lap: number;
  a: string;
  b: string;
  fee: number;
  pot: number;
  winner: string;
  score: MatchScore;
  bonuses: { kind: BonusKind; points: number }[];
  /** Characters actually played, if the host noted them. */
  chars: { a: string | null; b: string | null } | null;
}

export type TourneyPhase = 'setup' | 'ready' | 'fighting' | 'ended';

export interface TourneyMatch {
  a: string;
  b: string;
  fee: number;
  /** What each fighter put in: the fee, or less if someone was all-in. */
  stake: number;
  pot: number;
}

/** The whole tournament. Nothing in it is secret, so it is also what everyone sees. */
export interface TourneyState {
  phase: TourneyPhase;
  settings: TourneySettings;
  entrants: Entrant[];
  /** The turn being played, from 1. */
  turn: number;
  lap: number;
  /** This lap's seating, by entrant id. */
  circle: string[];
  /** Matches still to come this lap; the first is the one up next. */
  queue: [string, string][];
  current: TourneyMatch | null;
  history: TurnRecord[];
  winners: string[];
}

/** What the room sends: the tournament, plus whether the host can undo. */
export interface TourneyPublic extends TourneyState {
  canUndo: boolean;
}

/** Everyone playable in MK11, DLC included. Names only. */
export const MK11_ROSTER: readonly string[] = [
  'Baraka', 'Cassie Cage', 'Cetrion', "D'Vorah", 'Erron Black', 'Frost', 'Fujin', 'Geras',
  'Jacqui Briggs', 'Jade', 'Jax', 'Johnny Cage', 'Joker', 'Kabal', 'Kano', 'Kitana', 'Kollector',
  'Kotal Kahn', 'Kung Lao', 'Liu Kang', 'Mileena', 'Nightwolf', 'Noob Saibot', 'Raiden', 'Rain',
  'Rambo', 'RoboCop', 'Scorpion', 'Shang Tsung', 'Shao Kahn', 'Sheeva', 'Sindel', 'Skarlet',
  'Sonya Blade', 'Spawn', 'Sub-Zero', 'Terminator',
];
