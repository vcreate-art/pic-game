import { describe, expect, it } from 'vitest';
import {
  LEVELS, LevelBuilder, PHYS, RB, RH, TILE, atFinish, chaserDoneAt, chaserX, checkpointAt,
  crumbleState, dashReady, hazardAt, laserPhase, newRunner, newWorld, pointsFor, sawAt, shotsAt,
  solidAt, stepRunner, type Level, type Runner, type World,
} from '../index.js';

const { LEFT, RIGHT, UP, JUMP, DASH } = RB;

/** A flat test room: floor at row 10, walls at the edges. */
function room(extra?: (b: LevelBuilder) => void): Level {
  const b = new LevelBuilder(40, 14).floor(0, 40, 10).spawn(5, 9).finish(35, 9);
  extra?.(b);
  return b.build('test', 'Test');
}

function setup(lv = room()): { r: Runner; w: World } {
  const w = newWorld(lv);
  const r = newRunner(lv);
  for (let i = 0; i < 5; i++) stepRunner(r, 0, 0, w);
  return { r, w };
}

function run(r: Runner, w: World, n: number, held = 0): void {
  for (let i = 0; i < n; i++) stepRunner(r, held, 0, w);
}

/** Presses on the first frame, then holds for `n` frames. */
function press(r: Runner, w: World, held: number, pressed: number, n = 1): void {
  stepRunner(r, held | pressed, pressed, w);
  run(r, w, n - 1, held);
}

const floorY = 10 * TILE - RH;

describe('running', () => {
  it('stands on the floor', () => {
    const { r } = setup();
    expect(r.ground).toBe(true);
    expect(r.y).toBe(floorY);
  });

  it('is at full speed at once and stops dead, with no slide', () => {
    const { r, w } = setup();
    run(r, w, 1, RIGHT);
    expect(r.vx).toBe(PHYS.RUN);
    run(r, w, 1);
    expect(r.vx).toBe(0);
  });

  it('stops at a wall', () => {
    const { r, w } = setup(room((b) => b.solid(10, 8, 1, 2)));
    run(r, w, 60, RIGHT);
    expect(r.x + 20).toBeLessThanOrEqual(10 * TILE);
    expect(r.vx).toBe(0);
  });
});

describe('jumping', () => {
  function apex(r: Runner, w: World, jumpHeld: boolean): number {
    let top = r.y;
    press(r, w, jumpHeld ? JUMP : 0, JUMP);
    for (let i = 0; i < 60; i++) {
      stepRunner(r, jumpHeld ? JUMP : 0, 0, w);
      top = Math.min(top, r.y);
    }
    return floorY - top;
  }

  it('clears about three tiles, and less for a tap', () => {
    const full = apex(...Object.values(setup()) as [Runner, World], true);
    const tap = apex(...Object.values(setup()) as [Runner, World], false);
    expect(full).toBeGreaterThan(3 * TILE - 10);
    expect(full).toBeLessThan(4 * TILE);
    expect(tap).toBeLessThan(full / 2);
  });

  it('double jumps once in the air, and not again until landing', () => {
    const { r, w } = setup();
    press(r, w, JUMP, JUMP, 20);
    stepRunner(r, JUMP, 0, w);
    const before = r.vy;
    press(r, w, JUMP, JUMP);
    expect(r.vy).toBeLessThan(before);
    expect(r.airJumps).toBe(0);
    run(r, w, 10);
    press(r, w, 0, JUMP);
    expect(r.vy).toBeGreaterThan(0);
    expect(r.airJumps).toBe(0);
  });

  it('still jumps just after running off a ledge', () => {
    const lv = room((b) => b.clear(8, 10, 10, 4));
    const { r, w } = setup(lv);
    let frames = 0;
    while (r.ground && frames++ < 200) stepRunner(r, RIGHT, 0, w);
    run(r, w, 3, RIGHT);
    press(r, w, JUMP | RIGHT, JUMP);
    expect(r.vy).toBeLessThan(-5);
  });

  it('remembers a jump pressed just before landing', () => {
    const { r, w } = setup();
    press(r, w, JUMP, JUMP);
    while (r.vy < 0) stepRunner(r, JUMP, 0, w);
    // Falling now, a few frames above the floor.
    while (r.y < floorY - 20) stepRunner(r, 0, 0, w);
    r.airJumps = 0;
    // Pressed and let go: with the double jump spent, holding would glide.
    press(r, w, 0, JUMP);
    run(r, w, 6);
    expect(r.y).toBeLessThan(floorY - 10);
  });

  it('glides: once the double jump is spent, holding jump floats down', () => {
    const { r, w } = setup();
    press(r, w, JUMP, JUMP, 12);
    press(r, w, JUMP, JUMP, 30);
    expect(r.gliding).toBe(true);
    expect(r.vy).toBeLessThanOrEqual(PHYS.GLIDE_FALL);
  });

  it('does not glide off a held first jump: that press is saved for the double', () => {
    const { r, w } = setup();
    press(r, w, JUMP, JUMP, 30);
    expect(r.gliding).toBe(false);
    expect(r.airJumps).toBe(1);
  });
});

