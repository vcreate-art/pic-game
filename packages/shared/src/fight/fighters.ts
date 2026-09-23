import { NORMALS, type Move } from './moves.js';
import { BTN, type AttackBtn, type FighterId } from './types.js';

/** A direction in a motion, relative to facing. */
export type Dir = 'F' | 'B' | 'D' | 'U';

export interface Special {
  motion: Dir[];
  button: AttackBtn;
  move: string;
}

export type KrushWhen =
  /** Hits a fighter who is winding up an attack of their own. */
  | 'counter'
  /** Hits a fighter stuck in the recovery of an attack that missed. */
  | 'punish'
  /** Lands as the third hit or later of a combo. */
  | 'combo3';

export type Range = 'close' | 'mid' | 'far';

export interface FighterDef {
  id: FighterId;
  name: string;
  color: string;
  blurb: string;
  walkForward: number;
  walkBack: number;
  /** This fighter's own moves: string follow-ups and specials. */
  moves: Record<string, Move>;
  /** From a move, which button continues the string, and into what. */
  strings: Record<string, Partial<Record<AttackBtn, string>>>;
  specials: Special[];
  krush: { move: string; when: KrushWhen }[];
  fatalBlow: string;
  fatality: { name: string; motion: Dir[]; button: AttackBtn; range: Range };
}

/** Distance between fighters for each fatality range. */
export const RANGES: Record<Range, [number, number]> = {
  close: [0, 170],
  mid: [170, 360],
  far: [360, Infinity],
};

const HIGH = { y: 140, h: 34 };

