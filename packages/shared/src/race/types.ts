/** Tile edge in world pixels. Levels are authored in tiles, simulated in pixels. */
export const TILE = 32;

export const T = {
  AIR: 0,
  SOLID: 1,
  SPIKE_UP: 2,
  SPIKE_DOWN: 3,
  /** On a wall, points left. */
  SPIKE_LEFT: 4,
  SPIKE_RIGHT: 5,
  CRUMBLE: 6,
} as const;

/** One tick of controls. Jump is an edge as well as a hold: pressing it jumps,
 *  holding it rises higher, and holding it on the way down glides. Dash is the
 *  same: pressing it dashes, holding it afterwards sprints. */
export const RB = {
  LEFT: 1 << 0,
  RIGHT: 1 << 1,
  UP: 1 << 2,
  DOWN: 1 << 3,
  JUMP: 1 << 4,
  DASH: 1 << 5,
} as const;

export type ChaserPace = 'off' | 'slow' | 'normal' | 'fast';
export const CHASER_PACES: readonly ChaserPace[] = ['off', 'slow', 'normal', 'fast'];
/** Pixels per second. A clean run is roughly twice the normal pace. */
export const CHASER_SPEED: Record<ChaserPace, number> = { off: 0, slow: 110, normal: 150, fast: 190 };

export interface RaceSettings {
  /** How many levels the cup runs, from the first. */
  levels: number;
  chaser: ChaserPace;
}

export const RACE_DEFAULTS: RaceSettings = { levels: 3, chaser: 'normal' };

export type RacePhase = 'lobby' | 'countdown' | 'racing' | 'results' | 'podium';

export type DeathCause = 'spikes' | 'saw' | 'laser' | 'cannon' | 'pit';

export interface LevelResult {
  /** Finish time in ms, or null for did-not-finish. */
  time: number | null;
  place: number | null;
  points: number;
  deaths: number;
  /** Caught by the chaser, as opposed to still running when it ended. */
  caught: boolean;
}

export interface RacePublic {
  phase: RacePhase;
  settings: RaceSettings;
  /** Index into LEVELS of the level being raced, or just raced. */
  level: number;
  /** Which level of the cup this is, from 1. */
  leg: number;
  /** Server epoch ms at which the level's clock reads zero: GO. */
  startAt: number;
  /** When the current phase gives way to the next, for countdowns. */
  nextAt: number;
  /** Players racing this level. Late joiners watch until the next one. */
  racers: string[];
  /** This level's results so far, by player id. */
  results: Record<string, LevelResult>;
  /** Cup points so far, by player id. */
  points: Record<string, number>;
}

/** Points by finishing place, Mario Kart style. Past the table, one point
 *  for finishing at all; nothing for not finishing. */
export const PLACE_POINTS = [10, 8, 6, 5, 4, 3, 2, 1] as const;

export function pointsFor(place: number | null): number {
  if (place === null) return 0;
  return PLACE_POINTS[place - 1] ?? 1;
}

/** A player as others see them: position plus enough to animate. Sent a
 *  dozen times a second, so kept to a flat tuple. */
export type Ghost = [x: number, y: number, vx: number, vy: number, flags: number];

export const GF = {
  FACING_LEFT: 1 << 0,
  GROUND: 1 << 1,
  WALL: 1 << 2,
  GLIDE: 1 << 3,
  DEAD: 1 << 4,
  DONE: 1 << 5,
  DASH: 1 << 6,
  SPRINT: 1 << 7,
} as const;

export type RaceEvent =
  | { t: 'died'; id: string; cause: DeathCause }
  | { t: 'checkpoint'; id: string; n: number }
  | { t: 'finish'; id: string; place: number; time: number }
  | { t: 'caught'; id: string };
