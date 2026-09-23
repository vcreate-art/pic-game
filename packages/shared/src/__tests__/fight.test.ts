import { describe, expect, it } from 'vitest';
import {
  BTN, CINEMATIC_FRAMES, FATAL_BEAT_DAMAGE, FATAL_COOLDOWN, FIGHT_DEFAULTS, FINISH_FRAMES,
  MAX_HEALTH, METER_MAX, ROUND_END_FRAMES, createMatch, matchMotion, newHistory, numpad,
  record, step, toFrame, type FightEvent, type FighterId, type Match,
} from '../index.js';

const { UP, DOWN, LEFT, RIGHT, FP, BP, FK, BK, BLOCK, THROW, FATAL } = BTN;

function fight(a: FighterId = 'ember', b: FighterId = 'rime', settings = FIGHT_DEFAULTS): Match {
  const m = createMatch(settings, { a, b });
  while (m.phase === 'intro') step(m, { held: 0, pressed: 0 }, { held: 0, pressed: 0 });
  return m;
}

/** Puts the two fighters `gap` apart in the middle of the stage. */
function place(m: Match, gap: number): void {
  m.a.x = 600 - gap / 2;
  m.b.x = 600 + gap / 2;
}

/** One tick. `pa`/`pb` are presses; presses are also held for that tick. */
function tick(m: Match, ha = 0, pa = 0, hb = 0, pb = 0): FightEvent[] {
  return step(m, { held: ha | pa, pressed: pa }, { held: hb | pb, pressed: pb });
}

/** Holds inputs for `n` ticks and collects every event. */
function run(m: Match, n: number, ha = 0, hb = 0): FightEvent[] {
  const out: FightEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...tick(m, ha, 0, hb, 0));
  return out;
}

const hits = (ev: FightEvent[]) => ev.filter((e) => e.t === 'hit');
const blocks = (ev: FightEvent[]) => ev.filter((e) => e.t === 'block');
const has = (ev: FightEvent[], t: FightEvent['t']) => ev.some((e) => e.t === t);

describe('input', () => {
  it('reads directions relative to facing', () => {
    expect(numpad(RIGHT, 1)).toBe(6);
    expect(numpad(RIGHT, -1)).toBe(4);
    expect(numpad(DOWN | LEFT, 1)).toBe(1);
    expect(numpad(DOWN | LEFT, -1)).toBe(3);
    expect(numpad(LEFT | RIGHT, 1)).toBe(5);
    expect(numpad(UP | RIGHT, 1)).toBe(9);
  });

  it('matches a motion as a sequence of direction changes', () => {
    const h = newHistory();
    for (const d of [5, 4, 4, 5, 6] as const) record(h, d);
    expect(matchMotion(h, ['B', 'F'])).toBe(true);
    expect(matchMotion(h, ['F', 'B'])).toBe(false);
  });

  it('does not count a direction held from before as a fresh press', () => {
    const h = newHistory();
    for (let i = 0; i < 20; i++) record(h, 6);
    expect(matchMotion(h, ['F'])).toBe(false);
  });

  it('lets the first direction of a motion be one already held', () => {
    const h = newHistory();
    for (let i = 0; i < 30; i++) record(h, 4);
    record(h, 5);
    record(h, 6);
    expect(matchMotion(h, ['B', 'F'])).toBe(true);
    // Still in order: forward held, then back, is not back-forward.
    const g = newHistory();
    for (let i = 0; i < 30; i++) record(g, 6);
    record(g, 4);
    expect(matchMotion(g, ['B', 'F'])).toBe(false);
  });

  it('forgets a motion once it falls out of the window', () => {
    const h = newHistory();
    for (const d of [4, 5, 6] as const) record(h, d);
    for (let i = 0; i < 20; i++) record(h, 5);
    expect(matchMotion(h, ['B', 'F'])).toBe(false);
  });
});