describe('walls', () => {
  /** A tall wall at column 12, and the runner falling beside it. */
  function againstWall(): { r: Runner; w: World } {
    const lv = room((b) => b.solid(12, 0, 1, 10));
    const { r, w } = setup(lv);
    r.x = 12 * TILE - 20;
    r.y = 2 * TILE;
    r.ground = false;
    return { r, w };
  }

  it('slides slowly down a wall pushed into', () => {
    const { r, w } = againstWall();
    run(r, w, 30, RIGHT);
    expect(r.wall).toBe(1);
    expect(r.vy).toBeLessThanOrEqual(PHYS.WALL_SLIDE);
  });

  it('wall-jumps up and away', () => {
    const { r, w } = againstWall();
    run(r, w, 5, RIGHT);
    press(r, w, RIGHT | JUMP, JUMP);
    expect(r.vx).toBeLessThan(0);
    expect(r.vy).toBeLessThan(-8);
    expect(r.airJumps).toBe(1);
  });

  it('climbs while up is held, until the grip runs out', () => {
    const { r, w } = againstWall();
    const y = r.y + 200;
    r.y = y;
    run(r, w, 20, RIGHT | UP);
    expect(r.y).toBeLessThan(y - 30);
    run(r, w, PHYS.STAMINA, RIGHT | UP);
    expect(r.stamina).toBe(0);
    expect(r.climbing).toBe(false);
  });

  it('mantles over the top of a wall', () => {
    const lv = room((b) => b.floor(12, 10, 6));
    const { r, w } = setup(lv);
    r.x = 12 * TILE - 20;
    press(r, w, RIGHT | UP, JUMP);
    run(r, w, 70, RIGHT | UP);
    expect(r.x).toBeGreaterThan(12 * TILE);
    expect(r.y).toBeLessThan(6 * TILE - RH + 0.5);
  });
});

describe('crumbling blocks', () => {
  it('gives way after being stood on, then comes back', () => {
    const lv = room((b) => b.clear(0, 10, 40, 4).crumble(3, 10, 6));
    const { r, w } = setup(lv);
    const idx = 10 * lv.w + 5;
    expect(solidAt(w, 5, 10)).toBe(true);
    run(r, w, PHYS.CRUMBLE_DELAY);
    expect(crumbleState(w, idx)).toBeNull();
    expect(r.ground).toBe(false);
    run(r, w, PHYS.CRUMBLE_GONE);
    expect(solidAt(w, 5, 10)).toBe(true);
  });
});

