/**
 * Maze Wars: a top-down deathmatch in a maze.
 *
 * Everyone starts somewhere different in a maze made fresh for the match,
 * moves with WASD, aims with the mouse and shoots. Bullets stop at walls. Die
 * and you are back a moment later, as far from everyone as the maze allows.
 * Most kills wins, at the kill limit or when time runs out.
 *
 * The server runs the simulation and is the only judge of hits. Clients send
 * their controls every tick and draw what comes back; each predicts its own
 * movement so that it answers the keys at once.
 */

/** Simulation rate. Inputs are sent at this rate too, one per tick. */
export const MAZE_HZ = 30;
export const MAZE_DT = 1 / MAZE_HZ;

/** World units are pixels at 1× zoom. */
export const MAZE_TILE = 32;
/** A maze cell is this many tiles of floor, with a one-tile wall after it. */
export const CELL_FLOOR = 3;
export const CELL = CELL_FLOOR + 1;

export const PLAYER_R = 13;
/** Pixels a second. */
export const PLAYER_SPEED = 190;
export const MAX_HP = 100;
export const BULLET_SPEED = 780;
export const BULLET_DAMAGE = 20;
/** Ticks a bullet flies before it fades, about 800 px. */
export const BULLET_LIFE = 31;
/** Ticks between shots: six a second. */
export const FIRE_EVERY = 5;
/** Ticks dead before coming back. */
export const RESPAWN_TICKS = Math.round(2.5 * MAZE_HZ);
/** Ticks after a respawn in which nothing can hurt you, or be hurt by you. */
export const PROTECT_TICKS = Math.round(1.5 * MAZE_HZ);
/** Health comes back after this long unhurt, at REGEN_PER_TICK a tick. */
export const REGEN_AFTER = 4 * MAZE_HZ;
export const REGEN_PER_TICK = 10 / MAZE_HZ;
/** How long a shot shows you on the others' radar, when radar is on firing only. */
export const RADAR_TICKS = 3 * MAZE_HZ;

/** Aim travels as 0…4095 round the circle. */
export const AIM_STEPS = 4096;
export const toAim = (radians: number): number =>
  ((Math.round((radians / (Math.PI * 2)) * AIM_STEPS) % AIM_STEPS) + AIM_STEPS) % AIM_STEPS;
export const fromAim = (aim: number): number => (aim / AIM_STEPS) * Math.PI * 2;

/** Movement keys, as bits. */
export const MV = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8 } as const;

/** One tick of one player's controls. */
export interface MazeInput {
  /** Rises by one a tick. The server says which it has applied, so the
   *  client can replay the rest on top of the server's position. */
  seq: number;
  keys: number;
  aim: number;
  fire: boolean;
}

export type MazeRadar = 'all' | 'firing';

export interface MazeSettings {
  /** Minutes. */
  minutes: number;
  /** Kills that end the match; 0 plays to the clock. */
  killLimit: number;
  radar: MazeRadar;
}

export const MAZE_DEFAULTS: MazeSettings = { minutes: 5, killLimit: 15, radar: 'all' };
export const MAZE_MINUTES = [3, 5, 8, 12] as const;
export const MAZE_KILL_LIMITS = [10, 15, 25, 0] as const;
export const MAZE_MIN_PLAYERS = 2;
export const MAZE_MAX_PLAYERS = 10;

export type MazePhase = 'lobby' | 'playing' | 'ended';

export interface MazeScore {
  kills: number;
  deaths: number;
}

/** Everything that changes rarely, sent whenever it does. */
export interface MazePublic {
  phase: MazePhase;
  settings: MazeSettings;
  /** Everyone in the match, in seat order. Frames refer to them by index. */
  players: string[];
  /** The maze is rebuilt on every client from these. */
  seed: number;
  cols: number;
  rows: number;
  scores: Record<string, MazeScore>;
  /** Server epoch ms. */
  endsAt: number;
  winners: string[];
}

/** Player flags in a frame. */
export const PF = { ALIVE: 1, SAFE: 2, RADAR: 4, AWAY: 8 } as const;

/**
 * One tick of the match, sent unreliably: a late frame is useless.
 *  - p: per seat [x, y, aim, hp, flags, ack, respawnIn]
 *  - b: bullets [id, x, y, seat]
 */
export interface MazeFrame {
  t: number;
  p: [number, number, number, number, number, number, number][];
  b: [number, number, number, number][];
}

/** What happened, sent reliably so no kill is ever missed. Seats, not ids. */
export type MazeEvent =
  | { k: 'hit'; v: number; by: number; x: number; y: number }
  | { k: 'kill'; v: number; by: number }
  | { k: 'spawn'; s: number; x: number; y: number };

/** Ten seat colours, far enough apart to tell at a glance on a dark floor. */
export const MAZE_COLORS = [
  '#f43f5e', '#38bdf8', '#facc15', '#4ade80', '#c084fc',
  '#fb923c', '#2dd4bf', '#f472b6', '#a3e635', '#e2e8f0',
] as const;