describe('the round starts', () => {
  it('runs an intro that announces the round and the fight', () => {
    const m = createMatch(FIGHT_DEFAULTS, { a: 'ember', b: 'rime' });
    const ev: FightEvent[] = [];
    while (m.phase === 'intro') ev.push(...step(m, { held: 0, pressed: 0 }, { held: 0, pressed: 0 }));
    expect(ev).toContainEqual({ t: 'announce', what: 'round', round: 1 });
    expect(ev).toContainEqual({ t: 'announce', what: 'fight' });
    expect(m.phase).toBe('fighting');
  });

  it('ignores input during the intro', () => {
    const m = createMatch(FIGHT_DEFAULTS, { a: 'ember', b: 'rime' });
    const x = m.a.x;
    for (let i = 0; i < 30; i++) tick(m, RIGHT);
    expect(m.a.x).toBe(x);
  });

  it('walks forward and back at the fighter speeds, facing each other', () => {
    const m = fight();
    const x = m.a.x;
    run(m, 10, RIGHT);
    expect(m.a.x).toBeGreaterThan(x);
    const bx = m.b.x;
    run(m, 10, 0, RIGHT); // back, for the fighter on the right
    expect(m.b.x).toBeGreaterThan(bx);
    expect(m.a.facing).toBe(1);
    expect(m.b.facing).toBe(-1);
  });

  it('cannot walk through the opponent', () => {
    const m = fight();
    run(m, 200, RIGHT, LEFT);
    expect(m.b.x - m.a.x).toBeGreaterThanOrEqual(71.9);
  });

  it('jumps and lands', () => {
    const m = fight();
    tick(m, UP);
    run(m, 10);
    expect(m.a.y).toBeGreaterThan(50);
    run(m, 60);
    expect(m.a.y).toBe(0);
    expect(['idle', 'land']).toContain(m.a.state);
  });
});

describe('hitting and blocking', () => {
  it('lands a jab on a standing opponent', () => {
    const m = fight();
    place(m, 80);
    const ev = [...tick(m, 0, FP), ...run(m, 12)];
    expect(hits(ev)).toHaveLength(1);
    expect(m.b.health).toBe(MAX_HEALTH - 30);
  });

  it('whiffs a high over a crouching opponent', () => {
    const m = fight();
    place(m, 80);
    const ev = [...tick(m, 0, FP, DOWN), ...run(m, 12, 0, DOWN)];
    expect(hits(ev)).toHaveLength(0);
    expect(m.b.health).toBe(MAX_HEALTH);
  });

  it('needs a crouching block for a low', () => {
    const m = fight();
    place(m, 90);
    let ev = [...tick(m, DOWN, FK, BLOCK), ...run(m, 12, DOWN, BLOCK)];
    expect(hits(ev)).toHaveLength(1);

    const m2 = fight();
    place(m2, 90);
    ev = [...tick(m2, DOWN, FK, BLOCK | DOWN), ...run(m2, 12, DOWN, BLOCK | DOWN)];
    expect(hits(ev)).toHaveLength(0);
    expect(blocks(ev)).toHaveLength(1);
    expect(m2.b.health).toBe(MAX_HEALTH);
  });

  it('needs a standing block for an overhead', () => {
    const m = fight();
    place(m, 90);
    let ev = [...tick(m, RIGHT, BP, BLOCK | DOWN), ...run(m, 25, RIGHT, BLOCK | DOWN)];
    expect(hits(ev)).toHaveLength(1);

    const m2 = fight();
    place(m2, 90);
    ev = [...tick(m2, RIGHT, BP, BLOCK), ...run(m2, 25, RIGHT, BLOCK)];
    expect(blocks(ev)).toHaveLength(1);
    expect(m2.b.health).toBe(MAX_HEALTH);
  });

  it('takes chip damage only from blocked specials', () => {
    const m = fight('volt', 'rime');
    place(m, 300);
    // D, B + 1 is Volt's bolt.
    tick(m, DOWN);
    tick(m, DOWN | LEFT);
    const ev = [...tick(m, LEFT, FP, BLOCK), ...run(m, 40, 0, BLOCK)];
    expect(blocks(ev)).toHaveLength(1);
    expect(m.b.health).toBe(MAX_HEALTH - 10);
  });

  it('lets a throw beat a block', () => {
    const m = fight();
    place(m, 70);
    const ev = [...tick(m, 0, THROW, BLOCK), ...run(m, 60, 0, BLOCK)];
    expect(hits(ev)).toHaveLength(1);
    expect(m.b.health).toBe(MAX_HEALTH - 120);
  });

  it('reads 1 and 3 pressed a frame apart as a throw', () => {
    const m = fight();
    place(m, 70);
    tick(m, 0, FP);
    tick(m, FP, FK);
    run(m, 60);
    expect(m.b.health).toBe(MAX_HEALTH - 120);
  });

  it('breaks a throw when the victim presses throw in time', () => {
    const m = fight();
    place(m, 70);
    tick(m, 0, THROW);
    run(m, 8);
    expect(m.b.state).toBe('thrown');
    const ev = [...tick(m, 0, 0, 0, THROW), ...run(m, 60)];
    expect(has(ev, 'throwBreak')).toBe(true);
    expect(m.b.health).toBe(MAX_HEALTH);
  });

  it('cannot throw a crouching opponent', () => {
    const m = fight();
    place(m, 70);
    tick(m, 0, THROW, DOWN);
    run(m, 60, 0, DOWN);
    expect(m.b.health).toBe(MAX_HEALTH);
  });
});

