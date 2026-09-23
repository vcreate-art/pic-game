/** Two fighters; anyone else in the room is watching. */
export type FightSide = 'a' | 'b';
export const FIGHT_SIDES: readonly FightSide[] = ['a', 'b'];

export type FighterId = 'ember' | 'rime' | 'volt' | 'vex';
export const FIGHTER_IDS: readonly FighterId[] = ['ember', 'rime', 'volt', 'vex'];

/**
 * One tick of input, as a bitmask. Directions are absolute (left/right on the
 * screen); the sim turns them into forward/back from whichever way the fighter
 * faces, so a motion like "back, forward" works from either side.
 *
 * The buttons follow MK11's layout: 1 front punch, 2 back punch, 3 front kick,
 * 4 back kick, plus a dedicated block.
 */
export const BTN = {
  UP: 1 << 0,
  DOWN: 1 << 1,
  LEFT: 1 << 2,
  RIGHT: 1 << 3,
  FP: 1 << 4,
  BP: 1 << 5,
  FK: 1 << 6,
  BK: 1 << 7,
  BLOCK: 1 << 8,
  THROW: 1 << 9,
  FATAL: 1 << 10,
} as const;

export const BTN_ALL = (1 << 11) - 1;
/** The four attack buttons, in the order a simultaneous press resolves. */
export const ATTACK_BTNS = [BTN.FP, BTN.BP, BTN.FK, BTN.BK] as const;
export type AttackBtn = (typeof ATTACK_BTNS)[number];

export interface TickInput {
  /** Everything held down this tick. */
  held: number;
  /** Buttons that went down since the last tick. Carried separately so a tap
   *  shorter than a tick still registers. */
  pressed: number;
}

export const NO_INPUT: TickInput = { held: 0, pressed: 0 };

export interface FightSettings {
  /** Rounds needed to take the match. 2 is the usual best of three. */
  roundsToWin: number;
  roundSeconds: number;
  /** Off swaps blood for hit sparks and makes the fatalities bloodless. */
  blood: boolean;
}

export const FIGHT_DEFAULTS: FightSettings = { roundsToWin: 2, roundSeconds: 90, blood: true };

export const FIGHT_BOUNDS = {
  roundsToWin: { min: 1, max: 3 },
  roundSeconds: { min: 30, max: 99 },
} as const;

export const TICK_HZ = 60;

/** The room's view of the match. The sim's own phases live in the frame. */
export type FightRoomPhase = 'lobby' | 'playing' | 'ended';

export type FightEnding = 'ko' | 'fatality' | 'timeout' | 'rounds' | 'forfeit' | null;

export type FightSeats = Partial<Record<FightSide, string | null>>;
export type FightPicks = Partial<Record<FightSide, FighterId | null>>;

export interface FightPublic {
  phase: FightRoomPhase;
  settings: FightSettings;
  seats: FightSeats;
  picks: FightPicks;
  wins: Record<FightSide, number>;
  winner: FightSide | null;
  reason: FightEnding;
  /** Set while a fighter's connection is gone. The match is frozen until
   *  they come back or `until` passes, at which point they forfeit. */
  paused: {
    side: FightSide;
    until: number;
    /** They are back, and play resumes at `until`. Otherwise they forfeit then. */
    resuming: boolean;
  } | null;
}

// ------------------------------------------------------------------ the sim

export type SimPhase =
  | 'intro'
  | 'fighting'
  | 'roundEnd'
  | 'finishHim'
  | 'fatality'
  | 'matchOver'
  | 'done';

export type FighterState =
  | 'idle'
  | 'walk'
  | 'crouch'
  | 'jump'
  | 'land'
  | 'attack'
  | 'hitstun'
  | 'blockstun'
  | 'juggle'
  | 'knockdown'
  | 'getup'
  | 'throwing'
  | 'thrown'
  | 'frozen'
  | 'stunned'
  | 'dizzy'
  | 'cinematic'
  | 'ko';

export type Height = 'high' | 'mid' | 'low' | 'overhead';

/** A rectangle relative to a fighter: `x` runs forward from their centre,
 *  `y` up from their feet. Flipped by facing when placed in the world. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ProjectileKind = 'spear' | 'ice' | 'bolt' | 'fan';

/** One fighter in a frame. Short keys: this goes out sixty times a second. */
export interface FighterFrame {
  x: number;
  y: number;
  /** 1 facing right, -1 facing left. */
  f: 1 | -1;
  s: FighterState;
  /** Frames spent in the current state. */
  sf: number;
  m: string | null;
  mf: number;
  h: number;
  me: number;
  /** Blocking, and crouching, as 0/1. */
  bl: 0 | 1;
  cr: 0 | 1;
  /** Fatal Blow ready. */
  fb: 0 | 1;
  /** Hits in the combo this fighter is currently eating. */
  cb: number;
  /** Mid-teleport: not drawn. */
  v: 0 | 1;
}

export interface ProjectileFrame {
  id: number;
  k: ProjectileKind;
  o: FightSide;
  x: number;
  y: number;
  d: 1 | -1;
}

export interface FightFrame {
  /** Tick number, so a client can drop a frame that arrives out of order. */
  t: number;
  p: SimPhase;
  /** Frames spent in the current phase. */
  pf: number;
  /** Round timer, in frames. */
  tm: number;
  r: number;
  /** Rounds won so far, a then b. */
  w: [number, number];
  /** Global hitstop. The client uses it to shake and hold the picture. */
  fz: number;
  a: FighterFrame;
  b: FighterFrame;
  pr: ProjectileFrame[];
  /** Whose Fatal Blow cinematic is running, and how far in. */
  cin: { s: FightSide; f: number } | null;
  /** Whose fatality is playing. */
  fat: FightSide | null;
}

export type Announce =
  | 'round'
  | 'fight'
  | 'ko'
  | 'time'
  | 'draw'
  | 'flawless'
  | 'finish'
  | 'fatality'
  | 'wins';

export type FightEvent =
  | {
      t: 'hit';
      /** The attacker. */
      side: FightSide;
      x: number;
      y: number;
      dmg: number;
      heavy: boolean;
    }
  | { t: 'block'; side: FightSide; x: number; y: number; chip: number }
  | { t: 'krush'; side: FightSide; move: string }
  | { t: 'fatalBlow'; side: FightSide; landed: boolean }
  | { t: 'throwBreak'; x: number; y: number }
  | { t: 'clash'; x: number; y: number }
  | { t: 'amplify'; side: FightSide }
  | { t: 'breaker'; side: FightSide }
  | { t: 'combo'; side: FightSide; hits: number; dmg: number }
  | { t: 'special'; side: FightSide; move: string }
  | { t: 'announce'; what: Announce; side?: FightSide; round?: number }
  | { t: 'fatality'; side: FightSide };
