import { moveOf, type FighterFrame, type FighterId, type Move } from '@pic-game/shared';
import { STANCE, mix, with_, type Pose } from './skeleton.js';

const CROUCH: Pose = with_(STANCE, {
  hip: 52, torso: 22, fs: 45, fe: 100, bs: 30, be: 110,
  fh: 82, fk: -118, bh: 18, bk: -112,
});

const GUARD_HIGH: Partial<Pose> = { fs: 70, fe: 115, bs: 62, be: 120, torso: 2, head: 8 };
const GUARD_LOW: Partial<Pose> = { fs: 80, fe: 110, bs: 70, be: 118 };

const JUMP: Pose = with_(STANCE, { fh: 75, fk: -115, bh: 35, bk: -100, fs: 60, fe: 90, bs: 40, be: 100 });

/** How a move looks: a wind-up and a strike, both laid over a base stance. */
interface MovePose {
  base?: 'stand' | 'crouch' | 'jump';
  windup?: Partial<Pose>;
  strike: Partial<Pose>;
}

const JAB: MovePose = { windup: { fs: 60, fe: 120 }, strike: { fs: 90, fe: 0, torso: 14, hx: 6 } };
const CROSS: MovePose = { windup: { bs: 10, be: 120, torso: 0 }, strike: { bs: 92, be: 0, torso: 24, hx: 10, fs: 30, fe: 110 } };
const FKICK: MovePose = { windup: { fh: 60, fk: -100 }, strike: { fh: 88, fk: 0, torso: -12, bh: -6, bk: -6 } };
const HIGH_KICK: MovePose = { windup: { fh: 80, fk: -110 }, strike: { fh: 118, fk: 0, torso: -28, bh: -4, bk: -4 } };
const BKICK: MovePose = { windup: { bh: 40, bk: -100, torso: -10 }, strike: { bh: 108, bk: 0, fh: -8, fk: -4, torso: -30, hx: 8 } };
const UPPER: MovePose = {
  base: 'crouch',
  windup: { bs: -20, be: 40 },
  strike: { hip: 92, torso: 4, bs: 172, be: 0, fh: 20, fk: -20, bh: -18, bk: -10 },
};
const OVERHEAD: MovePose = {
  windup: { bs: 200, be: 20, torso: -12 },
  strike: { bs: 105, be: 20, torso: 28, hx: 10, fs: 40, fe: 90 },
};
const SWEEP: MovePose = {
  base: 'crouch',
  windup: { bh: 40, bk: -60 },
  strike: { hip: 36, torso: 45, bh: 98, bk: 0, fh: 70, fk: -130, fs: 120, fe: 30 },
};

const POSES: Record<string, MovePose> = {
  jab: JAB,
  cross: CROSS,
  fkick: FKICK,
  bkick: BKICK,
  lowjab: { base: 'crouch', windup: { fs: 60 }, strike: { fs: 82, fe: 0, torso: 26 } },
  uppercut: UPPER,
  lowkick: { base: 'crouch', windup: { fh: 70 }, strike: { fh: 100, fk: -8, torso: 5, hip: 44 } },
  sweep: SWEEP,
  overhead: OVERHEAD,
  jpunch: { base: 'jump', strike: { fs: 55, fe: 0, torso: 20 } },
  jkick: { base: 'jump', strike: { fh: 50, fk: 0, bh: 20, bk: -100, torso: -10 } },
  throw: { windup: { fs: 70, bs: 70 }, strike: { fs: 88, fe: 10, bs: 84, be: 20, torso: 16, hx: 8 } },
  fatal: { windup: { bs: -40, be: 60, torso: -10 }, strike: { fs: 95, fe: 0, bs: 95, be: 0, torso: 30, hx: 16 } },

  em_11: { windup: { bs: 60, be: 120 }, strike: { bs: 90, be: 0, torso: 18, hx: 6 } },
  em_112: FKICK,
  em_33: HIGH_KICK,
  em_spear: { windup: { fs: 20, fe: 140, torso: -8 }, strike: { fs: 92, fe: 0, torso: 18, hx: 8 } },
  em_teleport: { windup: { fs: 150 }, strike: { fs: 60, fe: 0, torso: 30, hx: 10 } },

  ri_23: { base: 'crouch', windup: { fh: 60 }, strike: { fh: 96, fk: -6, hip: 42 } },
  ri_234: { windup: { fh: 40, fk: -90 }, strike: { fh: 150, fk: 0, torso: -30, bh: -10, bk: -10 } },
  ri_ice: { windup: { fs: 20, fe: 120, bs: 10, be: 130 }, strike: { fs: 92, fe: 0, bs: 86, be: 0, torso: 14 } },
  ri_slide: { strike: { hip: 22, torso: -70, fh: 88, fk: 0, bh: 60, bk: -80, fs: -40, bs: -60, head: 30 } },

  vo_12: CROSS,
  vo_123: BKICK,
  vo_bolt: { windup: { fs: 30, fe: 120, bs: 20, be: 120 }, strike: { fs: 95, fe: 0, bs: 90, be: 0, torso: 10 } },
  vo_torpedo: { strike: { rot: -80, fs: 175, fe: 0, bs: 175, be: 0, fh: 0, fk: 0, bh: 0, bk: 0, hip: 90, torso: 0 } },

  vx_31: JAB,
  vx_312: OVERHEAD,
  vx_fan: { windup: { fs: -20, fe: 90, torso: -6 }, strike: { fs: 100, fe: 0, torso: 16 } },
  vx_lift: { base: 'crouch', windup: { fs: -30, fe: 30 }, strike: { hip: 86, fs: 160, fe: 0, torso: 0, fh: 20, fk: -20 } },
};