describe('combos', () => {
  it("chains Ember's 1, 1, 2 string with scaling", () => {
    const m = fight();
    place(m, 80);
    const ev: FightEvent[] = [...tick(m, 0, FP), ...run(m, 9)];
    ev.push(...tick(m, 0, FP), ...run(m, 9));
    ev.push(...tick(m, 0, BP), ...run(m, 40));
    const h = hits(ev);
    expect(h).toHaveLength(3);
    expect(h.map((e) => e.t === 'hit' && e.dmg)).toEqual([30, Math.round(32 * 0.9), Math.round(60 * 0.81)]);
    expect(ev).toContainEqual({ t: 'combo', side: 'a', hits: 3, dmg: 30 + 29 + 49 });
  });

  it('floors damage scaling at 40%', () => {
    const m = fight();
    place(m, 80);
    m.b.state = 'hitstun';
    m.b.stun = 100;
    m.b.combo = 20;
    const ev = [...tick(m, 0, FP), ...run(m, 10)];
    expect(hits(ev)[0]).toMatchObject({ dmg: 12 });
  });

  it('launches with an uppercut and juggles after', () => {
    const m = fight();
    place(m, 70);
    tick(m, DOWN, BP);
    run(m, 10, DOWN);
    expect(m.b.state).toBe('juggle');
    expect(m.b.y).toBeGreaterThan(0);
  });
});

