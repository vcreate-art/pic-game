import type { GameKind, RoomCountdown, RoomPause, RoomStage } from './types.js';

/** God mode: a page for the person running the server to watch any room's
 *  full state, secrets included, and steer it. Behind a key on its own
 *  socket namespace; it never takes a seat. */

export const GOD_NAMESPACE = '/god';

/** Speeds the god page offers for a room's clock; 0 freezes it. */
export const GOD_SPEEDS = [0, 0.5, 1, 2, 5, 10] as const;

/** Most ticks one step may move a room's clock. */
export const GOD_MAX_STEP = 600;

export interface GodRoomSummary {
  code: string;
  kind: GameKind;
  stage: RoomStage;
  phase: string;
  players: number;
  connected: number;
  createdAt: number;
}

export interface GodTimelineEntry {
  seq: number;
  at: number;
  tick: number;
  text: string;
}

export interface GodClock {
  /** Whole seconds of room time since the room was made, and since the
   *  current game went into play (null in the lobby). */
  tick: number;
  gameTick: number | null;
  /** 1 is real time; 0 is frozen. */
  speed: number;
  /** Timers waiting, soonest first. */
  pending: { label: string; inMs: number; every: number | null }[];
  /** False for games still on their own timers, whose clock god mode
   *  leaves alone. */
  controllable: boolean;
}

export interface GodRoom {
  code: string;
  kind: GameKind;
  stage: RoomStage;
  createdAt: number;
  hostId: string;
  players: { id: string; name: string; connected: boolean; score: number; host: boolean; awayForMs: number | null }[];
  paused: RoomPause | null;
  countdown: RoomCountdown | null;
  clock: GodClock;
  /** What only this game knows, secrets included. */
  details: Record<string, unknown>;
  /** Timeline lines after the `since` asked for, oldest first. */
  timeline: GodTimelineEntry[];
}

export type GodAction =
  | { kind: 'speed'; speed: number }
  | { kind: 'step'; ticks: number }
  | { kind: 'next' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'restart' }
  | { kind: 'lobby' }
  | { kind: 'kick'; playerId: string }
  | { kind: 'skipTurn' }
  | { kind: 'endRound' }
  | { kind: 'endGame' };

export type GodReply = { ok: true } | { ok: false; message: string };

export interface GodClientEvents {
  'god:rooms': (cb: (rooms: GodRoomSummary[]) => void) => void;
  'god:room': (p: { code: string; since: number }, cb: (room: GodRoom | null) => void) => void;
  'god:act': (p: { code: string; action: GodAction }, cb: (r: GodReply) => void) => void;
}