function base(kind: MovePose['base']): Pose {
  return kind === 'crouch' ? CROUCH : kind === 'jump' ? JUMP : STANCE;
}

/** Wind-up through the first part of startup, strike through the active
 *  frames, then back to the stance through recovery. */
function movePose(mv: Move, mf: number): Pose {
  const mp = POSES[mv.id] ?? JAB;
  const b = base(mp.base);
  const strike = with_(b, mp.strike);
  const windup = with_(b, mp.windup ?? {});
  const first = mv.hits[0];
  const at = first?.at ?? mv.projectile?.at ?? Math.max(2, Math.round(mv.total * 0.35));
  const last = first ? Math.max(...mv.hits.map((h) => h.at + h.active)) : at + 6;

  if (mf < at) {
    const t = mf / at;
    return t < 0.6 ? mix(b, windup, t / 0.6) : mix(windup, strike, (t - 0.6) / 0.4);
  }
  if (mf < last) return strike;
  const t = Math.min(1, (mf - last) / Math.max(1, mv.total - last));
  return mix(strike, b, t * t);
}

const wave = (t: number, speed: number) => Math.sin(t * speed);

/**
 * The pose for a fighter this frame. `t` is a free-running clock in frames
 * for idle motion that is not part of the sim.
 */
export function poseFor(ff: FighterFrame, fighter: FighterId, t: number): Pose {
  const sf = ff.sf;
  switch (ff.s) {
    case 'idle': case 'land': {
      const bob = wave(t, 0.09) * 2.2;
      const p = with_(STANCE, { hip: STANCE.hip + bob, fe: STANCE.fe + bob * 2, be: STANCE.be - bob * 2 });
      return ff.bl ? with_(p, GUARD_HIGH) : p;
    }
    case 'walk': {
      const s = wave(sf, 0.28);
      const p = with_(STANCE, {
        fh: 20 + s * 20, fk: -20 - Math.max(0, s) * 30,
        bh: -18 - s * 20, bk: -12 - Math.max(0, -s) * 30,
        hip: STANCE.hip + Math.abs(s) * 2,
      });
      return p;
    }
    case 'crouch':
      return ff.bl ? with_(CROUCH, GUARD_LOW) : CROUCH;
    case 'blockstun':
      return ff.cr ? with_(CROUCH, { ...GUARD_LOW, torso: 10 }) : with_(STANCE, { ...GUARD_HIGH, torso: -6, hx: -4 });
    case 'jump':
      return JUMP;
    case 'attack': {
      const mv = ff.m ? moveOf(fighter, ff.m) : undefined;
      return mv ? movePose(mv, ff.mf) : STANCE;
    }
    case 'hitstun': case 'thrown': {
      const k = Math.max(0, 1 - sf / 14);
      return with_(STANCE, {
        torso: -22 * k - 4, head: -20 * k, hx: -8 * k,
        fs: -20, fe: 40, bs: -35, be: 30,
        fh: 10, fk: -20, bh: -30, bk: -8,
      });
    }
    case 'stunned': case 'dizzy': {
      const s = wave(t, 0.07);
      return with_(STANCE, {
        torso: s * 12, head: -s * 18 + 10, fs: 8 + s * 10, fe: 20, bs: -8 - s * 10, be: 20,
        fh: 10, fk: -18, bh: -10, bk: -14, hip: 82,
      });
    }
    case 'frozen':
      return with_(STANCE, { torso: -10, fs: -10, fe: 40, bs: -25, be: 30 });
    case 'juggle': {
      const r = Math.min(80, 30 + sf * 4);
      return with_(STANCE, {
        rot: r, fs: -60, fe: 20, bs: -90, be: 30, fh: 30, fk: -40, bh: -10, bk: -20, head: -20,
      });
    }
    case 'knockdown': case 'ko':
      return with_(STANCE, {
        rot: ff.s === 'ko' && ff.y > 0 ? Math.min(90, 40 + sf * 5) : 90,
        hip: 14, fs: 20, fe: 20, bs: -30, be: 10, fh: 10, fk: -30, bh: -5, bk: -5, head: -10, torso: 0,
      });
    case 'getup': {
      const lying = with_(STANCE, { rot: 90, hip: 14, fh: 60, fk: -100, bh: 10, bk: -30, torso: 0 });
      return mix(lying, CROUCH, Math.min(1, sf / 20));
    }
    case 'throwing':
      return with_(STANCE, { fs: 88, fe: 10, bs: 84, be: 20, torso: 16, hx: 8 });
    case 'cinematic':
      return STANCE;
  }
}

/** Arms up, for the winner once it is over. */
export function victoryPose(t: number): Pose {
  const s = wave(t, 0.12) * 6;
  return with_(STANCE, { fs: 168 + s, fe: 10, bs: 160 - s, be: 10, torso: -4, head: -10, fh: 12, fk: -10, bh: -12, bk: -6 });
}

export { CROUCH, JUMP };
