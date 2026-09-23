import { FIGHTERS, RANGES, moveOf, type KrushWhen } from './fighters.js';
import {
  FATALITY_WINDOW, MOTION_WINDOW, isBack, isDown, isForward, isUp, matchMotion,
  newHistory, numpad, record, type InputHistory,
} from './input.js';
import { NORMALS, THROW_FRAMES, THROW_TECH_FRAMES, firstActive, type Hit, type Move } from './moves.js';
import {
  ATTACK_BTNS, BTN, type AttackBtn, type Box, type FightEnding, type FightEvent,
  type FightFrame, type FightSettings, type FightSide, type FighterFrame, type FighterId,
  type FighterState, type ProjectileKind, type SimPhase, type TickInput,
} from './types.js';

// ----------------------------------------------------------------- constants

export const STAGE_W = 1200;
export const WALL_L = 40;
export const WALL_R = STAGE_W - 40;
export const START_X: Record<FightSide, number> = { a: 420, b: 780 };

export const MAX_HEALTH = 1000;
export const METER_BAR = 1000;
export const METER_MAX = 2 * METER_BAR;
/** Fatal Blow unlocks at or below this much health. */
export const FATAL_THRESHOLD = 300;
/** After a whiffed or blocked Fatal Blow. Six seconds. */
export const FATAL_COOLDOWN = 360;
export const FATAL_BEATS = [40, 80, 120] as const;
export const FATAL_BEAT_DAMAGE = 100;
export const CINEMATIC_FRAMES = 150;

export const GRAVITY = 0.8;
export const JUMP_VY = 16;
export const JUMP_VX = 5;
/** Fighters closer than this are pushed apart. */
export const PUSH_W = 56;

export const INTRO_FRAMES = 150;
export const FIGHT_CALL_AT = 90;
export const ROUND_END_FRAMES = 180;
export const FINISH_FRAMES = 480;
export const FATALITY_FRAMES = 300;
export const FATALITY_ANNOUNCE_AT = 210;
export const MATCH_OVER_FRAMES = 180;
export const MAX_ROUNDS = 5;

const KNOCKDOWN_FRAMES = 40;
const GETUP_FRAMES = 20;
const LAND_FRAMES = 3;
/** A button press is remembered this long, so pressing a hair early works. */
const BUFFER_FRAMES = 6;
/** Past this many hits in the air the defender drops out of the juggle. */
const JUGGLE_LIMIT = 7;

// --------------------------------------------------------------------- state

export interface Fighter {
  side: FightSide;
  id: FighterId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  state: FighterState;
  /** Frames spent in the current state. */
  sf: number;
  /** Frames left in a timed state such as hitstun. */
  stun: number;
  move: string | null;
  /** Current frame of the move, counting from 1. */
  mf: number;
  moveStart: number;
  /** Which of the move's hits have already landed. */
  hitMask: number;
  /** The current move touched the opponent, on hit or block. */
  connected: boolean;
  amplified: boolean;
  airUsed: boolean;
  health: number;
  meter: number;
  held: number;
  /** Attack buttons pressed recently and not yet used. */
  buf: number;
  bufAge: number;
  /** The tick block was last pressed, for amplifying a special. */
  blockTap: number;
  hist: InputHistory;
  crouching: boolean;
  combo: number;
  comboDmg: number;
  juggles: number;
  fatalUsed: boolean;
  fatalCooldown: number;
  krushUsed: string[];
  /** Damage taken this round, for Flawless Victory. */
  roundDamage: number;
  throwTech: number;
}

export interface Projectile {
  id: number;
  owner: FightSide;
  kind: ProjectileKind;
  move: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  hitstun: number;
  blockstun: number;
  effect?: 'freeze' | 'pull';
  amplified: boolean;
}

export interface Match {
  settings: FightSettings;
  tick: number;
  phase: SimPhase;
  pf: number;
  round: number;
  wins: Record<FightSide, number>;
  timer: number;
  freeze: number;
  a: Fighter;
  b: Fighter;
  projectiles: Projectile[];
  nextId: number;
  cinematic: { side: FightSide; frame: number } | null;
  fatality: FightSide | null;
  /** The last round's result, for the Flawless call. */
  lastRound: { winner: FightSide | null; flawless: boolean } | null;
  winner: FightSide | null;
  reason: FightEnding;
}

export const otherSide = (s: FightSide): FightSide => (s === 'a' ? 'b' : 'a');

function newFighter(side: FightSide, id: FighterId): Fighter {
  return {
    side, id,
    x: START_X[side], y: 0, vx: 0, vy: 0,
    facing: side === 'a' ? 1 : -1,
    state: 'idle', sf: 0, stun: 0,
    move: null, mf: 0, moveStart: 0, hitMask: 0, connected: false, amplified: false, airUsed: false,
    health: MAX_HEALTH, meter: 0,
    held: 0, buf: 0, bufAge: 0, blockTap: -1, hist: newHistory(), crouching: false,
    combo: 0, comboDmg: 0, juggles: 0,
    fatalUsed: false, fatalCooldown: 0, krushUsed: [],
    roundDamage: 0, throwTech: 0,
  };
}

