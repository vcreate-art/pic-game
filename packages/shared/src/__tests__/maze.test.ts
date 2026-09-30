import { describe, expect, it } from 'vitest';
import {
  BULLET_DAMAGE, CELL, MAX_HP, MAX_ITEMS, MAZE_TILE, MISSILE, MV, PF, PLAYER_R, PLAYER_SPEED, POWER_AMOUNT, PROTECT_TICKS,
  RESPAWN_TICKS, RUN, SPEED_BOOST, SPREAD, cellCentre, createWorld, freshItem, generateMaze, mazeSize, mazeSolidAt,
  packItems, unpackItems,
  moveBody, pickupCap, powerCode, seededRng, setAway, shufflePowers, speedFor, stepWorld, toAim, toMazeFrame,
  walk, wallAt, TILE_KIND, mazeTileAt,
  type MazeEvent, type MazeInput, type MazeMap, type MazeWorld,
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

describe('rooms and cover', () => {
  it('has an arena in the middle and rooms besides', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const m = generateMaze(seed, 20, 14);
      const arena = m.rooms!.filter((r) => r.arena);
      expect(arena).toHaveLength(1);
      const a = arena[0]!;
      // Roughly central.
      expect(Math.abs(a.x + a.w / 2 - m.w / 2)).toBeLessThan(CELL * 2);
      expect(Math.abs(a.y + a.h / 2 - m.h / 2)).toBeLessThan(CELL * 2);
      expect(m.rooms!.filter((r) => !r.arena).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('puts cover in the open areas, never on a cell middle', () => {
    let cover = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const m = generateMaze(seed, 20, 14);
      for (let i = 0; i < m.walls.length; i++) {
        if (m.walls[i] !== TILE_KIND.COVER) continue;
        cover++;
        const x = i % m.w;
        const y = Math.floor(i / m.w);
        // Cell floors are tiles 1-3 of each 4; cover stands on the lines between.
        expect(x % CELL === 0 || y % CELL === 0).toBe(true);
      }
      for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
        const [x, y] = cellCentre(c, r);
        expect(mazeTileAt(m, Math.floor(x / MAZE_TILE), Math.floor(y / MAZE_TILE))).toBe(TILE_KIND.FLOOR);
      }
    }
    expect(cover).toBeGreaterThan(50);
  });

  it('cover stops bullets and players like a wall', () => {
    const m = generateMaze(4, 20, 14);
    const i = m.walls.indexOf(TILE_KIND.COVER);
    const x = i % m.w;
    const y = Math.floor(i / m.w);
    expect(wallAt(m, x, y)).toBe(true);
    expect(mazeSolidAt(m, (x + 0.5) * MAZE_TILE, (y + 0.5) * MAZE_TILE)).toBe(true);
  });

  it('is joined up across many seeds and sizes, cover and all', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { cols, rows } = mazeSize(2 + (seed % 9));
      const m = generateMaze(seed * 7, cols, rows);
      const open = m.walls.reduce((n, v) => n + (v ? 0 : 1), 0);
      expect(reachable(m)).toBe(open);
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

const input = (seq: number, over: Partial<MazeInput> = {}): MazeInput => ({ seq, keys: 0, aim: 0, fire: false, alt: false, run: false, ...over });

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

// ---------------------------------------------------------------- power-ups

/** The duel, with power-ups on. */
function powered(): MazeWorld {
  const w = duel();
  w.powerups = true;
  w.pickupAt = Infinity; // no pickups appearing on their own
  w.shuffleAt = Infinity;
  return w;
}

/** Fires once from A at B, with the gun or the secondary, and lets it land. */
function shootAtB(w: MazeWorld, seq = 1, alt = false): MazeEvent[] {
  const events = stepWorld(w, [input(seq, { fire: !alt, alt, aim: toAim(0) }), null]);
  for (let i = 0; i < 40; i++) events.push(...stepWorld(w, [null, null]));
  return events;
}

describe('the gun and the secondary', () => {
  it('the gun always fires plain bullets, whatever is on the stack', () => {
    const w = powered();
    const [a, b] = w.fighters;
    a!.items = [freshItem('missile')];
    shootAtB(w);
    expect(b!.hp).toBe(MAX_HP - BULLET_DAMAGE);
    expect(a!.items[0]!.left).toBe(POWER_AMOUNT.missile);
  });

  it('the secondary uses the top of the stack, the last picked up', () => {
    const w = powered();
    const [a, b] = w.fighters;
    a!.items = [freshItem('spread'), freshItem('missile')];
    shootAtB(w, 1, true);
    expect(b!.hp).toBe(MAX_HP - MISSILE.damage);
    expect(a!.items.map((i) => i.kind)).toEqual(['spread', 'missile']);
    expect(a!.items[1]!.left).toBe(POWER_AMOUNT.missile - 1);
  });

  it('a used-up item goes, and the one under it is next', () => {
    const w = powered();
    const a = w.fighters[0]!;
    a.items = [freshItem('spread'), { kind: 'missile', left: 1 }];
    stepWorld(w, [input(1, { alt: true, aim: toAim(Math.PI / 2) }), null]);
    expect(a.items.map((i) => i.kind)).toEqual(['spread']);
    for (let i = 2; i < 20; i++) stepWorld(w, [input(i, { alt: true, aim: toAim(Math.PI / 2) }), null]);
    expect(w.bullets.filter((b) => b.shot === 2).length).toBeGreaterThan(0);
  });

  it('with nothing on the stack, the secondary does nothing', () => {
    const w = powered();
    stepWorld(w, [input(1, { alt: true }), null]);
    expect(w.bullets).toHaveLength(0);
  });

  it('run: 60% faster for two seconds, then a walk again', () => {
    const w = powered();
    const a = w.fighters[0]!;
    stepWorld(w, [input(1, { keys: MV.DOWN, run: true }), null]);
    expect(a.y - 150).toBeCloseTo((PLAYER_SPEED * SPEED_BOOST) / 30, 5);
    expect(speedFor(true)).toBe(PLAYER_SPEED * SPEED_BOOST);
    // Let the run time out standing still, clear of the walls.
    for (let i = 0; i < RUN.ticks; i++) stepWorld(w, [input(2 + i, { run: true }), null]);
    expect(a.runLeft).toBe(0);
    const y = a.y;
    stepWorld(w, [input(100, { keys: MV.DOWN }), null]);
    expect(a.y - y).toBeCloseTo(PLAYER_SPEED / 30, 5);
  });

  it('run: holding it starts one run, and the next waits out the cooldown', () => {
    const w = powered();
    const a = w.fighters[0]!;
    stepWorld(w, [input(1, { run: true }), null]);
    const start = w.tick;
    for (let i = 0; i < RUN.ticks + 5; i++) stepWorld(w, [input(2 + i, { run: true }), null]);
    expect(a.runLeft).toBe(0); // held all along: no second run
    // Pressed again during the cooldown: nothing.
    stepWorld(w, [input(200), null]);
    stepWorld(w, [input(201, { run: true }), null]);
    expect(a.runLeft).toBe(0);
    expect(toMazeFrame(w, [0, 0]).p[0]![11]).toBe(start + RUN.ticks + RUN.cooldown - w.tick);
    // Once it is over, a press starts another.
    while (w.tick < start + RUN.ticks + RUN.cooldown) stepWorld(w, [input(300), null]);
    stepWorld(w, [input(301, { run: true }), null]);
    expect(a.runLeft).toBe(RUN.ticks - 1);
  });

  it('Ghost missiles go through walls; bullets do not', () => {
    const w = powered();
    const [a, b] = w.fighters;
    const tx = Math.floor(300 / MAZE_TILE);
    for (let ty = 1; ty < w.map.h - 1; ty++) w.map.walls[ty * w.map.w + tx] = 1;
    a!.items = [freshItem('missile')];
    shootAtB(w, 1, true);
    expect(b!.hp).toBe(MAX_HP - MISSILE.damage);
    shootAtB(w, 2);
    expect(b!.hp).toBe(MAX_HP - MISSILE.damage);
  });

  it('Spread shot: five pellets a blast, several land up close', () => {
    const w = powered();
    const [a, b] = w.fighters;
    b!.x = 170;
    a!.items = [freshItem('spread')];
    shootAtB(w, 1, true);
    expect(MAX_HP - b!.hp).toBeGreaterThanOrEqual(SPREAD.damage * 3);
    expect(a!.items[0]!.left).toBe(POWER_AMOUNT.spread - 1);
  });
});

describe('shields', () => {
  it('take the hits first, then health', () => {
    const w = powered();
    const b = w.fighters[1]!;
    b.shield = POWER_AMOUNT.shield;
    for (let i = 0; i < 5; i++) shootAtB(w, i + 1);
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(MAX_HP);
    expect(b.shield).toBe(0);
    shootAtB(w, 9);
    expect(b.hp).toBe(MAX_HP - BULLET_DAMAGE);
  });

  it('sit beside the stack, and a second one is left lying', () => {
    const w = powered();
    const a = w.fighters[0]!;
    a.items = [freshItem('missile')];
    w.pickups.push({ id: 1, kind: 'shield', x: a.x + 5, y: a.y });
    stepWorld(w, [null, null]);
    expect(a.shield).toBe(POWER_AMOUNT.shield);
    expect(a.items).toHaveLength(1);
    w.pickups.push({ id: 2, kind: 'shield', x: a.x + 5, y: a.y });
    stepWorld(w, [null, null]);
    expect(w.pickups.map((u) => u.id)).toEqual([2]);
    // Once it is spent, the next one can be had.
    a.shield = 0;
    stepWorld(w, [null, null]);
    expect(w.pickups).toHaveLength(0);
    expect(a.shield).toBe(POWER_AMOUNT.shield);
  });
});

describe('pickups', () => {
  it('stack up, the newest on top', () => {
    const w = powered();
    const a = w.fighters[0]!;
    for (const [id, kind] of [[1, 'missile'], [2, 'spread']] as const) {
      w.pickups.push({ id, kind, x: a.x + 5, y: a.y });
      const ev = stepWorld(w, [null, null]);
      expect(ev).toContainEqual({ k: 'pick', s: 0, p: powerCode(kind), x: Math.round(a.x + 5), y: Math.round(a.y) });
    }
    expect(a.items.map((i) => i.kind)).toEqual(['missile', 'spread']);
  });

  it('a full stack leaves the next one lying', () => {
    const w = powered();
    const a = w.fighters[0]!;
    a.items = Array.from({ length: MAX_ITEMS }, () => freshItem('spread'));
    w.pickups.push({ id: 1, kind: 'missile', x: a.x + 5, y: a.y });
    stepWorld(w, [null, null]);
    expect(w.pickups).toHaveLength(1);
    expect(a.items).toHaveLength(MAX_ITEMS);
  });

  it('appear over time, up to a cap, away from players', () => {
    const m = generateMaze(8, 14, 10);
    const w = createWorld(m, ['A', 'B', 'C', 'D'], seededRng(2), true);
    for (let i = 0; i < 60 * 30; i++) stepWorld(w, [null, null, null, null]);
    expect(w.pickups.length).toBe(pickupCap(w));
    for (const u of w.pickups) expect(mazeSolidAt(m, u.x, u.y)).toBe(false);
  });
});

describe('kills and shuffles', () => {
  it('a kill can swap the two stacks', () => {
    const w = powered();
    const [a, b] = w.fighters;
    a!.items = [freshItem('spread')];
    b!.items = [freshItem('missile'), freshItem('spread')];
    b!.hp = BULLET_DAMAGE;
    b!.lastHurt = w.tick; // no health back before the shot lands
    w.rng = () => 0; // always swap
    const ev = shootAtB(w);
    expect(ev).toContainEqual({ k: 'swap', a: 0, b: 1 });
    expect(a!.items.map((i) => i.kind)).toEqual(['missile', 'spread']);
    expect(b!.items.map((i) => i.kind)).toEqual(['spread']);
  });

  it('otherwise the victim scatters theirs where they fell', () => {
    const w = powered();
    const b = w.fighters[1]!;
    b.items = [freshItem('spread'), freshItem('missile')];
    b.shield = 0;
    b.hp = BULLET_DAMAGE;
    b.lastHurt = w.tick;
    w.rng = () => 0.99; // never swap
    const ev = shootAtB(w);
    expect(ev.some((e) => e.k === 'swap')).toBe(false);
    expect(b.items).toHaveLength(0);
    expect(w.pickups.map((u) => u.kind).sort()).toEqual(['missile', 'spread']);
    for (const u of w.pickups) expect(Math.hypot(u.x - 500, u.y - 150)).toBeLessThanOrEqual(20);
  });

  it('a shuffle deals whole stacks round the living; shields stay put', () => {
    const m = generateMaze(8, 14, 10);
    const w = createWorld(m, ['A', 'B', 'C', 'D'], seededRng(5), true);
    w.fighters[0]!.items = [freshItem('missile'), freshItem('spread')];
    w.fighters[1]!.items = [freshItem('missile')];
    w.fighters[2]!.shield = 50;
    expect(shufflePowers(w)).toBe(true);
    const stacks = w.fighters.map((f) => f.items.map((i) => i.kind).join('+')).filter(Boolean).sort();
    expect(stacks).toEqual(['missile', 'missile+spread']);
    expect(w.fighters[2]!.shield).toBe(50);
    for (const f of w.fighters) f.items = [];
    expect(shufflePowers(w)).toBe(false);
  });
});

describe('frames', () => {
  it('pack the stack, top first, and carry shield and running', () => {
    expect(unpackItems(packItems(['missile', 'spread', 'missile']))).toEqual(['missile', 'spread', 'missile']);
    expect(unpackItems(0)).toEqual([]);
    const w = powered();
    const a = w.fighters[0]!;
    a.items = [freshItem('spread'), { kind: 'missile', left: 4 }];
    a.shield = 60;
    a.runLeft = 20;
    a.runReadyAt = w.tick + 90;
    w.pickups.push({ id: 3, kind: 'shield', x: 300, y: 100 });
    const f = toMazeFrame(w, [0, 0]);
    const p = f.p[0]!;
    expect(unpackItems(p[7])).toEqual(['missile', 'spread']);
    expect(p.slice(8)).toEqual([4, 60, 20, 90]);
    expect(f.u).toEqual([[3, powerCode('shield'), 300, 100]]);
  });
});
