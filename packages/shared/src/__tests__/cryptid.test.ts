import { describe, expect, it } from 'vitest';
import {
  COLS, CryptidError, HEXES, ROWS, SETUP_CUBES, TERRAINS, TILES,
  advanceCryptid, allClues, autoMove, clueAllows, clueKey, clueMask, clueText, cryptidTurn, cubeSpaces,
  depart, generatePuzzle, hexAt, hexDistance, hexLabel, isFair, layTiles, neighbour, neighbours,
  newCryptid, placeCube, popcount, question, randomBoard, search, setupLeft,
  type CryptidBoard, type CryptidClue, type CryptidGame,
} from '../index.js';

function rng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe('the map', () => {
  it('labels spaces by column letter and row number', () => {
    expect(hexLabel(0)).toBe('A1');
    expect(hexLabel(hexAt(11, 8))).toBe('L9');
    expect(hexLabel(hexAt(2, 6))).toBe('C7');
  });

  it('neighbours sit across opposite sides of each other, one step away', () => {
    for (let h = 0; h < HEXES; h++) {
      for (let s = 0; s < 6; s++) {
        const n = neighbour(h, s);
        if (n === null) continue;
        expect(neighbour(n, (s + 3) % 6)).toBe(h);
        expect(hexDistance(h, n)).toBe(1);
      }
    }
  });

  it('an inner space has six neighbours; a corner has two or three', () => {
    expect(neighbours(hexAt(5, 4))).toHaveLength(6);
    expect(neighbours(hexAt(0, 0)).length).toBeLessThanOrEqual(3);
    expect(neighbours(hexAt(COLS - 1, ROWS - 1)).length).toBeLessThanOrEqual(3);
  });

  it('measures distance along the hex grid, not in a straight line', () => {
    expect(hexDistance(hexAt(0, 0), hexAt(0, 0))).toBe(0);
    expect(hexDistance(hexAt(0, 0), hexAt(0, 3))).toBe(3);
    // Moving along columns also drifts half a row per column.
    expect(hexDistance(hexAt(0, 0), hexAt(4, 2))).toBe(4);
    expect(hexDistance(hexAt(0, 0), hexAt(11, 8))).toBe(14);
  });

  it('six tiles of 6×3, every terrain about equally common', () => {
    expect(TILES).toHaveLength(6);
    const board = layTiles([0, 1, 2, 3, 4, 5].map((tile) => ({ tile, flipped: false })));
    for (const t of TERRAINS) {
      const n = board.terrain.filter((x) => x === t).length;
      expect(n).toBeGreaterThanOrEqual(18);
      expect(n).toBeLessThanOrEqual(24);
    }
    expect(board.animal.filter((a) => a === 'bear').length).toBeGreaterThan(0);
    expect(board.animal.filter((a) => a === 'cougar').length).toBeGreaterThan(0);
  });

  it('turning a tile round keeps each animal territory in one piece', () => {
    for (const flipped of [false, true]) {
      const board = layTiles([0, 1, 2, 3, 4, 5].map((tile) => ({ tile, flipped })));
      // Each tile holds one patch, so per tile the territory is connected.
      for (let slot = 0; slot < 6; slot++) {
        const c0 = (slot % 2) * 6;
        const r0 = Math.floor(slot / 2) * 3;
        const patch: number[] = [];
        for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
          const h = hexAt(c0 + c, r0 + r);
          if (board.animal[h]) patch.push(h);
        }
        const seen = new Set([patch[0]!]);
        const todo = [patch[0]!];
        while (todo.length) {
          for (const n of neighbours(todo.pop()!)) {
            if (patch.includes(n) && !seen.has(n)) {
              seen.add(n);
              todo.push(n);
            }
          }
        }
        expect(seen.size).toBe(patch.length);
      }
    }
  });

  it('turning a tile round is the same tile upside down', () => {
    const up = layTiles([{ tile: 0, flipped: false }, ...[1, 2, 3, 4, 5].map((tile) => ({ tile, flipped: false }))]);
    const down = layTiles([{ tile: 0, flipped: true }, ...[1, 2, 3, 4, 5].map((tile) => ({ tile, flipped: false }))]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) {
      expect(down.terrain[hexAt(5 - c, 2 - r)]).toBe(up.terrain[hexAt(c, r)]);
    }
  });

  it('structures: six in the standard game, eight in the advanced, spread out', () => {
    for (let seed = 1; seed < 30; seed++) {
      for (const advanced of [false, true]) {
        const b = randomBoard(advanced, rng(seed));
        expect(b.structures).toHaveLength(advanced ? 8 : 6);
        expect(b.structures.some((s) => s.color === 'black')).toBe(advanced);
        for (const a of b.structures) for (const o of b.structures) {
          if (a !== o) expect(hexDistance(a.hex, o.hex)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});

describe('clues', () => {
  it('23 in the standard game, 48 in the advanced, no two alike', () => {
    expect(allClues(false)).toHaveLength(23);
    expect(allClues(true)).toHaveLength(48);
    expect(new Set(allClues(true).map(clueKey)).size).toBe(48);
  });

  it('reads like the card', () => {
    expect(clueText({ kind: 'terrains', terrains: ['forest', 'water'], not: false }))
      .toBe('The habitat is on forest or water');
    expect(clueText({ kind: 'nearColor', color: 'blue', not: true }))
      .toBe('The habitat is NOT within three spaces of a blue structure');
    expect(clueText({ kind: 'nearAnimal', not: false }))
      .toBe('The habitat is within one space of either animal territory');
  });

  const board = randomBoard(true, rng(7));

  it('"on one of two terrains" is exactly those spaces', () => {
    const c: CryptidClue = { kind: 'terrains', terrains: ['forest', 'desert'], not: false };
    for (let h = 0; h < HEXES; h++) {
      expect(clueAllows(board, c, h)).toBe(board.terrain[h] === 'forest' || board.terrain[h] === 'desert');
    }
  });

  it('distance clues count the space itself', () => {
    const s = board.structures.find((x) => x.color === 'blue')!;
    const c: CryptidClue = { kind: 'nearColor', color: 'blue', not: false };
    expect(clueAllows(board, c, s.hex)).toBe(true);
    for (let h = 0; h < HEXES; h++) {
      const near = board.structures.some((x) => x.color === 'blue' && hexDistance(x.hex, h) <= 3);
      expect(clueAllows(board, c, h)).toBe(near);
    }
  });

  it('a "not" clue allows exactly what its positive rules out', () => {
    for (const c of allClues(false)) {
      const yes = clueMask(board, c);
      const no = clueMask(board, { ...c, not: true });
      expect(yes & no).toBe(0n);
      expect(popcount(yes) + popcount(no)).toBe(HEXES);
    }
  });
});

describe('puzzles', () => {
  it('a fair hand pins one space and needs every clue', () => {
    expect(isFair([0b0011n, 0b0101n])).toBe(0);
    expect(isFair([0b0111n, 0b0011n])).toBeNull(); // two spaces left
    expect(isFair([0b0011n, 0b0101n, 0b0001n])).toBeNull(); // the first two need no help
  });

  for (const advanced of [false, true]) {
    for (const players of [3, 4, 5]) {
      it(`${advanced ? 'advanced' : 'standard'}, ${players} players: always fair`, () => {
        for (let seed = 1; seed <= 25; seed++) {
          const p = generatePuzzle(players, advanced, rng(seed * 31 + players));
          expect(p.clues).toHaveLength(players);
          const masks = p.clues.map((c) => clueMask(p.board, c));
          expect(isFair(masks)).toBe(p.answer);
          for (const c of p.clues) expect(clueAllows(p.board, c, p.answer)).toBe(true);
          if (!advanced) expect(p.clues.every((c) => !c.not)).toBe(true);
          expect(p.clues.filter((c) => c.not).length).toBeLessThanOrEqual(2);
          expect(new Set(p.clues.map(clueKey)).size).toBe(players);
        }
      });
    }
  }
});

// ----------------------------------------------------------------- the game

/** A small hand-built puzzle so every answer below is known in advance. */
function fixture(): { g: CryptidGame; board: CryptidBoard } {
  const board: CryptidBoard = {
    ...layTiles([0, 1, 2, 3, 4, 5].map((tile) => ({ tile, flipped: false }))),
    structures: [],
    tiles: [],
  };
  const clues: CryptidClue[] = [
    { kind: 'terrains', terrains: ['water', 'forest'], not: false }, // A
    { kind: 'terrains', terrains: ['water', 'swamp'], not: false }, // B
    { kind: 'terrains', terrains: ['water', 'desert'], not: false }, // C
  ];
  // Water everywhere all three allow; pick one of those as the "answer".
  const answer = board.terrain.indexOf('water');
  return { g: newCryptid(board, ['A', 'B', 'C'], clues, answer), board };
}

const first = (board: CryptidBoard, t: string, skip = 0) =>
  board.terrain.map((x, i) => (x === t ? i : -1)).filter((i) => i >= 0)[skip]!;

describe('setup', () => {
  it('goes round twice, each cube where that clue rules the creature out', () => {
    const { g, board } = fixture();
    expect(g.stage).toBe('setup');
    expect(setupLeft(g)).toBe(3 * SETUP_CUBES);
    expect(cryptidTurn(g)).toBe('A');
    // A's clue allows forest, so a cube there is refused.
    expect(() => placeCube(g, 'A', first(board, 'forest'))).toThrow(CryptidError);
    expect(() => placeCube(g, 'B', first(board, 'desert'))).toThrow('not your turn');
    placeCube(g, 'A', first(board, 'desert'));
    expect(cryptidTurn(g)).toBe('B');
    placeCube(g, 'B', first(board, 'forest'));
    placeCube(g, 'C', first(board, 'swamp'));
    // Round two; no space takes a second cube.
    expect(() => placeCube(g, 'A', first(board, 'desert'))).toThrow('already a cube');
    placeCube(g, 'A', first(board, 'desert', 1));
    placeCube(g, 'B', first(board, 'forest', 1));
    placeCube(g, 'C', first(board, 'swamp', 1));
    expect(g.stage).toBe('turn');
    expect(cryptidTurn(g)).toBe('A');
    expect(g.cubes.filter(Boolean)).toHaveLength(6);
  });

  it('offers only the spaces a cube may go', () => {
    const { g, board } = fixture();
    const spaces = cubeSpaces(g, 'A');
    expect(spaces.every((h) => board.terrain[h] !== 'forest' && board.terrain[h] !== 'water')).toBe(true);
    expect(spaces.length).toBe(board.terrain.filter((t) => t !== 'forest' && t !== 'water').length);
  });
});

function played(): { g: CryptidGame; board: CryptidBoard } {
  const f = fixture();
  for (let i = 0; i < 6; i++) autoMove(f.g, rng(i + 1));
  expect(f.g.stage).toBe('turn');
  return f;
}

describe('questions', () => {
  it('a yes is a disk and passes the turn', () => {
    const { g, board } = played();
    const h = first(board, 'swamp', 5);
    expect(question(g, 'A', 'B', h)).toBe(true);
    expect(g.disks[h]).toEqual(['B']);
    expect(g.stage).toBe('turn');
    expect(cryptidTurn(g)).toBe('B');
  });

  it('a no is their cube, and the asker owes one', () => {
    const { g, board } = played();
    const h = board.terrain.findIndex((t, i) => t === 'forest' && g.cubes[i] === null);
    expect(question(g, 'A', 'B', h)).toBe(false);
    expect(g.cubes[h]).toBe('B');
    expect(g.stage).toBe('penalty');
    expect(cryptidTurn(g)).toBe('A');
    // A's clue allows forest and water, so the penalty cannot go on either.
    const water = board.terrain.findIndex((t, i) => t === 'water' && g.cubes[i] === null);
    expect(() => placeCube(g, 'A', water)).toThrow('Your clue allows');
    placeCube(g, 'A', cubeSpaces(g, 'A')[0]!);
    expect(g.stage).toBe('turn');
    expect(cryptidTurn(g)).toBe('B');
  });

  it('cannot ask yourself, about a closed space, or what they already said yes to', () => {
    const { g, board } = played();
    const h = first(board, 'swamp', 5);
    expect(() => question(g, 'A', 'A', h)).toThrow('other players');
    const closed = g.cubes.findIndex((c) => c !== null);
    expect(() => question(g, 'A', 'B', closed)).toThrow('closed');
    question(g, 'A', 'B', h);
    question(g, 'B', 'C', first(board, 'desert', 5));
    expect(() => question(g, 'C', 'B', h)).toThrow('already said yes');
  });
});

describe('searching', () => {
  it('only where your own clue allows', () => {
    const { g, board } = played();
    const desert = board.terrain.findIndex((t, i) => t === 'desert' && g.cubes[i] === null);
    expect(() => search(g, 'A', desert)).toThrow('Your own clue');
  });

  it('stops at the first no, which closes the space and costs a cube', () => {
    const { g, board } = played();
    // Forest: A says yes, B (water/swamp) is next round and says no.
    const h = board.terrain.findIndex((t, i) => t === 'forest' && g.cubes[i] === null);
    expect(search(g, 'A', h)).toBe(false);
    expect(g.disks[h]).toEqual(['A']);
    expect(g.cubes[h]).toBe('B');
    const last = g.log.at(-1)!;
    expect(last.kind === 'search' && last.answers).toEqual([{ id: 'B', yes: false }]);
    expect(g.stage).toBe('penalty');
    expect(g.winner).toBeNull();
  });

  it('answers go round from the searcher', () => {
    const { g, board } = played();
    question(g, 'A', 'B', first(board, 'swamp', 5));
    // B searches swamp: C (water/desert) is asked first and says no; A never is.
    const h = board.terrain.findIndex((t, i) => t === 'swamp' && g.cubes[i] === null && !g.disks[i]!.length);
    search(g, 'B', h);
    const last = g.log.at(-1)!;
    expect(last.kind === 'search' && last.answers).toEqual([{ id: 'C', yes: false }]);
  });

  it('everyone saying yes finds it', () => {
    const { g } = played();
    const h = g.answer;
    expect(g.cubes[h]).toBeNull();
    expect(search(g, 'A', h)).toBe(true);
    expect(g.winner).toBe('A');
    expect(g.stage).toBe('ended');
    expect(g.disks[h]!.sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('players who are not there', () => {
  it('a missed turn passes; an owed cube is put down for them', () => {
    const { g, board } = played();
    autoMove(g, rng(3));
    expect(g.log.at(-1)).toEqual({ kind: 'skip', by: 'A' });
    expect(cryptidTurn(g)).toBe('B');
    const h = board.terrain.findIndex((t, i) => t === 'forest' && g.cubes[i] === null);
    question(g, 'B', 'C', h);
    expect(g.stage).toBe('penalty');
    autoMove(g, rng(4));
    const cube = g.log.at(-1)!;
    expect(cube.kind === 'cube' && cube.why).toBe('auto');
    expect(cube.kind === 'cube' && clueAllows(board, g.clues.B!, cube.hex)).toBe(false);
    expect(cryptidTurn(g)).toBe('C');
  });

  it('leaving in setup drops their cubes, and setup still finishes', () => {
    const { g, board } = fixture();
    placeCube(g, 'A', first(board, 'desert'));
    depart(g, 'B');
    expect(cryptidTurn(g)).toBe('C');
    expect(setupLeft(g)).toBe(3);
    autoMove(g, rng(1));
    autoMove(g, rng(2));
    autoMove(g, rng(3));
    expect(g.stage).toBe('turn');
    expect(cryptidTurn(g)).toBe('A');
  });

  it('a player who left is never given the turn, but still answers', () => {
    const { g } = played();
    depart(g, 'B');
    advanceCryptid(g);
    expect(cryptidTurn(g)).toBe('C');
    // A search on the answer still has to get past B's clue.
    g.turn = 0;
    expect(search(g, 'A', g.answer)).toBe(true);
    const last = g.log.at(-1)!;
    expect(last.kind === 'search' && last.answers.map((a) => a.id)).toEqual(['B', 'C']);
  });

  it('leaving while owing a penalty lets it go', () => {
    const { g, board } = played();
    const h = board.terrain.findIndex((t, i) => t === 'forest' && g.cubes[i] === null);
    question(g, 'A', 'B', h);
    depart(g, 'A');
    expect(g.stage).toBe('turn');
    expect(cryptidTurn(g)).toBe('B');
  });
});