describe('specials', () => {
  it("fires Ember's spear with back, forward + 1 and hauls the opponent in", () => {
    const m = fight();
    place(m, 400);
    tick(m, LEFT);
    tick(m, LEFT);
    tick(m, 0);
    const ev = [...tick(m, RIGHT, FP), ...run(m, 30)];
    expect(ev).toContainEqual({ t: 'special', side: 'a', move: 'em_spear' });
    expect(hits(ev)).toHaveLength(1);
    expect(m.b.state).toBe('stunned');
    expect(m.b.x - m.a.x).toBeLessThan(120);
  });

  it('reads motions from the right-hand side mirrored', () => {
    // Rime on the right: down, then left is down-forward for them.
    const m = fight('volt', 'rime');
    place(m, 300);
    tick(m, 0, 0, DOWN);
    tick(m, 0, 0, DOWN | LEFT);
    const ev = [...tick(m, 0, 0, LEFT, FP), ...run(m, 40)];
    expect(ev).toContainEqual({ t: 'special', side: 'b', move: 'ri_ice' });
    expect(m.a.state).toBe('frozen');
  });

  it('teleports Ember behind the opponent', () => {
    const m = fight();
    place(m, 300);
    tick(m, DOWN);
    tick(m, DOWN | LEFT);
    tick(m, LEFT, FK);
    run(m, 12);
    expect(m.a.x).toBeGreaterThan(m.b.x);
    expect(m.a.facing).toBe(-1);
  });

  it('cancels opposing projectiles out', () => {
    const m = fight('volt', 'vex');
    place(m, 600);
    // Volt: D, B + 1. Vex (on the right, so forward is left): B, F + 1.
    tick(m, DOWN, 0, RIGHT);
    tick(m, DOWN | LEFT, 0, 0);
    const ev = [...tick(m, LEFT, FP, LEFT, FP), ...run(m, 60)];
    expect(has(ev, 'clash')).toBe(true);
    expect(m.a.health).toBe(MAX_HEALTH);
    expect(m.b.health).toBe(MAX_HEALTH);
  });

  it('amplifies a special with a block tap and a bar of meter', () => {
    const m = fight('volt', 'rime');
    place(m, 400);
    m.a.meter = 1000;
    tick(m, DOWN);
    tick(m, DOWN | LEFT);
    tick(m, LEFT, FP);
    const ev = [...tick(m, 0, BLOCK), ...run(m, 40)];
    expect(has(ev, 'amplify')).toBe(true);
    expect(hits(ev)[0]).toMatchObject({ dmg: Math.round(100 * 1.35) });
  });

  it('Breaks away from blockstun for the full meter', () => {
    const m = fight();
    place(m, 80);
    m.b.meter = METER_MAX;
    tick(m, 0, BK, BLOCK);
    run(m, 13, 0, BLOCK);
    expect(m.b.state).toBe('blockstun');
    // Pressed during hitstop is fine: it goes off on the next live frame.
    const ev = [...tick(m, 0, 0, BLOCK | LEFT), ...run(m, 3, 0, BLOCK | LEFT)];
    expect(has(ev, 'breaker')).toBe(true);
    expect(m.b.meter).toBeLessThan(10);
    expect(m.a.state).toBe('juggle');
  });
});

describe('Fatal Blow', () => {
  it('is locked above 30% health', () => {
    const m = fight();
    place(m, 90);
    tick(m, 0, FATAL);
    expect(m.a.state).not.toBe('attack');
  });

  it('plays out a cinematic for 300 damage and is spent', () => {
    const m = fight();
    place(m, 100);
    m.a.health = 250;
    expect(toFrame(m).a.fb).toBe(1);
    const ev = [...tick(m, 0, FATAL), ...run(m, 20)];
    expect(ev).toContainEqual({ t: 'fatalBlow', side: 'a', landed: true });
    expect(m.cinematic).not.toBeNull();
    run(m, CINEMATIC_FRAMES);
    expect(m.b.health).toBe(MAX_HEALTH - 3 * FATAL_BEAT_DAMAGE);
    expect(m.a.fatalUsed).toBe(true);
    expect(toFrame(m).a.fb).toBe(0);
  });

  it('goes on cooldown after a whiff and comes back', () => {
    const m = fight();
    place(m, 700);
    m.a.health = 250;
    const ev = [...tick(m, 0, FATAL), ...run(m, 60)];
    expect(ev).toContainEqual({ t: 'fatalBlow', side: 'a', landed: false });
    expect(m.a.fatalCooldown).toBeGreaterThan(0);
    tick(m, 0, FATAL);
    expect(m.a.state).not.toBe('attack');
    run(m, FATAL_COOLDOWN);
    expect(toFrame(m).a.fb).toBe(1);
  });
});

describe('Krushing Blows', () => {
  it('lands on a counter hit, once per match', () => {
    const m = fight();
    place(m, 80);
    // b winds up a back kick; a's uppercut is faster and catches the startup.
    const ev = [...tick(m, DOWN, BP, 0, BK), ...run(m, 20, DOWN)];
    expect(ev).toContainEqual({ t: 'krush', side: 'a', move: 'uppercut' });
    expect(hits(ev)[0]).toMatchObject({ dmg: Math.round(110 * 1.5) });

    run(m, 120);
    place(m, 80);
    const again = [...tick(m, DOWN, BP, 0, BK), ...run(m, 20, DOWN)];
    expect(has(again, 'krush')).toBe(false);
  });
});

