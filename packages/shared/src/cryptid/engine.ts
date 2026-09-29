import { clueAllows } from './clues.js';
import {
  HEXES, SETUP_CUBES,
  type CryptidClue, type CryptidAction, type CryptidAnswer, type CryptidBoard,
} from './types.js';

export type CryptidStage = 'setup' | 'turn' | 'penalty' | 'ended';

export interface CryptidGame {
  board: CryptidBoard;
  /** Turn order. Starts with whoever goes first. */
  order: string[];
  clues: Record<string, CryptidClue>;
  answer: number;
  stage: CryptidStage;
  /** Index into `order` of whose move it is. */
  turn: number;
  /** Setup cubes each player still has to put down. */
  owed: Record<string, number>;
  disks: string[][];
  cubes: (string | null)[];
  log: CryptidAction[];
  winner: string | null;
  /** Players who have left. Their clue still answers, but they take no turns. */
  gone: string[];
}

export function newCryptid(board: CryptidBoard, order: string[], clues: CryptidClue[], answer: number): CryptidGame {
  const byId: Record<string, CryptidClue> = {};
  const owed: Record<string, number> = {};
  order.forEach((id, i) => {
    byId[id] = clues[i]!;
    owed[id] = SETUP_CUBES;
  });
  return {
    board,
    order: [...order],
    clues: byId,
    answer,
    stage: 'setup',
    turn: 0,
    owed,
    disks: Array.from({ length: HEXES }, () => []),
    cubes: Array(HEXES).fill(null),
    log: [],
    winner: null,
    gone: [],
  };
}

export const cryptidTurn = (g: CryptidGame): string | null => g.order[g.turn] ?? null;

const allows = (g: CryptidGame, id: string, hex: number) => clueAllows(g.board, g.clues[id]!, hex);

const onBoard = (hex: number) => Number.isInteger(hex) && hex >= 0 && hex < HEXES;

/**
 * Where this player may put a cube right now. Setup cubes go on empty spaces;
 * a penalty cube on any space without a cube. Either way, only where their own
 * clue rules the creature out.
 */
export function cubeSpaces(g: CryptidGame, id: string): number[] {
  const out: number[] = [];
  for (let h = 0; h < HEXES; h++) {
    if (g.cubes[h] !== null) continue;
    if (g.stage === 'setup' && g.disks[h]!.length) continue;
    if (!allows(g, id, h)) out.push(h);
  }
  return out;
}

/** Setup cubes still to go down, from players who are still here. */
export const setupLeft = (g: CryptidGame): number =>
  g.order.reduce((n, id) => n + (g.gone.includes(id) ? 0 : g.owed[id] ?? 0), 0);

/**
 * Moves the turn on to the next player who can take one. Players who have
 * left are passed over, and in setup so is anyone with no cubes left to place.
 * A player who is only disconnected still gets the turn: the room gives them
 * a while to come back before moving for them. Returns false when nobody can.
 */
export function advanceCryptid(g: CryptidGame): boolean {
  for (let step = 1; step <= g.order.length; step++) {
    const i = (g.turn + step) % g.order.length;
    const id = g.order[i]!;
    if (!g.gone.includes(id) && (g.stage !== 'setup' || (g.owed[id] ?? 0) > 0)) {
      g.turn = i;
      return true;
    }
  }
  return false;
}

/** A refusal, with a reason fit to show the player. */
export class CryptidError extends Error {}

function mustMove(g: CryptidGame, id: string, ...stages: CryptidStage[]): void {
  if (!stages.includes(g.stage)) throw new CryptidError('Not now.');
  if (cryptidTurn(g) !== id) throw new CryptidError('It is not your turn.');
}

/** After a cube: setup counts down and goes round again; a penalty ends the turn. */
function afterCube(g: CryptidGame, id: string): void {
  if (g.stage === 'setup') {
    g.owed[id] = Math.max(0, (g.owed[id] ?? 0) - 1);
    if (setupLeft(g) === 0) startPlay(g);
    else advanceCryptid(g);
    return;
  }
  g.stage = 'turn';
  advanceCryptid(g);
}

/** Setup is done: the first real turn goes back to the start of the order. */
function startPlay(g: CryptidGame): void {
  g.stage = 'turn';
  g.turn = g.order.length - 1;
  advanceCryptid(g);
}

/**
 * Puts down a cube, in setup or as a penalty. The space must be one the
 * player's own clue rules out, which the server can check and a table cannot.
 */