export const FIGHTERS: Record<FighterId, FighterDef> = {
  ember: {
    id: 'ember',
    name: 'Ember',
    color: '#f97316',
    blurb: 'Hauls you in on a chain, then burns through the gap.',
    walkForward: 4.6,
    walkBack: 3.6,
    moves: {
      em_11: {
        id: 'em_11', name: 'Hellfire 2', total: 20,
        hits: [{ at: 6, active: 3, box: { x: 30, w: 66, ...HIGH }, damage: 32, height: 'high', hitstun: 16, blockstun: 10, push: 3 }],
      },
      em_112: {
        id: 'em_112', name: 'Hellfire 3', total: 34,
        hits: [{ at: 10, active: 4, box: { x: 30, w: 80, y: 90, h: 60 }, damage: 60, height: 'mid', hitstun: 24, blockstun: 14, push: 10 }],
      },
      em_33: {
        id: 'em_33', name: 'Ash Step', total: 32,
        hits: [{ at: 9, active: 4, box: { x: 30, w: 90, y: 110, h: 60 }, damage: 55, height: 'mid', hitstun: 22, blockstun: 12, push: 8 }],
      },
      em_spear: {
        id: 'em_spear', name: 'Chain Spear', total: 42, special: true,
        hits: [],
        projectile: { at: 12, kind: 'spear', speed: 24, y: 150, life: 22, damage: 60, hitstun: 50, blockstun: 16, effect: 'pull' },
      },
      em_teleport: {
        id: 'em_teleport', name: 'Flame Step', total: 40, special: true,
        vanish: [4, 14], teleport: 10,
        hits: [{
          at: 16, active: 4, box: { x: 20, w: 80, y: 110, h: 70 }, damage: 90, height: 'mid',
          hitstun: 26, blockstun: 16, push: 6, knockdown: true,
        }],
      },
    },
    strings: { jab: { [BTN.FP]: 'em_11' }, em_11: { [BTN.BP]: 'em_112' }, fkick: { [BTN.FK]: 'em_33' } },
    specials: [
      { motion: ['B', 'F'], button: BTN.FP, move: 'em_spear' },
      { motion: ['D', 'B'], button: BTN.FK, move: 'em_teleport' },
    ],
    krush: [
      { move: 'uppercut', when: 'counter' },
      { move: 'em_spear', when: 'punish' },
    ],
    fatalBlow: 'Cinder Rite',
    fatality: { name: 'Burnout', motion: ['F', 'B', 'F'], button: BTN.FK, range: 'mid' },
  },

  rime: {
    id: 'rime',
    name: 'Rime',
    color: '#22d3ee',
    blurb: 'Freezes you where you stand and slides in under the guard.',
    walkForward: 4.2,
    walkBack: 3.6,
    moves: {
      ri_23: {
        id: 'ri_23', name: 'Cold Snap 2', total: 24, low: true,
        hits: [{ at: 8, active: 3, box: { x: 25, w: 85, y: 0, h: 40 }, damage: 40, height: 'low', hitstun: 18, blockstun: 11, push: 3 }],
      },
      ri_234: {
        id: 'ri_234', name: 'Cold Snap 3', total: 38,
        hits: [{
          at: 11, active: 4, box: { x: 20, w: 80, y: 80, h: 110 }, damage: 60, height: 'mid',
          hitstun: 26, blockstun: 14, push: 3, launch: { vx: 2, vy: 15 },
        }],
      },
      ri_ice: {
        id: 'ri_ice', name: 'Ice Ball', total: 44, special: true,
        hits: [],
        projectile: { at: 14, kind: 'ice', speed: 13, y: 130, life: 90, damage: 40, hitstun: 20, blockstun: 16, effect: 'freeze' },
      },
      ri_slide: {
        id: 'ri_slide', name: 'Glacier Slide', total: 40, special: true, low: true, stopOnHit: true,
        vel: [{ from: 5, to: 22, vx: 13 }],
        hits: [{
          at: 5, active: 18, box: { x: 10, w: 70, y: 0, h: 40 }, damage: 90, height: 'low',
          hitstun: 24, blockstun: 18, push: 4, knockdown: true,
        }],
      },
    },
    strings: { cross: { [BTN.FK]: 'ri_23' }, ri_23: { [BTN.BK]: 'ri_234' } },
    specials: [
      { motion: ['D', 'F'], button: BTN.FP, move: 'ri_ice' },
      { motion: ['B', 'F'], button: BTN.BK, move: 'ri_slide' },
    ],
    krush: [
      { move: 'uppercut', when: 'counter' },
      { move: 'ri_slide', when: 'punish' },
    ],
    fatalBlow: 'Deep Winter',
    fatality: { name: 'Shatter', motion: ['B', 'F', 'D'], button: BTN.BK, range: 'close' },
  },

  volt: {
    id: 'volt',
    name: 'Volt',
    color: '#facc15',
    blurb: 'Throws lightning from across the screen and arrives headfirst.',
    walkForward: 4.4,
    walkBack: 3.8,
    moves: {
      vo_12: {
        id: 'vo_12', name: 'Static 2', total: 24,
        hits: [{ at: 8, active: 3, box: { x: 30, w: 72, ...HIGH }, damage: 42, height: 'high', hitstun: 18, blockstun: 11, push: 4 }],
      },
      vo_123: {
        id: 'vo_123', name: 'Static 3', total: 36,
        hits: [{
          at: 11, active: 4, box: { x: 30, w: 86, y: 70, h: 50 }, damage: 60, height: 'mid',
          hitstun: 24, blockstun: 14, push: 10, knockdown: true,
        }],
      },
      vo_bolt: {
        id: 'vo_bolt', name: 'Lightning Bolt', total: 42, special: true,
        hits: [],
        projectile: { at: 13, kind: 'bolt', speed: 17, y: 150, life: 80, damage: 100, hitstun: 22, blockstun: 16 },
      },
      vo_torpedo: {
        id: 'vo_torpedo', name: 'Torpedo', total: 46, special: true, stopOnHit: true,
        vel: [{ from: 8, to: 30, vx: 18 }],
        hits: [{
          at: 8, active: 23, box: { x: 10, w: 70, y: 90, h: 70 }, damage: 120, height: 'mid',
          hitstun: 26, blockstun: 20, push: 8, knockdown: true,
        }],
      },
    },
    strings: { jab: { [BTN.BP]: 'vo_12' }, vo_12: { [BTN.FK]: 'vo_123' } },
    specials: [
      { motion: ['D', 'B'], button: BTN.FP, move: 'vo_bolt' },
      { motion: ['B', 'F'], button: BTN.FK, move: 'vo_torpedo' },
    ],
    krush: [
      { move: 'vo_torpedo', when: 'punish' },
      { move: 'vo_123', when: 'combo3' },
    ],
    fatalBlow: 'Storm Call',
    fatality: { name: 'Overload', motion: ['D', 'F', 'D'], button: BTN.FP, range: 'far' },
  },

  vex: {
    id: 'vex',
    name: 'Vex',
    color: '#a855f7',
    blurb: 'Fans from the ground and the air, and a lift that sets up juggles.',
    walkForward: 4.8,
    walkBack: 4.0,
    moves: {
      vx_31: {
        id: 'vx_31', name: 'Royal 2', total: 22,
        hits: [{ at: 7, active: 3, box: { x: 30, w: 68, ...HIGH }, damage: 35, height: 'high', hitstun: 17, blockstun: 10, push: 3 }],
      },
      vx_312: {
        id: 'vx_312', name: 'Royal 3', total: 38,
        hits: [{ at: 15, active: 4, box: { x: 25, w: 75, y: 60, h: 120 }, damage: 55, height: 'overhead', hitstun: 24, blockstun: 12, push: 6 }],
      },
      vx_fan: {
        id: 'vx_fan', name: 'Fan Toss', total: 38, special: true, air: true,
        hits: [],
        projectile: { at: 11, kind: 'fan', speed: 18, y: 140, life: 75, damage: 80, hitstun: 20, blockstun: 14 },
      },
      vx_lift: {
        id: 'vx_lift', name: 'Fan Lift', total: 48, special: true,
        hits: [{
          at: 16, active: 5, box: { x: 70, w: 230, y: 0, h: 150 }, damage: 70, height: 'mid',
          hitstun: 30, blockstun: 16, push: 0, launch: { vx: -1.5, vy: 17 },
        }],
      },
    },
    strings: { fkick: { [BTN.FP]: 'vx_31' }, vx_31: { [BTN.BP]: 'vx_312' } },
    specials: [
      { motion: ['B', 'F'], button: BTN.FP, move: 'vx_fan' },
      { motion: ['D', 'B'], button: BTN.BP, move: 'vx_lift' },
    ],
    krush: [
      { move: 'vx_lift', when: 'counter' },
      { move: 'uppercut', when: 'counter' },
    ],
    fatalBlow: 'Court Decree',
    fatality: { name: 'Split', motion: ['D', 'B', 'F'], button: BTN.BP, range: 'mid' },
  },
};

export function moveOf(fighter: FighterId, id: string): Move | undefined {
  return FIGHTERS[fighter].moves[id] ?? NORMALS[id];
}

export const BUTTON_LABEL: Record<AttackBtn, string> = {
  [BTN.FP]: '1',
  [BTN.BP]: '2',
  [BTN.FK]: '3',
  [BTN.BK]: '4',
};

/** "B, F + 1", for the move list. */
export function notation(motion: Dir[], button: AttackBtn): string {
  return `${motion.join(', ')} + ${BUTTON_LABEL[button]}`;
}