export function createMatch(settings: FightSettings, picks: Record<FightSide, FighterId>): Match {
  return {
    settings: { ...settings },
    tick: 0,
    phase: 'intro',
    pf: 0,
    round: 1,
    wins: { a: 0, b: 0 },
    timer: settings.roundSeconds * 60,
    freeze: 0,
    a: newFighter('a', picks.a),
    b: newFighter('b', picks.b),
    projectiles: [],
    nextId: 1,
    cinematic: null,
    fatality: null,
    lastRound: null,
    winner: null,
    reason: null,
  };
}

// ------------------------------------------------------------------- helpers

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
const r1 = (n: number) => Math.round(n * 10) / 10;

function setState(f: Fighter, s: FighterState, stun = 0): void {
  f.state = s;
  f.sf = 0;
  f.stun = stun;
  if (s !== 'attack') {
    f.move = null;
    f.mf = 0;
  }
}

function toNeutral(f: Fighter): void {
  if (f.y > 0) {
    setState(f, 'jump');
    f.airUsed = true;
    return;
  }
  setState(f, f.crouching ? 'crouch' : 'idle');
}

function currentMove(f: Fighter): Move | undefined {
  return f.move ? moveOf(f.id, f.move) : undefined;
}

export function fatalReady(m: Match, f: Fighter): boolean {
  return m.phase === 'fighting' && f.health <= FATAL_THRESHOLD && !f.fatalUsed && f.fatalCooldown === 0;
}

function actionable(f: Fighter): boolean {
  return f.y <= 0 && (f.state === 'idle' || f.state === 'walk' || f.state === 'crouch');
}

function controllable(m: Match, f: Fighter): boolean {
  return m.phase === 'fighting' || (m.phase === 'finishHim' && f.side === m.winner);
}

function canBlock(f: Fighter): boolean {
  return (
    f.y <= 0 &&
    (f.held & BTN.BLOCK) !== 0 &&
    (f.state === 'idle' || f.state === 'walk' || f.state === 'crouch' ||
      f.state === 'blockstun' || f.state === 'land')
  );
}

function vanished(f: Fighter): boolean {
  const mv = currentMove(f);
  return !!mv?.vanish && f.mf >= mv.vanish[0] && f.mf <= mv.vanish[1];
}

interface Rect { x1: number; x2: number; y1: number; y2: number }

export function worldBox(f: Pick<Fighter, 'x' | 'y' | 'facing'>, b: Box): Rect {
  const x1 = f.facing === 1 ? f.x + b.x : f.x - b.x - b.w;
  return { x1, x2: x1 + b.w, y1: f.y + b.y, y2: f.y + b.y + b.h };
}

/** Where a fighter can be hit, or null while they cannot be. */
export function hurtbox(f: Fighter): Rect | null {
  switch (f.state) {
    case 'knockdown': case 'getup': case 'cinematic': case 'ko':
    case 'throwing': case 'thrown':
      return null;
  }
  if (vanished(f)) return null;
  if (f.state === 'juggle') {
    if (f.juggles >= JUGGLE_LIMIT) return null;
    return worldBox(f, { x: -45, w: 90, y: 10, h: 110 });
  }
  const mv = currentMove(f);
  const low = f.y <= 0 && (f.state === 'crouch' || mv?.low || (f.crouching && f.state === 'blockstun'));
  return worldBox(f, low ? { x: -30, w: 60, y: 0, h: 110 } : { x: -30, w: 60, y: 0, h: 185 });
}

