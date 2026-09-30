import { describe, expect, it } from 'vitest';
import {
  BULLET_DAMAGE, CELL, MAX_HP, MAZE_TILE, MV, PF, PLAYER_R, PROTECT_TICKS, RESPAWN_TICKS, cellCentre,
  createWorld, generateMaze, mazeSize, mazeSolidAt, moveBody, seededRng, setAway, stepWorld, toAim,
  toMazeFrame, walk, wallAt,
  type MazeInput, type MazeMap, type MazeWorld,
} from '../index.js';

/** Every open tile reachable from the first cell, by flood fill. */
function reachable(m: MazeMap): number {
  const start = { x: 2, y: 2 };
  const seen = new Uint8Array(m.w * m.h);
  const todo = [start];
  seen[start.y * m.w + start.x] = 1;
  let n = 0;
  while (todo.length) {
    const { x, y } = todo.pop()!;
    n++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (wallAt(m, nx, ny) || seen[ny * m.w + nx]) continue;
      seen[ny * m.w + nx] = 1;
      todo.push({ x: nx, y: ny });
    }
  }
  return n;
}

describe('the maze', () => {
  it('is the same from the same seed, and different from another', () => {
    const a = generateMaze(42, 14, 10);
    const b = generateMaze(42, 14, 10);
    const c = generateMaze(43, 14, 10);
    expect(Buffer.from(a.walls).equals(Buffer.from(b.walls))).toBe(true);
    expect(Buffer.from(a.walls).equals(Buffer.from(c.walls))).toBe(false);
  });

  it('is walled all round, and every open space joins up', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = generateMaze(seed, 16, 11);
      for (let x = 0; x < m.w; x++) expect(wallAt(m, x, 0) && wallAt(m, x, m.h - 1)).toBe(true);
      for (let y = 0; y < m.h; y++) expect(wallAt(m, 0, y) && wallAt(m, m.w - 1, y)).toBe(true);
      const open = m.walls.reduce((n, v) => n + (v ? 0 : 1), 0);
      expect(reachable(m)).toBe(open);
    }
  });

  it('has few dead ends: most were knocked through', () => {
    const m = generateMaze(7, 20, 14);
    let dead = 0;
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        const [x, y] = cellCentre(c, r).map((v) => Math.floor(v / MAZE_TILE));
        const ways = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dy]) => !wallAt(m, x! + dx!, y! + dy!)).length;
        if (ways === 1) dead++;
      }
    }
    expect(dead / (m.cols * m.rows)).toBeLessThan(0.08);
  });

  it('grows with the players', () => {
    expect(mazeSize(2).cols).toBeLessThan(mazeSize(10).cols);
    expect(mazeSize(10)).toEqual({ cols: 20, rows: 14 });
  });

  it('cell centres are open floor', () => {
    const m = generateMaze(3, 12, 8);
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
      const [x, y] = cellCentre(c, r);
      expect(mazeSolidAt(m, x, y)).toBe(false);
    }
  });
});

describe('moving', () => {
  const m = generateMaze(5, 12, 8);

  it('stops at walls, and never ends up inside one', () => {
    const rng = seededRng(9);
    for (let trial = 0; trial < 50; trial++) {
      const [x, y] = cellCentre(Math.floor(rng() * m.cols), Math.floor(rng() * m.rows));
      const p = { x, y };
      for (let i = 0; i < 200; i++) {
        moveBody(m, p, (rng() - 0.5) * 40, (rng() - 0.5) * 40);
        for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          expect(mazeSolidAt(m, p.x + dx * (PLAYER_R - 0.5), p.y + dy * (PLAYER_R - 0.5))).toBe(false);
        }
      }
    }
  });

  it('walking into the outer wall stops flush against it', () => {
    const [x, y] = cellCentre(0, 0);
    const p = { x, y };
    for (let i = 0; i < 60; i++) walk(m, p, MV.LEFT);
    expect(p.x).toBeCloseTo(MAZE_TILE + PLAYER_R, 0);
    expect(p.y).toBe(y);
  });

  it('diagonals are no faster than straight lines', () => {
    const [x, y] = cellCentre(3, 3);
    const a = { x, y };
    const b = { x, y };
    walk(m, a, MV.RIGHT);
    walk(m, b, MV.RIGHT | MV.DOWN);
    expect(Math.hypot(b.x - x, b.y - y)).toBeCloseTo(a.x - x, 5);
  });
});

// ------------------------------------------------------------------ fights

/** An open test arena: one big room, so shots are not stopped by walls. */
function arena(): MazeMap {
  const cols = 6;
  const rows = 4;
  const w = cols * CELL + 1;
  const h = rows * CELL + 1;
  const walls = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) walls[x] = walls[(h - 1) * w + x] = 1;
  for (let y = 0; y < h; y++) walls[y * w] = walls[y * w + w - 1] = 1;
  return { cols, rows, w, h, walls };
}