describe('hazards', () => {
  it('swings a saw smoothly between its ends', () => {
    const lv = room((b) => b.saw(10, 5, { to: [20, 5], period: 2000 }));
    const s = lv.saws[0]!;
    expect(sawAt(s, 0).x).toBeCloseTo(10 * TILE);
    expect(sawAt(s, 1000).x).toBeCloseTo(20 * TILE);
    expect(sawAt(s, 2000).x).toBeCloseTo(10 * TILE);
  });

  it('cycles a laser through on, off and a warning', () => {
    const lv = room((b) => b.laser(10, 0, 'down', { on: 1000, off: 1400 }));
    const l = lv.lasers[0]!;
    expect(laserPhase(l, 0)).toBe('on');
    expect(laserPhase(l, 1200)).toBe('off');
    expect(laserPhase(l, 2200)).toBe('warn');
    expect(l.len).toBe(9 * TILE);
  });

  it('fires cannon shots that fly until they hit a wall', () => {
    const lv = room((b) => b.cannon(20, 9, -1, { period: 1000, speed: 0.5 }).solid(10, 9));
    const c = lv.cannons[0]!;
    expect(shotsAt(c, 0)).toHaveLength(1);
    expect(shotsAt(c, 100)[0]!.x).toBeCloseTo(c.x - 50);
    expect(c.range).toBeGreaterThan(8 * TILE);
    expect(c.range).toBeLessThan(10 * TILE);
    expect(shotsAt(c, 950)).toHaveLength(0);
  });

  it('kills on spikes, saws and falling out of the level', () => {
    const lv = room((b) => b.spikes(8, 9, 2).saw(20, 9.5, { r: 0.8 }));
    expect(hazardAt(lv, 5 * TILE, floorY, 0)).toBeNull();
    expect(hazardAt(lv, 8 * TILE + 6, floorY, 0)).toBe('spikes');
    expect(hazardAt(lv, 20 * TILE - 10, floorY, 0)).toBe('saw');
    expect(hazardAt(lv, 5 * TILE, lv.h * TILE + 5, 0)).toBe('pit');
  });

  it('holds the chaser back, then sends it past the finish', () => {
    const lv = room();
    expect(chaserX(lv, 'off', 1e6)).toBe(-Infinity);
    expect(chaserX(lv, 'normal', 0)).toBeLessThan(0);
    const done = chaserDoneAt(lv, 'normal');
    expect(chaserX(lv, 'normal', done)).toBeGreaterThanOrEqual(lv.finish.x + lv.finish.w);
    expect(chaserDoneAt(lv, 'fast')).toBeLessThan(done);
  });
});

describe('scoring', () => {
  it('pays out by place, one point past the table, nothing for a DNF', () => {
    expect(pointsFor(1)).toBe(10);
    expect(pointsFor(2)).toBe(8);
    expect(pointsFor(9)).toBe(1);
    expect(pointsFor(null)).toBe(0);
  });
});

describe('the levels', () => {
  for (const lv of LEVELS) {
    describe(lv.name, () => {
      it('starts a runner on solid ground, out of harm', () => {
        const w = newWorld(lv);
        const r = newRunner(lv);
        run(r, w, 30);
        expect(r.ground).toBe(true);
        expect(r.y).toBeCloseTo(lv.spawn.y);
        for (let t = 0; t < 6000; t += 250) expect(hazardAt(lv, r.x, r.y, t)).toBeNull();
      });

      it('has safe checkpoints, in order, before the finish', () => {
        lv.checkpoints.forEach((c, i) => {
          const w = newWorld(lv);
          const r = newRunner(lv, c);
          run(r, w, 30);
          expect(r.ground, `checkpoint ${i} has ground`).toBe(true);
          expect(hazardAt(lv, r.x, r.y, 0), `checkpoint ${i} is safe`).toBeNull();
          expect(checkpointAt(lv, r.x, r.y)).toBe(i);
          expect(c.x).toBeLessThan(lv.finish.x);
        });
      });

      it('has a reachable finish zone on the ground', () => {
        const f = lv.finish;
        const w = newWorld(lv);
        const r = newRunner(lv, { x: f.x + 6, y: f.y + 2 * TILE });
        run(r, w, 60);
        expect(r.ground).toBe(true);
        expect(atFinish(lv, r.x, r.y)).toBe(true);
      });
    });
  }
});

describe('the climbs', () => {
  // Level, a column inside its shaft, the floor row, and the row of the top.
  const SHAFTS = [[0, 71, 12, 4], [1, 60, 18, 6]] as const;

  for (const [li, col, floor, top] of SHAFTS) {
    it(`can be climbed in ${LEVELS[li]!.name}`, () => {
      const lv = LEVELS[li]!;
      const w = newWorld(lv);
      const r = newRunner(lv, { x: col * TILE + 6, y: floor * TILE - RH });
      run(r, w, 10);
      // Climb one wall until the grip goes, jump off toward the other, repeat.
      let side: 1 | -1 = 1;
      press(r, w, JUMP, JUMP);
      for (let i = 0; i < 900 && !(r.ground && r.y < top * TILE); i++) {
        const toward = side === 1 ? RIGHT : LEFT;
        if (r.wall !== 0 && r.stamina === 0) {
          press(r, w, toward | JUMP, JUMP);
          side = side === 1 ? -1 : 1;
        } else {
          stepRunner(r, toward | UP | JUMP, 0, w);
        }
      }
      expect(r.ground).toBe(true);
      expect(r.y).toBeLessThan(top * TILE);
    });
  }
});