export function placeCube(g: CryptidGame, id: string, hex: number, why?: 'auto'): void {
  mustMove(g, id, 'setup', 'penalty');
  if (!onBoard(hex)) throw new CryptidError('That is not a space.');
  if (g.cubes[hex] !== null) throw new CryptidError('There is already a cube there.');
  if (g.stage === 'setup' && g.disks[hex]!.length) throw new CryptidError('Setup cubes go on empty spaces.');
  if (allows(g, id, hex)) throw new CryptidError('Your clue allows the creature there. Pick a space it rules out.');
  g.cubes[hex] = id;
  g.log.push({ kind: 'cube', by: id, hex, why: why ?? (g.stage === 'setup' ? 'setup' : 'penalty') });
  afterCube(g, id);
}

/**
 * Asks `target` whether the creature could be on `hex`. The answer comes from
 * their clue: a disk for yes, and play passes on; a cube for no, and the asker
 * owes a cube of their own.
 */
export function question(g: CryptidGame, id: string, target: string, hex: number): boolean {
  mustMove(g, id, 'turn');
  if (target === id || !g.order.includes(target)) throw new CryptidError('Ask one of the other players.');
  if (!onBoard(hex)) throw new CryptidError('That is not a space.');
  if (g.cubes[hex] !== null) throw new CryptidError('That space is closed: it has a cube on it.');
  if (g.disks[hex]!.includes(target)) throw new CryptidError('They have already said yes to that space.');
  const yes = allows(g, target, hex);
  if (yes) g.disks[hex]!.push(target);
  else g.cubes[hex] = target;
  g.log.push({ kind: 'question', by: id, target, hex, yes });
  if (yes) advanceCryptid(g);
  else g.stage = 'penalty';
  return yes;
}

/**
 * Searches a space. The searcher's clue must allow it, and they put down a
 * disk; then everyone else, going round from the searcher, answers until the
 * first no. A no is a cube on the space and a penalty cube for the searcher;
 * nobody saying no means the creature is found.
 */
export function search(g: CryptidGame, id: string, hex: number): boolean {
  mustMove(g, id, 'turn');
  if (!onBoard(hex)) throw new CryptidError('That is not a space.');
  if (g.cubes[hex] !== null) throw new CryptidError('That space is closed: it has a cube on it.');
  if (!allows(g, id, hex)) throw new CryptidError('Your own clue rules that space out.');
  if (!g.disks[hex]!.includes(id)) g.disks[hex]!.push(id);

  const answers: CryptidAnswer[] = [];
  const start = g.order.indexOf(id);
  for (let step = 1; step < g.order.length; step++) {
    const other = g.order[(start + step) % g.order.length]!;
    const yes = allows(g, other, hex);
    answers.push({ id: other, yes });
    if (!yes) {
      g.cubes[hex] = other;
      break;
    }
    if (!g.disks[hex]!.includes(other)) g.disks[hex]!.push(other);
  }

  const found = answers.every((a) => a.yes);
  g.log.push({ kind: 'search', by: id, hex, answers, found });
  if (found) {
    g.winner = id;
    g.stage = 'ended';
  } else {
    g.stage = 'penalty';
  }
  return found;
}

/**
 * Moves play past a player who is not there to move: in setup or a penalty the
 * cube they owe goes down on a space their clue rules out, chosen at random; on
 * an ordinary turn they simply pass.
 */
export function autoMove(g: CryptidGame, rng: () => number): void {
  const id = cryptidTurn(g);
  if (!id || g.stage === 'ended') return;
  if (g.stage === 'turn') {
    g.log.push({ kind: 'skip', by: id });
    advanceCryptid(g);
    return;
  }
  const spaces = cubeSpaces(g, id);
  if (!spaces.length) {
    // Nowhere left to put it: the debt is forgiven.
    afterCube(g, id);
    return;
  }
  placeCube(g, id, spaces[Math.floor(rng() * spaces.length)]!, 'auto');
}

/** A player leaves for good. Their clue stays in the game (the room makes it
 *  public), but the turn never comes to them again. */
export function depart(g: CryptidGame, id: string): void {
  if (!g.order.includes(id) || g.gone.includes(id)) return;
  const wasTurn = cryptidTurn(g) === id;
  g.gone.push(id);
  if (g.stage === 'ended') return;
  if (g.stage === 'setup') {
    // Their unplaced setup cubes are dropped rather than placed for them.
    if (setupLeft(g) === 0) startPlay(g);
    else if (wasTurn) advanceCryptid(g);
    return;
  }
  // A penalty they owed goes with them.
  if (wasTurn) {
    g.stage = 'turn';
    advanceCryptid(g);
  }
}