describe('rounds', () => {
  it('ends the round on a KO and calls a flawless', () => {
    const m = fight();
    place(m, 80);
    m.b.health = 10;
    const ev = [...tick(m, 0, FP), ...run(m, 70)];
    expect(ev).toContainEqual({ t: 'announce', what: 'ko', side: 'a' });
    expect(ev).toContainEqual({ t: 'announce', what: 'flawless', side: 'a' });
    expect(m.wins).toEqual({ a: 1, b: 0 });
    run(m, ROUND_END_FRAMES);
    expect(m.phase).toBe('intro');
    expect(m.round).toBe(2);
    expect(m.b.health).toBe(MAX_HEALTH);
  });

  it('gives a timed-out round to whoever has more health', () => {
    const m = fight();
    m.timer = 2;
    m.a.health = 900;
    m.b.health = 800;
    const ev = run(m, 3);
    expect(ev).toContainEqual({ t: 'announce', what: 'time' });
    expect(m.wins).toEqual({ a: 1, b: 0 });
  });

  it('awards a drawn round to nobody', () => {
    const m = fight();
    m.timer = 2;
    const ev = run(m, 3);
    expect(ev).toContainEqual({ t: 'announce', what: 'draw' });
    expect(m.wins).toEqual({ a: 0, b: 0 });
  });

  it('stops after five rounds and goes by round wins', () => {
    const m = fight();
    m.round = 5;
    m.wins = { a: 1, b: 1 };
    m.timer = 2;
    run(m, 3 + ROUND_END_FRAMES);
    expect(m.phase).toBe('matchOver');
    expect(m.winner).toBeNull();
    expect(m.reason).toBe('rounds');
    run(m, 400);
    expect(m.phase).toBe('done');
  });
});

describe('finish him', () => {
  function matchPoint(gap: number): Match {
    const m = fight();
    place(m, 80);
    m.wins.a = 1;
    m.b.health = 10;
    tick(m, 0, FP);
    run(m, 30);
    expect(m.phase).toBe('finishHim');
    expect(m.b.state).toBe('dizzy');
    place(m, gap);
    return m;
  }

  it("performs Ember's fatality from mid range", () => {
    const m = matchPoint(250);
    tick(m, RIGHT);
    tick(m, 0);
    tick(m, LEFT);
    tick(m, 0);
    const ev = [...tick(m, RIGHT, FK), ...run(m, 400)];
    expect(ev).toContainEqual({ t: 'fatality', side: 'a' });
    expect(ev).toContainEqual({ t: 'announce', what: 'fatality', side: 'a' });
    expect(m.reason).toBe('fatality');
    expect(m.winner).toBe('a');
    expect(m.phase).toBe('matchOver');
  });

  it('refuses the fatality from the wrong range', () => {
    const m = matchPoint(90);
    tick(m, RIGHT);
    tick(m, LEFT);
    const ev = [...tick(m, RIGHT, FK), ...run(m, 40)];
    expect(has(ev, 'fatality')).toBe(false);
    // The kick itself connects and finishes it plainly.
    expect(m.phase).toBe('matchOver');
    expect(m.reason).toBe('ko');
  });

  it('lets the dizzy opponent fall if nobody finishes them', () => {
    const m = matchPoint(400);
    run(m, FINISH_FRAMES);
    expect(m.phase).toBe('matchOver');
    expect(m.b.state).toBe('ko');
  });
});

describe('frames', () => {
  it('snapshots both fighters compactly', () => {
    const m = fight();
    const f = toFrame(m);
    expect(f.p).toBe('fighting');
    expect(f.a.h).toBe(MAX_HEALTH);
    expect(f.b.f).toBe(-1);
    expect(JSON.stringify(f).length).toBeLessThan(400);
  });

  it('keeps the unused buttons out of the way', () => {
    // BK held alone from neutral is a back kick, not a sweep.
    const m = fight();
    place(m, 100);
    tick(m, 0, BK);
    expect(m.a.move).toBe('bkick');
    void UP;
  });
});
