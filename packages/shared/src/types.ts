import type { WordSource } from './spies/types.js';

/** Fixed logical drawing surface. Every client renders to this and scales on display,
 *  so a stroke drawn on a phone lands in the same place on a desktop. */
export const LOGICAL_W = 800;
export const LOGICAL_H = 600;

/** Coordinates travel as 12-bit ints (0..4095) rather than floats. */
export const QUANT = 4095;

export type Phase = 'lobby' | 'choosing' | 'drawing' | 'turnEnd' | 'gameEnd';

import type { KungFuPublic } from './kungfu/types.js';
import type { RealmsPublic } from './realms/types.js';
import type { FightFrame, FightPublic } from './fight/types.js';
import type { RacePublic } from './race/types.js';
import type { SpiesPublic } from './spies/types.js';
import type { BingoPublic } from './bingo/types.js';
import type { CryptidPublic } from './cryptid/types.js';
import type { Flip7Public } from './flip7/types.js';
import type { TourneyPublic } from './tourney/types.js';

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

/** Where the game's own words come from: the shipped list, the host's words
 *  alone, or both together. In players mode these fill the gaps suggestions
 *  leave. */
export const WORD_SOURCES: readonly WordSource[] = ['builtin', 'mixed', 'custom'];

export const CUSTOM_WORDS = {
  /** Past this, the rest of what was pasted is dropped. */
  max: 500,
  /** Fewest words an "only mine" game may start with. Fewer than this and the
   *  same handful would come round every other turn. */
  minForGame: 10,
} as const;

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
  wordSource: WordSource;
  /** The host's words. Replaced wholesale via `room:words`, never patched. */
  customWords: string[];
}

export const DEFAULT_SETTINGS: RoomSettings = {
  rounds: 3,
  drawTime: 80,
  wordChoices: 3,
  hints: 2,
  maxPlayers: 12,
  wordMode: 'builtin',
  wordSource: 'builtin',
  customWords: [],
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
  /** Who has given this drawing a thumbs up, or down. */
  likes: string[];
  dislikes: string[];
}

export type Vote = 'like' | 'dislike';

/** One finished turn's picture, kept for the gallery at the end of the game. */
export interface Drawing {
  id: string;
  round: number;
  drawerId: string;
  /** Kept with the drawing, so it still has a name if the drawer has left. */
  drawerName: string;
  word: string;
  ops: CanvasOp[];
  likes: string[];
  dislikes: string[];
}

/** Which game a room is playing. Fixed when the room is created. */
export type GameKind = 'skribbl' | 'kungfu' | 'realms' | 'fight' | 'race' | 'spies' | 'bingo' | 'cryptid' | 'flip7' | 'tourney';

export const GAME_KINDS: readonly GameKind[] = ['skribbl', 'kungfu', 'realms', 'fight', 'race', 'spies', 'bingo', 'cryptid', 'flip7', 'tourney'];

/** The ones with a playable interface. A kind can exist on the server before
 *  it has a screen, and the picker should only offer what can be played. */
export const PLAYABLE_KINDS: readonly GameKind[] = ['skribbl', 'kungfu', 'realms', 'fight', 'race', 'spies', 'bingo', 'cryptid', 'flip7', 'tourney'];

export const GAME_LABELS: Record<GameKind, { name: string; blurb: string }> = {
  skribbl: { name: 'Draw & Guess', blurb: 'One draws a secret word, everyone else races to guess.' },
  kungfu: { name: 'Kung Fu Chess', blurb: 'Chess with no turns. Every piece has a cooldown.' },
  realms: { name: 'Star Realms', blurb: 'Build a deck, buy warships, blow up your friend.' },
  fight: { name: 'Stick Kombat', blurb: 'Best of three. Then finish them.' },
  race: { name: 'Meat Race', blurb: 'Run, jump, glide and climb. Beat the saws and each other.' },
  spies: { name: 'Word Spies', blurb: 'One-word clues, two teams, and an assassin to avoid.' },
  tourney: { name: 'MK11 Tournament', blurb: 'Points, rising entry fees and best-of-3 MK11 matches. Last one standing wins.' },
  bingo: { name: 'Bingo', blurb: 'Fill your grid, call numbers in turn, or play the 75-ball hall game.' },
  cryptid: { name: 'Cryptid', blurb: 'One clue each, one creature on the map. Ask, search, and find it first.' },
  flip7: { name: 'Flip 7', blurb: 'Flip cards, dodge duplicates, bank before you bust. Seven different numbers wins big.' },
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
  /** Every drawing of the game just played. Only filled in at `gameEnd`. */
  gallery: Drawing[];
}

export interface KungFuRoomState extends RoomStateBase {
  kind: 'kungfu';
  game: KungFuPublic;
}

export interface RealmsRoomState extends RoomStateBase {
  kind: 'realms';
  game: RealmsPublic;
}

export interface FightRoomState extends RoomStateBase {
  kind: 'fight';
  game: FightPublic;
  /** The latest frame of a match in progress, so a late joiner or a
   *  reconnecting fighter has a picture before the next tick arrives. */
  frame: FightFrame | null;
}

export interface RaceRoomState extends RoomStateBase {
  kind: 'race';
  game: RacePublic;
}

export interface SpiesRoomState extends RoomStateBase {
  kind: 'spies';
  game: SpiesPublic;
}

export interface BingoRoomState extends RoomStateBase {
  kind: 'bingo';
  game: BingoPublic;
}

export interface CryptidRoomState extends RoomStateBase {
  kind: 'cryptid';
  game: CryptidPublic;
}

export interface Flip7RoomState extends RoomStateBase {
  kind: 'flip7';
  game: Flip7Public;
}

export interface TourneyRoomState extends RoomStateBase {
  kind: 'tourney';
  game: TourneyPublic;
}

/** Discriminated on `kind`, so reading a field the other game does not have is
 *  a compile error rather than an undefined at runtime. */
export type RoomState =
  | SkribblRoomState | KungFuRoomState | RealmsRoomState | FightRoomState | RaceRoomState
  | SpiesRoomState | BingoRoomState | CryptidRoomState | Flip7RoomState | TourneyRoomState;

/** `divider` marks a new turn: the chat draws it as a rule, not a line of text. */
export type ChatKind = 'chat' | 'system' | 'correct' | 'close' | 'secret' | 'divider';

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
