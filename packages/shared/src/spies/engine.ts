import {
  BOARD_SIZE, FIRST_AGENTS, MAX_CLUE_COUNT, SECOND_AGENTS, SPIES_BOUNDS, UNLIMITED, otherTeam,
  type CardColor, type Clue, type SpyTeam,
} from './types.js';

type Rng = () => number;

export interface SpiesGame {
  words: string[];
  /** The secret: what every card is. */
  key: CardColor[];
  revealed: (CardColor | null)[];
  starting: SpyTeam;
  turn: SpyTeam;
  phase: 'clue' | 'guess' | 'ended';
  clue: Clue | null;
  guessesLeft: number;
  log: Clue[];
  winner: SpyTeam | null;
  reason: 'agents' | 'assassin' | null;
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Board words as they are shown and compared: upper case, single spaces. */
export function normalizeWord(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * The host's own words, from whatever they pasted: split on commas and new
 * lines, tidied, and anything that is not a plausible word dropped. Board
 * words may be two words ("ICE CREAM"), unlike clues.
 */
export function parseCustomWords(input: string | readonly string[]): string[] {
  const parts = typeof input === 'string' ? input.split(/[\n,;]+/) : input;
  const seen = new Set<string>();
  for (const p of parts) {
    const w = normalizeWord(String(p));
    if (w.length < 2 || w.length > SPIES_BOUNDS.word.max) continue;
    if (!/^[\p{L}\p{N}][\p{L}\p{N} '-]*$/u.test(w)) continue;
    seen.add(w);
    if (seen.size >= SPIES_BOUNDS.customWords.max) break;
  }
  return [...seen];
}

/**
 * Deals a board: 25 words, and a key with 9 agents for the team that starts,
 * 8 for the other, one assassin and bystanders for the rest.
 */
export function deal(pool: readonly string[], rng: Rng, starting?: SpyTeam): SpiesGame {
  const unique = [...new Set(pool.map(normalizeWord))];
  if (unique.length < BOARD_SIZE) throw new Error(`Need ${BOARD_SIZE} words, have ${unique.length}`);
  const first: SpyTeam = starting ?? (rng() < 0.5 ? 'red' : 'blue');
  const words = shuffle(unique, rng).slice(0, BOARD_SIZE);
  const colors: CardColor[] = [
    ...Array<CardColor>(FIRST_AGENTS).fill(first),
    ...Array<CardColor>(SECOND_AGENTS).fill(otherTeam(first)),
    'assassin',
  ];
  while (colors.length < BOARD_SIZE) colors.push('neutral');
  return {
    words,
    key: shuffle(colors, rng),
    revealed: Array(BOARD_SIZE).fill(null),
    starting: first,
    turn: first,
    phase: 'clue',
    clue: null,
    guessesLeft: 0,
    log: [],
    winner: null,
    reason: null,
  };
}

export function remaining(g: SpiesGame, team: SpyTeam): number {
  return g.key.filter((c, i) => c === team && g.revealed[i] === null).length;
}

/**
 * Why a clue is not allowed, or null if it is. The rule from the table: one
 * word, and not a word on the board or part of one (so no WATER while
 * WATERFALL is still face down). Revealed cards no longer count.
 */
export function clueProblem(g: SpiesGame, raw: string): string | null {
  const w = normalizeWord(raw);
  if (!w) return 'Give a clue word.';
  if (/\s/.test(w)) return 'One word only.';
  if (w.length > SPIES_BOUNDS.word.max) return 'That clue is too long.';
  if (!/^[\p{L}\p{N}]+(['-][\p{L}\p{N}]+)*$/u.test(w)) return 'Letters only, please.';
  for (let i = 0; i < g.words.length; i++) {
    if (g.revealed[i] !== null) continue;
    const card = g.words[i]!;
    if (card === w) return `${w} is on the board.`;
    const parts = card.split(/[ -]/);
    if (parts.includes(w)) return `${w} is part of ${card}.`;
    if (w.length >= 3 && (card.includes(w) || w.includes(card))) return `${w} is too close to ${card}.`;
  }
  return null;
}

/** Guesses allowed on a clue: one more than the number, or no cap for 0 or ∞. */
export function guessesFor(count: number): number {
  return count === 0 || count === UNLIMITED ? UNLIMITED : count + 1;
}

export function validCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && (n === UNLIMITED || (n >= 0 && n <= MAX_CLUE_COUNT));
}

/** The spymaster gives a clue; a spoken one is the number alone. */
export function giveClue(g: SpiesGame, word: string | null, count: number): void {
  if (g.phase !== 'clue') throw new Error('Not the clue phase');
  const clue: Clue = { team: g.turn, word: word === null ? null : normalizeWord(word), count, guesses: [] };
  g.clue = clue;
  g.log.push(clue);
  g.guessesLeft = guessesFor(count);
  g.phase = 'guess';
}

export function passTurn(g: SpiesGame): void {
  if (g.phase === 'ended') return;
  g.turn = otherTeam(g.turn);
  g.phase = 'clue';
  g.clue = null;
  g.guessesLeft = 0;
}

function win(g: SpiesGame, team: SpyTeam, reason: 'agents' | 'assassin'): void {
  g.phase = 'ended';
  g.winner = team;
  g.reason = reason;
}

export interface RevealResult {
  color: CardColor;
  /** The guessing team's turn is over. */
  turnOver: boolean;
}

/**
 * Turns a card over. Your own agent: keep going, if there are guesses left.
 * A bystander or the other side's agent: your turn is over (and if it was
 * their last agent, they win). The assassin: you lose.
 */
export function reveal(g: SpiesGame, index: number): RevealResult {
  if (g.phase !== 'guess') throw new Error('Not the guess phase');
  if (g.revealed[index] !== null || !g.key[index]) throw new Error('Already revealed');
  const color = g.key[index]!;
  g.revealed[index] = color;
  g.clue?.guesses.push({ word: g.words[index]!, color });
  const team = g.turn;

  if (color === 'assassin') {
    win(g, otherTeam(team), 'assassin');
    return { color, turnOver: true };
  }
  if (color !== team) {
    if (color !== 'neutral' && remaining(g, color) === 0) win(g, color, 'agents');
    else passTurn(g);
    return { color, turnOver: true };
  }
  if (remaining(g, team) === 0) {
    win(g, team, 'agents');
    return { color, turnOver: true };
  }
  if (g.guessesLeft !== UNLIMITED && --g.guessesLeft <= 0) {
    passTurn(g);
    return { color, turnOver: true };
  }
  return { color, turnOver: false };
}