describe('dash and sprint', () => {
  it('dashes a fixed distance with gravity suspended', () => {
    const { r, w } = setup();
    const x = r.x;
    press(r, w, 0, DASH, PHYS.DASH_FRAMES);
    expect(r.x - x).toBeCloseTo(PHYS.DASH_SPEED * PHYS.DASH_FRAMES);
    expect(r.y).toBe(floorY);
  });

  it('dashes in the air once, flat, and not again until landing', () => {
    const { r, w } = setup();
    press(r, w, JUMP, JUMP, 20);
    const y = r.y;
    press(r, w, 0, DASH, 5);
    expect(r.y).toBe(y);
    expect(r.airDash).toBe(false);
    run(r, w, 5);
    // Even with the cooldown skipped, a second air dash does not go off.
    r.dashCd = 0;
    const x = r.x;
    press(r, w, 0, DASH);
    expect(r.dash).toBe(0);
    expect(r.x).toBe(x);
    run(r, w, 60);
    expect(r.ground).toBe(true);
    expect(dashReady(r)).toBe(true);
  });

  it('has a cooldown between dashes', () => {
    const { r, w } = setup();
    press(r, w, 0, DASH, PHYS.DASH_FRAMES + 2);
    const x = r.x;
    press(r, w, 0, DASH, 3);
    expect(r.x).toBe(x);
  });

  it('breaks into a sprint when dash is held through a ground dash', () => {
    const { r, w } = setup();
    press(r, w, RIGHT | DASH, DASH, PHYS.DASH_FRAMES + 5);
    expect(r.sprint).toBe(true);
    expect(r.vx).toBe(PHYS.SPRINT);
    run(r, w, 1, RIGHT);
    expect(r.sprint).toBe(false);
    expect(r.vx).toBe(PHYS.RUN);
  });

  it('keeps sprint speed through a jump', () => {
    const { r, w } = setup();
    press(r, w, RIGHT | DASH, DASH, PHYS.DASH_FRAMES + 5);
    press(r, w, RIGHT | DASH | JUMP, JUMP, 10);
    expect(r.ground).toBe(false);
    expect(r.vx).toBe(PHYS.SPRINT);
  });
});

describe('Hollow Knight walls', () => {
  it('clings to a wall and slides at a steady speed', () => {
    const lv = room((b) => b.solid(12, 0, 1, 10));
    const { r, w } = setup(lv);
    r.x = 12 * TILE - 20;
    r.y = 2 * TILE;
    run(r, w, 40, RIGHT);
    expect(r.wall).toBe(1);
    expect(r.vy).toBe(PHYS.WALL_SLIDE);
  });

  it('refreshes the double jump and dash on a wall', () => {
    const lv = room((b) => b.solid(12, 0, 1, 10));
    const { r, w } = setup(lv);
    r.x = 12 * TILE - 20;
    r.y = 2 * TILE;
    r.airJumps = 0;
    r.airDash = false;
    run(r, w, 2, RIGHT);
    expect(r.airJumps).toBe(1);
    expect(r.airDash).toBe(true);
  });

  it('climbs a single wall by jumping off it and steering back', () => {
    // One tall wall, nothing to bounce off on the other side.
    const lv = room((b) => b.solid(12, 0, 1, 10));
    const { r, w } = setup(lv);
    r.x = 12 * TILE - 20;
    press(r, w, RIGHT | JUMP, JUMP, 6);
    const start = r.y;
    for (let i = 0; i < 6; i++) {
      run(r, w, 10, RIGHT);
      press(r, w, RIGHT | JUMP, JUMP, 8);
    }
    expect(r.y).toBeLessThan(start - 4 * TILE);
  });
});
