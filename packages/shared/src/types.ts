/** Fixed logical drawing surface. Every client renders to this and scales on display,
 *  so a stroke drawn on a phone lands in the same place on a desktop. */
export const LOGICAL_W = 800;
export const LOGICAL_H = 600;

/** Coordinates travel as 12-bit ints (0..4095) rather than floats. */
export const QUANT = 4095;

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'turnEnd' | 'gameEnd';

import type { KungFuPublic } from './kungfu/types.js';

export interface Avatar {
  /** index into AVATAR_COLORS */
  color: number;
  /** index into AVATAR_FACES */
  face: number;
}

export interface Player {
  /** Stable for the room's lifetime. Deliberately NOT socket.id, which changes
   *  on every reconnect and would clone the player and drop their score. */
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  connected: boolean;
}

/** `builtin` draws from the shipped word list; `players` has the non-drawing
 *  players suggest the words the drawer picks from. */
export type WordMode = 'builtin' | 'players';

export const WORD_MODES: readonly WordMode[] = ['builtin', 'players'];

/** Seconds the drawer gets to pick, once the options are on the table. */
export const CHOOSE_SECONDS = 15;
/** Backstop for the suggestion window. It normally closes early, the moment
 *  every connected player has sent a word. */
export const SUGGEST_SECONDS = 25;

export interface RoomSettings {
  rounds: number;
  /** seconds */
  drawTime: number;
  wordChoices: number;
  hints: number;
  maxPlayers: number;
  wordMode: WordMode;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  rounds: 3,
  drawTime: 80,
  wordChoices: 3,
  hints: 2,
  maxPlayers: 12,
  wordMode: 'builtin',
};

/** One option on the drawer's pick list. Carries an id because the list grows
 *  while the drawer is looking at it, so a positional index is not stable. */
export interface WordOption {
  id: string;
  text: string;
}

export const SETTINGS_BOUNDS = {
  rounds: { min: 1, max: 10 },
  drawTime: { min: 30, max: 180 },
  wordChoices: { min: 2, max: 5 },
  hints: { min: 0, max: 5 },
  maxPlayers: { min: 2, max: 16 },
} as const;

export type PenTool = 'pen' | 'eraser';

export interface StrokeOp {
  kind: 'stroke';
  id: string;
  by: string;
  tool: PenTool;
  color: string;
  /** brush width in logical pixels */
  size: number;
  /** flat quantized pairs: [x0,y0,x1,y1,...] */
  pts: number[];
}

export interface FillOp {
  kind: 'fill';
  id: string;
  by: string;
  x: number;
  y: number;
  color: string;
}

export type CanvasOp = StrokeOp | FillOp;

/** What every player may know about the current turn. The word itself is absent
 *  by construction — it is delivered only to the drawer via `word:secret`. */
export interface TurnPublic {
  drawerId: string;
  /** 1-based */
  round: number;
  /** index into the turn order within this round */
  turnIndex: number;
  /** letters as '_', spaces and hyphens shown literally */
  mask: string;
  /** mask index -> revealed character */
  revealed: Record<number, string>;
  /** server epoch ms */
  endsAt: number;
  /** player ids who have already guessed correctly */
  guessed: string[];
}

/** Which game a room is playing. Fixed when the room is created. */
export type GameKind = 'skribbl' | 'kungfu';

export const GAME_KINDS: readonly GameKind[] = ['skribbl', 'kungfu'];

export const GAME_LABELS: Record<GameKind, { name: string; blurb: string }> = {
  skribbl: { name: 'Draw & Guess', blurb: 'One draws a secret word, everyone else races to guess.' },
  kungfu: { name: 'Kung Fu Chess', blurb: 'Chess with no turns. Every piece has a cooldown.' },
};

/** What every room reports, whichever game it is running. */
export interface RoomStateBase {
  code: string;
  kind: GameKind;
  players: Player[];
  hostId: string;
  /** server epoch ms at send time, for clock-offset estimation */
  serverTime: number;
}

export interface SkribblRoomState extends RoomStateBase {
  kind: 'skribbl';
  phase: Phase;
  settings: RoomSettings;
  round: number;
  turn: TurnPublic | null;
  /** full canvas history, so a late joiner replays the drawing exactly */
  ops: CanvasOp[];
}

export interface KungFuRoomState extends RoomStateBase {
  kind: 'kungfu';
  game: KungFuPublic;
}

/** Discriminated on `kind`, so reading a field the other game does not have is
 *  a compile error rather than an undefined at runtime. */
export type RoomState = SkribblRoomState | KungFuRoomState;

export type ChatKind = 'chat' | 'system' | 'correct' | 'close' | 'secret';

export interface ChatMessage {
  id: string;
  kind: ChatKind;
  /** absent for system messages */
  playerId?: string;
  name?: string;
  text: string;
  at: number;
}

export const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
] as const;

export const AVATAR_FACES = ['^_^', 'o_o', '>_<', '-_-', 'O_O', 'u_u', 'T_T', 'n_n'] as const;

export const PALETTE = [
  '#000000', '#6b7280', '#ef4444', '#f97316', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#d946ef', '#ec4899', '#a16207', '#ffffff',
] as const;

export const BRUSH_SIZES = [4, 10, 20, 36] as const;