function overlap(a: Rect, b: Rect): { x: number; y: number } | null {
  const x1 = Math.max(a.x1, b.x1);
  const x2 = Math.min(a.x2, b.x2);
  const y1 = Math.max(a.y1, b.y1);
  const y2 = Math.min(a.y2, b.y2);
  if (x1 >= x2 || y1 >= y2) return null;
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

function firstAttackBtn(bits: number): AttackBtn | null {
  return ATTACK_BTNS.find((b) => (bits & b) !== 0) ?? null;
}

function wantsThrow(bits: number): boolean {
  return (bits & BTN.THROW) !== 0 || ((bits & BTN.FP) !== 0 && (bits & BTN.FK) !== 0);
}

// -------------------------------------------------------------------- input

function readInput(m: Match, f: Fighter, input: TickInput): void {
  f.held = input.held;
  record(f.hist, numpad(input.held, f.facing));
  const fresh = input.pressed & (BTN.FP | BTN.BP | BTN.FK | BTN.BK | BTN.THROW | BTN.FATAL);
  if (fresh) {
    // Presses a frame or two apart count as one chord, which is how a
    // keyboard delivers "1 + 3".
    f.buf = (f.bufAge <= 2 ? f.buf : 0) | fresh;
    f.bufAge = 0;
  }
  if (input.pressed & BTN.BLOCK) f.blockTap = m.tick;
}

function ageBuffer(f: Fighter): void {
  if (!f.buf) return;
  if (++f.bufAge > BUFFER_FRAMES) f.buf = 0;
}

// ------------------------------------------------------------------- moves

function startMove(m: Match, f: Fighter, id: string): void {
  const mv = moveOf(f.id, id)!;
  const airborne = f.y > 0;
  f.state = 'attack';
  f.sf = 0;
  f.move = id;
  f.mf = 0;
  f.moveStart = m.tick;
  f.hitMask = 0;
  f.connected = false;
  f.amplified = false;
  if (airborne) f.airUsed = true;
  else f.vx = 0;
  if (!mv.air || !airborne) f.crouching = false;
}

function inCancelWindow(f: Fighter): boolean {
  const mv = currentMove(f);
  return !!mv && f.state === 'attack' && f.mf >= firstActive(mv) && f.mf < mv.total;
}

/** Tries to turn the buffered buttons into a move. Returns whether it did. */
function tryStart(m: Match, f: Fighter, o: Fighter, ev: FightEvent[]): boolean {
  const bits = f.buf;
  const def = FIGHTERS[f.id];
  const dir = numpad(f.held, f.facing);
  const canAct = actionable(f);
  const airborne = f.y > 0 && f.state === 'jump';
  const cancel = inCancelWindow(f);
  const window = MOTION_WINDOW + f.bufAge;

  // A fatality, over a dizzy opponent at the right distance.
  if (m.phase === 'finishHim' && f.side === m.winner && canAct) {
    const fat = def.fatality;
    const [lo, hi] = RANGES[fat.range];
    const dist = Math.abs(f.x - o.x);
    if ((bits & fat.button) && dist >= lo && dist < hi && matchMotion(f.hist, fat.motion, FATALITY_WINDOW + f.bufAge)) {
      m.phase = 'fatality';
      m.pf = 0;
      m.fatality = f.side;
      m.reason = 'fatality';
      m.projectiles = [];
      setState(f, 'cinematic');
      f.vx = 0;
      ev.push({ t: 'fatality', side: f.side });
      return true;
    }
  }

  if ((bits & BTN.FATAL) && canAct && fatalReady(m, f)) {
    startMove(m, f, 'fatal');
    ev.push({ t: 'special', side: f.side, move: 'fatal' });
    return true;
  }

  // Specials: longest motion first, so D,B,F is not read as B,F.
  if (canAct || airborne || (cancel && f.connected)) {
    const specials = [...def.specials].sort((x, y) => y.motion.length - x.motion.length);
    for (const sp of specials) {
      if (!(bits & sp.button)) continue;
      const mv = moveOf(f.id, sp.move)!;
      if (airborne && !mv.air) continue;
      if (airborne && f.airUsed) continue;
      if (!matchMotion(f.hist, sp.motion, window)) continue;
      startMove(m, f, sp.move);
      ev.push({ t: 'special', side: f.side, move: sp.move });
      return true;
    }
  }

  // The next hit of a string, on hit, block or whiff alike.
  if (cancel && f.move) {
    const btn = firstAttackBtn(bits);
    const next = btn ? def.strings[f.move]?.[btn] : undefined;
    if (next) {
      startMove(m, f, next);
      return true;
    }
  }

  if (airborne && !f.airUsed) {
    if (bits & (BTN.FP | BTN.BP)) { startMove(m, f, 'jpunch'); return true; }
    if (bits & (BTN.FK | BTN.BK)) { startMove(m, f, 'jkick'); return true; }
  }

  if (!canAct) return false;

  if (wantsThrow(bits)) {
    startMove(m, f, 'throw');
    return true;
  }

  const btn = firstAttackBtn(bits);
  if (!btn) return false;
  let id: string;
  if (isDown(dir)) {
    id = btn === BTN.FP ? 'lowjab' : btn === BTN.BP ? 'uppercut' : btn === BTN.FK ? 'lowkick' : 'sweep';
  } else if (isForward(dir) && btn === BTN.BP) {
    id = 'overhead';
  } else if (isBack(dir) && btn === BTN.BK) {
    id = 'sweep';
  } else {
    id = btn === BTN.FP ? 'jab' : btn === BTN.BP ? 'cross' : btn === BTN.FK ? 'fkick' : 'bkick';
  }
  startMove(m, f, id);
  return true;
}

function movement(f: Fighter): void {
  const dir = numpad(f.held, f.facing);
  const blocking = (f.held & BTN.BLOCK) !== 0;
  f.crouching = isDown(dir);

  if (isUp(dir) && !blocking) {
    setState(f, 'jump');
    f.vy = JUMP_VY;
    f.vx = isForward(dir) ? JUMP_VX * f.facing : isBack(dir) ? -JUMP_VX * f.facing : 0;
    f.airUsed = false;
    f.crouching = false;
    return;
  }

  const def = FIGHTERS[f.id];
  let next: FighterState;
  if (f.crouching) {
    next = 'crouch';
    f.vx = 0;
  } else if (blocking) {
    // No walking with the guard up, as in MK.
    next = 'idle';
    f.vx = 0;
  } else if (isForward(dir)) {
    next = 'walk';
    f.vx = def.walkForward * f.facing;
  } else if (isBack(dir)) {
    next = 'walk';
    f.vx = -def.walkBack * f.facing;
  } else {
    next = 'idle';
    f.vx = 0;
  }
  if (f.state !== next) setState(f, next);
}

function control(m: Match, f: Fighter, o: Fighter, ev: FightEvent[]): void {
  // Throw break: press throw while being grabbed.
  if (f.state === 'thrown' && f.throwTech > 0 && wantsThrow(f.buf)) {
    f.buf = 0;
    setState(f, 'hitstun', 14);
    setState(o, 'hitstun', 14);
    f.vx = -8 * o.facing;
    o.vx = -8 * f.facing;
    ev.push({ t: 'throwBreak', x: (f.x + o.x) / 2, y: 120 });
    return;
  }

  // Breaker: forward + block while in blockstun, for the whole meter.
  if (
    f.state === 'blockstun' && f.meter >= METER_MAX && (f.held & BTN.BLOCK) &&
    matchMotion(f.hist, ['F'], 4) && hurtbox(o)
  ) {
    f.meter -= METER_MAX;
    setState(f, 'idle');
    setState(o, 'juggle');
    o.juggles = JUGGLE_LIMIT; // knocked away, not open to a combo
    o.y = Math.max(o.y, 1);
    o.vy = 8;
    o.vx = 8 * f.facing;
    m.freeze = Math.max(m.freeze, 8);
    ev.push({ t: 'breaker', side: f.side });
    return;
  }

  // A keyboard delivers "1 + 3" a frame or two apart, and the first key has
  // already started a jab or a kick by the time the second arrives. Catch
  // the second one here and turn the pair into the throw it was meant to be.
  if (
    f.state === 'attack' && f.mf <= 2 &&
    ((f.move === 'jab' && (f.buf & BTN.FK)) || (f.move === 'fkick' && (f.buf & BTN.FP)))
  ) {
    f.buf = 0;
    startMove(m, f, 'throw');
    return;
  }

  if (f.buf && (actionable(f) || inCancelWindow(f) || (f.state === 'jump' && !f.airUsed))) {
    if (tryStart(m, f, o, ev)) f.buf = 0;
  }

  if (actionable(f)) movement(f);
  // The guard can switch between high and low while it is being hit.
  else if (f.state === 'blockstun' || f.state === 'land') f.crouching = isDown(numpad(f.held, f.facing));
}

/** Advances a move one frame and applies whatever that frame does. */
function progress(m: Match, f: Fighter, o: Fighter, ev: FightEvent[]): void {
  if (f.state !== 'attack') return;
  const mv = currentMove(f);
  if (!mv) return;
  f.mf++;

  // Amplify: tap block during a special's startup, for one bar.
  if (mv.special && !f.amplified && f.mf <= 10 && f.blockTap >= f.moveStart && f.meter >= METER_BAR) {
    f.meter -= METER_BAR;
    f.amplified = true;
    ev.push({ t: 'amplify', side: f.side });
  }

  if (mv.vel) {
    const stopped = mv.stopOnHit && f.connected;
    const v = mv.vel.find((w) => f.mf >= w.from && f.mf <= w.to);
    if (v && !stopped) f.vx = v.vx * f.facing;
    else if (f.y <= 0 && (stopped || mv.vel.some((w) => f.mf === w.to + 1))) f.vx = 0;
  }

  if (mv.teleport === f.mf) {
    f.x = clamp(o.x + f.facing * 90, WALL_L, WALL_R);
    f.facing = o.x >= f.x ? 1 : -1;
  }

  const p = mv.projectile;
  if (p && p.at === f.mf) {
    const air = f.y > 0;
    m.projectiles.push({
      id: m.nextId++,
      owner: f.side,
      kind: p.kind,
      move: mv.id,
      x: f.x + f.facing * 50,
      y: f.y + p.y,
      vx: p.speed * f.facing,
      vy: air ? (p.vy ?? -4) : 0,
      life: p.life,
      damage: p.damage,
      hitstun: p.hitstun,
      blockstun: p.blockstun,
      effect: p.effect,
      amplified: f.amplified,
    });
  }

  if (f.mf >= mv.total) {
    if (mv.fatal && !f.fatalUsed) {
      f.fatalCooldown = FATAL_COOLDOWN;
      ev.push({ t: 'fatalBlow', side: f.side, landed: false });
    }
    toNeutral(f);
  }
}

// ------------------------------------------------------------------ physics

function physics(f: Fighter): void {
  if (f.state === 'throwing' || f.state === 'thrown' || f.state === 'cinematic' || f.state === 'dizzy') {
    f.vx = 0;
    return;
  }
  f.x = clamp(f.x + f.vx, WALL_L, WALL_R);

  if (f.y > 0 || f.vy > 0) {
    f.y += f.vy;
    f.vy -= f.state === 'juggle' ? GRAVITY * (1 + 0.12 * f.juggles) : GRAVITY;
    if (f.y <= 0) {
      f.y = 0;
      f.vy = 0;
      if (f.state === 'juggle') {
        setState(f, 'knockdown', KNOCKDOWN_FRAMES);
        f.vx = 0;
      } else if (f.state === 'jump' || f.state === 'attack') {
        setState(f, 'land', LAND_FRAMES);
        f.vx = 0;
      } else if (f.state === 'ko') {
        f.vx *= 0.5;
      }
    }
    return;
  }

  // Grounded: walking and dashing moves set their own speed each frame, and
  // everything else slides to a stop.
  const driven =
    f.state === 'walk' ||
    (f.state === 'attack' && !!currentMove(f)?.vel?.some((w) => f.mf >= w.from && f.mf <= w.to));
  if (!driven) {
    f.vx *= 0.8;
    if (Math.abs(f.vx) < 0.1) f.vx = 0;
  }
}

function pushApart(a: Fighter, b: Fighter): void {
  if (vanished(a) || vanished(b)) return;
  if (a.y > 110 || b.y > 110) return; // jumping over is allowed
  if (a.state === 'thrown' || b.state === 'thrown') return;
  const dx = b.x - a.x;
  const gap = PUSH_W - Math.abs(dx);
  if (gap <= 0) return;
  const dir = dx !== 0 ? Math.sign(dx) : a.facing;
  a.x = clamp(a.x - (dir * gap) / 2, WALL_L, WALL_R);
  b.x = clamp(b.x + (dir * gap) / 2, WALL_L, WALL_R);
  // Against a wall one side cannot give way, so the other takes all of it.
  const left = PUSH_W - Math.abs(b.x - a.x);
  if (left > 0.01) {
    if (a.x === WALL_L || a.x === WALL_R) b.x = clamp(a.x + dir * PUSH_W, WALL_L, WALL_R);
    else a.x = clamp(b.x - dir * PUSH_W, WALL_L, WALL_R);
  }
}

function faceEachOther(f: Fighter, o: Fighter): void {
  if (f.x === o.x) return;
  if (f.state === 'idle' || f.state === 'walk' || f.state === 'crouch' || f.state === 'land' || f.state === 'dizzy') {
    f.facing = o.x > f.x ? 1 : -1;
  }
}

// --------------------------------------------------------------------- hits

function krushFor(att: Fighter, def: Fighter, moveId: string): boolean {
  const k = FIGHTERS[att.id].krush.find((x) => x.move === moveId);
  if (!k || att.krushUsed.includes(moveId)) return false;
  return krushCondition(k.when, def);
}

function krushCondition(when: KrushWhen, def: Fighter): boolean {
  const mv = currentMove(def);
  switch (when) {
    case 'counter':
      return def.state === 'attack' && !!mv && def.mf < firstActive(mv);
    case 'punish': {
      if (def.state !== 'attack' || !mv || def.connected) return false;
      const last = mv.hits.at(-1);
      const pastHits = last ? def.mf >= last.at + last.active : def.mf > (mv.projectile?.at ?? 0);
      return pastHits;
    }
    case 'combo3':
      return def.combo >= 2;
  }
}

/** Applies one hit. Returns what happened. */
function applyHit(
  m: Match, att: Fighter, def: Fighter, hit: Hit, mv: Move, amplified: boolean,
  at: { x: number; y: number }, ev: FightEvent[],
): 'hit' | 'block' {
  att.connected = true;

  if (canBlock(def)) {
    const crouched = def.crouching;
    const ok = crouched ? hit.height !== 'overhead' : hit.height !== 'low';
    if (ok) {
      const chip = mv.special ? Math.round(hit.damage * 0.1 * (amplified ? 1.35 : 1)) : 0;
      def.health = Math.max(0, def.health - chip);
      def.roundDamage += chip;
      setState(def, 'blockstun', hit.blockstun);
      def.vx = att.facing * hit.push;
      def.meter = Math.min(METER_MAX, def.meter + 15);
      m.freeze = Math.max(m.freeze, 3);
      ev.push({ t: 'block', side: def.side, x: r1(at.x), y: r1(at.y), chip });
      if (mv.fatal && !att.fatalUsed) att.fatalCooldown = FATAL_COOLDOWN;
      return 'block';
    }
  }

  if (mv.fatal) {
    // The cinematic takes it from here and deals the damage in beats.
    att.fatalUsed = true;
    setState(att, 'cinematic');
    setState(def, 'cinematic');
    att.vx = def.vx = att.vy = def.vy = 0;
    def.y = 0;
    att.y = 0;
    def.x = clamp(att.x + att.facing * 80, WALL_L, WALL_R);
    m.cinematic = { side: att.side, frame: 0 };
    m.projectiles = [];
    ev.push({ t: 'fatalBlow', side: att.side, landed: true });
    return 'hit';
  }

  const krush = krushFor(att, def, mv.id);
  const scale = Math.max(0.4, 0.9 ** def.combo);
  let dmg = hit.damage * scale * (amplified ? 1.35 : 1);
  if (krush) dmg *= 1.5;
  dmg = Math.round(dmg);

  const wasDizzy = def.state === 'dizzy';
  def.health = Math.max(0, def.health - dmg);
  def.roundDamage += dmg;
  def.combo++;
  def.comboDmg += dmg;
  att.meter = Math.min(METER_MAX, att.meter + dmg * 0.5);
  def.meter = Math.min(METER_MAX, def.meter + dmg * 0.7);

  ev.push({ t: 'hit', side: att.side, x: r1(at.x), y: r1(at.y), dmg, heavy: krush || dmg >= 60 });
  if (krush) {
    att.krushUsed.push(mv.id);
    ev.push({ t: 'krush', side: att.side, move: mv.id });
  }

  if (wasDizzy) {
    // A plain hit on a dizzy opponent ends it, without the fatality.
    knockOut(def, att.facing);
    m.phase = 'matchOver';
    m.pf = 0;
    m.freeze = Math.max(m.freeze, 12);
    return 'hit';
  }

  const airborne = def.y > 0 || def.state === 'juggle';
  if (hit.launch || airborne) {
    setState(def, 'juggle');
    def.juggles++;
    def.vy = hit.launch ? hit.launch.vy : Math.max(5, 9 - def.juggles);
    def.vx = (hit.launch?.vx ?? 2) * att.facing;
    def.y = Math.max(def.y, 1);
  } else if (hit.knockdown) {
    setState(def, 'juggle');
    def.juggles = JUGGLE_LIMIT;
    def.vy = 7;
    def.vx = 4 * att.facing;
    def.y = 1;
  } else {
    setState(def, 'hitstun', hit.hitstun + (amplified ? 4 : 0));
    def.vx = att.facing * hit.push;
  }

  m.freeze = Math.max(m.freeze, krush ? 30 : mv.special ? 8 : 5);
  return 'hit';
}

function knockOut(f: Fighter, from: 1 | -1): void {
  setState(f, 'ko');
  f.y = Math.max(f.y, 1);
  f.vy = 7;
  f.vx = 5 * from;
}

function tryGrab(att: Fighter, def: Fighter): boolean {
  if (def.y > 0 || def.crouching) return false;
  const ok = def.state === 'idle' || def.state === 'walk' || def.state === 'land' ||
    (def.state === 'attack' && !currentMove(def)?.air);
  if (!ok) return false;
  setState(att, 'throwing', THROW_FRAMES);
  setState(def, 'thrown', THROW_FRAMES);
  def.throwTech = THROW_TECH_FRAMES;
  att.vx = def.vx = 0;
  def.x = clamp(att.x + att.facing * 70, WALL_L, WALL_R);
  return true;
}

interface PendingHit { att: Fighter; def: Fighter; hit: Hit; mv: Move; index: number; at: { x: number; y: number } }

function collectHits(f: Fighter, o: Fighter): PendingHit[] {
  if (f.state !== 'attack') return [];
  const mv = currentMove(f);
  const hurt = hurtbox(o);
  if (!mv || !hurt) return [];
  const out: PendingHit[] = [];
  mv.hits.forEach((hit, index) => {
    if (f.hitMask & (1 << index)) return;
    if (f.mf < hit.at || f.mf >= hit.at + hit.active) return;
    const at = overlap(worldBox(f, hit.box), hurt);
    if (at) out.push({ att: f, def: o, hit, mv, index, at });
  });
  return out;
}

function resolveHits(m: Match, ev: FightEvent[]): void {
  // Collected from both sides before either is applied, so two attacks that
  // land on the same frame trade instead of the first one cancelling the other.
  const pending = [...collectHits(m.a, m.b), ...collectHits(m.b, m.a)];
  const phase = m.phase;
  for (const p of pending) {
    // A Fatal Blow or a finishing hit takes over the frame; nothing trades with it.
    if (m.cinematic || m.phase !== phase) break;
    p.att.hitMask |= 1 << p.index;
    if (p.mv.grab) {
      if (tryGrab(p.att, p.def)) p.att.connected = true;
      continue;
    }
    applyHit(m, p.att, p.def, p.hit, p.mv, p.att.amplified, p.at, ev);
  }
}

function fighter(m: Match, s: FightSide): Fighter {
  return s === 'a' ? m.a : m.b;
}

function updateProjectiles(m: Match, ev: FightEvent[]): void {
  for (const p of m.projectiles) {
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
  }

  // Opposing projectiles cancel each other out.
  const dead = new Set<number>();
  for (const p of m.projectiles) {
    for (const q of m.projectiles) {
      if (p.owner === q.owner || dead.has(p.id) || dead.has(q.id)) continue;
      if (Math.abs(p.x - q.x) < 40 && Math.abs(p.y - q.y) < 40) {
        dead.add(p.id);
        dead.add(q.id);
        ev.push({ t: 'clash', x: r1((p.x + q.x) / 2), y: r1((p.y + q.y) / 2) });
      }
    }
  }

  for (const p of m.projectiles) {
    if (dead.has(p.id)) continue;
    const att = fighter(m, p.owner);
    const def = fighter(m, otherSide(p.owner));
    const hurt = hurtbox(def);
    const box = { x1: p.x - 22, x2: p.x + 22, y1: p.y - 16, y2: p.y + 16 };
    const at = hurt && overlap(box, hurt);
    if (at) {
      dead.add(p.id);
      const hit: Hit = {
        at: 0, active: 1, box: { x: 0, y: 0, w: 0, h: 0 }, damage: p.damage, height: 'mid',
        hitstun: p.hitstun, blockstun: p.blockstun, push: 4,
      };
      const mv = moveOf(att.id, p.move) ?? NORMALS.jab!;
      const before = m.phase;
      const result = applyHit(m, att, def, hit, mv, p.amplified, at, ev);
      if (result === 'hit' && m.phase === before && def.state === 'hitstun') {
        if (p.effect === 'freeze') {
          setState(def, 'frozen', p.amplified ? 100 : 70);
          def.vx = 0;
        } else if (p.effect === 'pull') {
          def.x = clamp(att.x + att.facing * 95, WALL_L, WALL_R);
          def.vx = 0;
          setState(def, 'stunned', p.hitstun);
        }
      }
      continue;
    }
    if (p.life <= 0 || p.x < 0 || p.x > STAGE_W || p.y < 0) dead.add(p.id);
  }
  if (dead.size) m.projectiles = m.projectiles.filter((p) => !dead.has(p.id));
}

// ---------------------------------------------------------------- per frame

function tickState(m: Match, f: Fighter, o: Fighter, ev: FightEvent[]): void {
  f.sf++;
  if (f.fatalCooldown > 0) f.fatalCooldown--;
  if (m.phase === 'fighting' && f.meter < METER_MAX) f.meter = Math.min(METER_MAX, f.meter + 0.5);

  switch (f.state) {
    case 'hitstun': case 'blockstun': case 'frozen': case 'stunned': case 'land': case 'getup':
    case 'throwing':
      if (--f.stun <= 0) toNeutral(f);
      break;
    case 'knockdown':
      if (--f.stun <= 0) setState(f, 'getup', GETUP_FRAMES);
      break;
    case 'thrown':
      if (f.throwTech > 0) f.throwTech--;
      if (--f.stun <= 0) {
        const dmg = NORMALS.throw!.hits[0]!.damage;
        f.health = Math.max(0, f.health - dmg);
        f.roundDamage += dmg;
        o.meter = Math.min(METER_MAX, o.meter + dmg * 0.5);
        setState(f, 'juggle');
        f.juggles = JUGGLE_LIMIT;
        f.y = 1;
        f.vy = 9;
        f.vx = 5 * o.facing;
        m.freeze = Math.max(m.freeze, 8);
        ev.push({ t: 'hit', side: o.side, x: r1(f.x), y: 90, dmg, heavy: true });
      }
      break;
  }
}

function endCombo(m: Match, f: Fighter, ev: FightEvent[]): void {
  if (f.combo === 0) return;
  switch (f.state) {
    case 'hitstun': case 'juggle': case 'frozen': case 'stunned': case 'thrown': case 'cinematic':
      return;
  }
  if (f.combo >= 2) ev.push({ t: 'combo', side: otherSide(f.side), hits: f.combo, dmg: f.comboDmg });
  f.combo = 0;
  f.comboDmg = 0;
  f.juggles = 0;
}

/** The full frame of fighting: input, moves, movement, hits, projectiles. */
function simulate(m: Match, ev: FightEvent[]): void {
  const { a, b } = m;
  tickState(m, a, b, ev);
  tickState(m, b, a, ev);

  for (const [f, o] of [[a, b], [b, a]] as const) {
    if (controllable(m, f)) control(m, f, o, ev);
    else if (f.state === 'walk') {
      setState(f, 'idle');
      f.vx = 0;
    }
    ageBuffer(f);
  }
  if (m.phase === 'fatality') return; // a fatality just started

  progress(m, a, b, ev);
  progress(m, b, a, ev);
  physics(a);
  physics(b);
  pushApart(a, b);
  faceEachOther(a, b);
  faceEachOther(b, a);
  resolveHits(m, ev);
  updateProjectiles(m, ev);
  endCombo(m, a, ev);
  endCombo(m, b, ev);
}

function runCinematic(m: Match, ev: FightEvent[]): void {
  const c = m.cinematic!;
  c.frame++;
  const att = fighter(m, c.side);
  const def = fighter(m, otherSide(c.side));
  if ((FATAL_BEATS as readonly number[]).includes(c.frame)) {
    def.health = Math.max(0, def.health - FATAL_BEAT_DAMAGE);
    def.roundDamage += FATAL_BEAT_DAMAGE;
    ev.push({ t: 'hit', side: att.side, x: r1(def.x), y: 120, dmg: FATAL_BEAT_DAMAGE, heavy: true });
  }
  if (c.frame >= CINEMATIC_FRAMES) {
    m.cinematic = null;
    setState(att, 'idle');
    setState(def, 'juggle');
    def.juggles = JUGGLE_LIMIT;
    def.y = 1;
    def.vy = 9;
    def.vx = 6 * att.facing;
    def.combo = 0;
    def.comboDmg = 0;
  }
}

function resetRound(m: Match): void {
  m.round++;
  m.phase = 'intro';
  m.pf = 0;
  m.timer = m.settings.roundSeconds * 60;
  m.projectiles = [];
  m.cinematic = null;
  for (const f of [m.a, m.b]) {
    f.x = START_X[f.side];
    f.y = f.vx = f.vy = 0;
    f.facing = f.side === 'a' ? 1 : -1;
    setState(f, 'idle');
    f.health = MAX_HEALTH;
    f.roundDamage = 0;
    f.combo = f.comboDmg = f.juggles = 0;
    f.buf = 0;
    f.crouching = false;
  }
}

/** Ends the round. `winner` null is a draw. */
function endRound(m: Match, winner: FightSide | null, how: 'ko' | 'time', ev: FightEvent[]): void {
  const w = winner ? fighter(m, winner) : null;
  const l = winner ? fighter(m, otherSide(winner)) : null;
  m.projectiles = [];
  m.lastRound = { winner, flawless: !!w && w.roundDamage === 0 };

  if (winner) m.wins[winner]++;

  if (winner && m.wins[winner] >= m.settings.roundsToWin) {
    // Match point. The loser staggers, and the winner gets to finish it.
    m.winner = winner;
    m.reason = how === 'ko' ? 'ko' : 'timeout';
    m.phase = 'finishHim';
    m.pf = 0;
    setState(l!, 'dizzy');
    l!.x = clamp(l!.x, WALL_L, WALL_R);
    l!.y = l!.vx = l!.vy = 0;
    l!.health = how === 'ko' ? 0 : l!.health;
    if (w!.state !== 'attack') toNeutral(w!);
    ev.push({ t: 'announce', what: 'finish', side: l!.side });
    return;
  }

  m.phase = 'roundEnd';
  m.pf = 0;
  if (how === 'time') ev.push({ t: 'announce', what: 'time' });
  if (!winner) {
    ev.push({ t: 'announce', what: 'draw' });
    return;
  }
  if (how === 'ko') {
    knockOut(l!, w!.facing);
    ev.push({ t: 'announce', what: 'ko', side: winner });
  }
}

function checkKo(m: Match, ev: FightEvent[]): void {
  if (m.phase !== 'fighting' || m.cinematic) return;
  const aDead = m.a.health <= 0;
  const bDead = m.b.health <= 0;
  if (!aDead && !bDead) return;
  if (aDead && bDead) {
    knockOut(m.a, m.b.facing);
    knockOut(m.b, m.a.facing);
    endRound(m, null, 'ko', ev);
    return;
  }
  endRound(m, aDead ? 'b' : 'a', 'ko', ev);
}

function finishMatch(m: Match): void {
  m.phase = 'matchOver';
  m.pf = 0;
}

/**
 * Advances the match by one tick, mutating it, and returns what happened.
 *
 * Pure in the sense that matters: no clock and no randomness, so the same
 * inputs from the same state always give the same result. The server calls
 * this sixty times a second; the tests call it in loops.
 */
export function step(m: Match, inA: TickInput, inB: TickInput): FightEvent[] {
  const ev: FightEvent[] = [];
  m.tick++;
  readInput(m, m.a, inA);
  readInput(m, m.b, inB);
  if (m.phase === 'done') return ev;

  // Hitstop: the whole picture holds. Inputs above still land in the history,
  // so a motion entered during the freeze still counts.
  if (m.freeze > 0) {
    m.freeze--;
    return ev;
  }

  m.pf++;
  switch (m.phase) {
    case 'intro':
      if (m.pf === 1) ev.push({ t: 'announce', what: 'round', round: m.round });
      if (m.pf === FIGHT_CALL_AT) ev.push({ t: 'announce', what: 'fight' });
      simulate(m, ev);
      if (m.pf >= INTRO_FRAMES) {
        m.phase = 'fighting';
        m.pf = 0;
      }
      break;

    case 'fighting':
      if (m.cinematic) {
        runCinematic(m, ev);
        checkKo(m, ev);
        break;
      }
      simulate(m, ev);
      checkKo(m, ev);
      if (m.phase === 'fighting' && --m.timer <= 0) {
        m.timer = 0;
        const { a, b } = m;
        endRound(m, a.health === b.health ? null : a.health > b.health ? 'a' : 'b', 'time', ev);
      }
      break;

    case 'roundEnd':
      simulate(m, ev);
      if (m.pf === 60 && m.lastRound?.flawless) {
        ev.push({ t: 'announce', what: 'flawless', side: m.lastRound.winner ?? undefined });
      }
      if (m.pf >= ROUND_END_FRAMES) {
        if (m.round >= MAX_ROUNDS) {
          m.winner = m.wins.a === m.wins.b ? null : m.wins.a > m.wins.b ? 'a' : 'b';
          m.reason = 'rounds';
          finishMatch(m);
        } else {
          resetRound(m);
        }
      }
      break;

    case 'finishHim':
      simulate(m, ev);
      if (m.phase === 'finishHim' && m.pf >= FINISH_FRAMES) {
        const loser = fighter(m, otherSide(m.winner!));
        knockOut(loser, fighter(m, m.winner!).facing);
        finishMatch(m);
      }
      break;

    case 'fatality':
      if (m.pf === FATALITY_ANNOUNCE_AT) ev.push({ t: 'announce', what: 'fatality', side: m.fatality! });
      if (m.pf >= FATALITY_FRAMES) finishMatch(m);
      break;

    case 'matchOver':
      if (m.pf === 1) ev.push({ t: 'announce', what: 'wins', side: m.winner ?? undefined });
      tickState(m, m.a, m.b, ev);
      tickState(m, m.b, m.a, ev);
      physics(m.a);
      physics(m.b);
      if (m.pf >= MATCH_OVER_FRAMES) m.phase = 'done';
      break;
  }
  return ev;
}

// -------------------------------------------------------------------- frame

function fighterFrame(m: Match, f: Fighter): FighterFrame {
  return {
    x: r1(f.x),
    y: r1(f.y),
    f: f.facing,
    s: f.state,
    sf: f.sf,
    m: f.move,
    mf: f.mf,
    h: Math.round(f.health),
    me: Math.round(f.meter),
    bl: canBlock(f) ? 1 : 0,
    cr: f.crouching ? 1 : 0,
    fb: fatalReady(m, f) ? 1 : 0,
    cb: f.combo,
    v: vanished(f) ? 1 : 0,
  };
}

/** The per-tick snapshot everyone receives. */
export function toFrame(m: Match): FightFrame {
  return {
    t: m.tick,
    p: m.phase,
    pf: m.pf,
    tm: m.timer,
    r: m.round,
    fz: m.freeze,
    a: fighterFrame(m, m.a),
    b: fighterFrame(m, m.b),
    pr: m.projectiles.map((p) => ({
      id: p.id, k: p.kind, o: p.owner, x: r1(p.x), y: r1(p.y), d: p.vx >= 0 ? 1 : -1,
    })),
    cin: m.cinematic ? { s: m.cinematic.side, f: m.cinematic.frame } : null,
    fat: m.fatality,
  };
}