/** Two players facing each other across the room, spawn protection over. */
function duel(): MazeWorld {
  const w = createWorld(arena(), ['A', 'B'], seededRng(1));
  const [a, b] = w.fighters;
  a!.x = 100; a!.y = 150;
  b!.x = 500; b!.y = 150;
  w.tick = PROTECT_TICKS + 1;
  a!.safeUntil = b!.safeUntil = 0;
  return w;
}

const input = (seq: number, over: Partial<MazeInput> = {}): MazeInput => ({ seq, keys: 0, aim: 0, fire: false, ...over });

describe('shooting', () => {
  it('a bullet flies until it hits someone, who loses health', () => {
    const w = duel();
    stepWorld(w, [input(1, { fire: true, aim: toAim(0) }), null]);
    expect(w.bullets).toHaveLength(1);
    let events: ReturnType<typeof stepWorld> = [];
    for (let i = 0; i < 30 && !events.length; i++) events = stepWorld(w, [null, null]);
    expect(events).toEqual([{ k: 'hit', v: 1, by: 0, x: 500, y: 150 }]);
    expect(w.fighters[1]!.hp).toBe(MAX_HP - BULLET_DAMAGE);
    expect(w.bullets).toHaveLength(0);
  });

  it('holding fire shoots six times a second, not every tick', () => {
    const w = duel();
    for (let i = 0; i < 30; i++) stepWorld(w, [input(i, { fire: true, aim: toAim(Math.PI / 2) }), null]);
    const shots = w.nextBullet - 1;
    expect(shots).toBe(6);
  });

  it('walls stop bullets', () => {
    const w = duel();
    // Straight up into the top wall.
    stepWorld(w, [input(1, { fire: true, aim: toAim(-Math.PI / 2) }), null]);
    for (let i = 0; i < 20; i++) stepWorld(w, [null, null]);
    expect(w.bullets).toHaveLength(0);
    expect(w.fighters[1]!.hp).toBe(MAX_HP);
  });

  it('five hits kill, the killer scores, and the dead come back later somewhere else', () => {
    const w = duel();
    const events = [];
    for (let i = 0; i < 80 && w.fighters[1]!.alive; i++) {
      events.push(...stepWorld(w, [input(i, { fire: true, aim: toAim(0) }), null]));
    }
    const b = w.fighters[1]!;
    expect(b.alive).toBe(false);
    expect(events.filter((e) => e.k === 'hit')).toHaveLength(MAX_HP / BULLET_DAMAGE);
    expect(events.at(-1)).toEqual({ k: 'kill', v: 1, by: 0 });
    expect(w.fighters[0]!.kills).toBe(1);
    expect(b.deaths).toBe(1);
    let back: ReturnType<typeof stepWorld> = [];
    for (let i = 0; i < RESPAWN_TICKS && !back.length; i++) back = stepWorld(w, [null, null]);
    expect(back[0]).toMatchObject({ k: 'spawn', s: 1 });
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(MAX_HP);
  });

  it('a fresh spawn cannot be hurt, until it fires', () => {
    const w = duel();
    w.fighters[1]!.safeUntil = w.tick + 100;
    stepWorld(w, [input(1, { fire: true, aim: toAim(0) }), null]);
    for (let i = 0; i < 25; i++) stepWorld(w, [null, null]);
    expect(w.fighters[1]!.hp).toBe(MAX_HP);
    stepWorld(w, [null, input(1, { fire: true, aim: toAim(Math.PI / 2) })]);
    expect(toMazeFrame(w, [0, 0]).p[1]![4] & PF.SAFE).toBe(0);
  });

  it('health comes back after a while unhurt', () => {
    const w = duel();
    w.fighters[1]!.hp = 40;
    w.fighters[1]!.lastHurt = w.tick;
    for (let i = 0; i < 5 * 30; i++) stepWorld(w, [null, null]);
    expect(w.fighters[1]!.hp).toBeGreaterThan(40);
    for (let i = 0; i < 10 * 30; i++) stepWorld(w, [null, null]);
    expect(w.fighters[1]!.hp).toBe(MAX_HP);
  });
});

describe('spawning', () => {
  it('spreads players out across a real maze', () => {
    const m = generateMaze(11, ...Object.values(mazeSize(10)) as [number, number]);
    const w = createWorld(m, 'ABCDEFGHIJ'.split(''), seededRng(4));
    let nearest = Infinity;
    for (const a of w.fighters) for (const b of w.fighters) {
      if (a !== b) nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.y - b.y));
    }
    expect(nearest).toBeGreaterThan(CELL * MAZE_TILE * 2);
  });

  it('a player who is away is left out, and placed afresh on return', () => {
    const w = duel();
    setAway(w, 1, true);
    stepWorld(w, [input(1, { fire: true, aim: toAim(0) }), null]);
    for (let i = 0; i < 25; i++) stepWorld(w, [null, null]);
    expect(w.fighters[1]!.hp).toBe(MAX_HP);
    expect(toMazeFrame(w, [0, 0]).p[1]![4] & PF.AWAY).toBe(PF.AWAY);
    setAway(w, 1, false);
    expect(w.fighters[1]!.away).toBe(false);
    expect(w.tick < w.fighters[1]!.safeUntil).toBe(true);
  });
});
