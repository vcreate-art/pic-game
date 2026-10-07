import { useEffect, useState } from 'react';
import { PLAYABLE_KINDS, type GameKind } from '@pic-game/shared';
import { useGame } from '../store/game.js';
import { browserKey } from '../net/socket.js';
import {
  countGame, emptyDevice, emptyStored, mergeStored, readStored, totals, type Stats, type Stored,
} from './stats.js';

/**
 * What this player has played and won, and the achievements that adds up to.
 * Kept in localStorage, as each device's share (see stats.ts): there are no
 * accounts. Moving to a phone by QR code carries every share across; nothing
 * else sends them anywhere.
 */
export { NIGHTS, type Night, type Stats } from './stats.js';

const STATS_KEY = 'pic-game:stats';

/** Fired on every save, so an open achievements page keeps up. */
export const STATS_EVENT = 'pic-game:stats';

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? readStored(JSON.parse(raw), browserKey()) : emptyStored();
  } catch {
    return emptyStored();
  }
}

function saveStored(s: Stored): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(s));
  } catch {
    /* private mode — this visit's progress just isn't kept */
  }
  window.dispatchEvent(new CustomEvent<Stats>(STATS_EVENT, { detail: totals(s, browserKey()) }));
}

export function loadStats(): Stats {
  return totals(loadStored(), browserKey());
}

/** Every device's share, to send along with a seat moving to another device. */
export function exportStats(): string {
  return JSON.stringify(loadStored());
}

/**
 * Takes in the shares that came with a seat from another device. Returns
 * whether that brought anything new, for saying so.
 */
export function importStats(json: string): boolean {
  let incoming: Stored;
  try {
    incoming = readStored(JSON.parse(json), browserKey());
  } catch {
    return false;
  }
  const before = loadStored();
  const merged = mergeStored(before, incoming);
  if (JSON.stringify(merged) === JSON.stringify(before)) return false;
  // Together they may have reached a badge neither had on its own.
  const now = totals(merged, browserKey());
  unlockNew(now);
  merged.unlocked = now.unlocked;
  saveStored(merged);
  return true;
}

/** The saved stats, kept current as games finish. */
export function useStats(): Stats {
  const [stats, setStats] = useState(loadStats);
  useEffect(() => {
    const on = (e: Event) => setStats((e as CustomEvent<Stats>).detail);
    window.addEventListener(STATS_EVENT, on);
    return () => window.removeEventListener(STATS_EVENT, on);
  }, []);
  return stats;
}

const sum = (r: Partial<Record<GameKind, number>>) => Object.values(r).reduce((a, b) => a + (b ?? 0), 0);
const kinds = (r: Partial<Record<GameKind, number>>) => Object.values(r).filter((n) => (n ?? 0) > 0).length;

export const totalPlayed = (s: Stats) => sum(s.played);
export const totalWon = (s: Stats) => sum(s.won);

export interface Achievement {
  id: string;
  title: string;
  description: string;
  /** How far along, out of `goal`. */
  progress: (s: Stats) => number;
  goal: number;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-game', title: 'Pull up a chair', description: 'Finish your first game.', progress: totalPlayed, goal: 1 },
  { id: 'first-win', title: 'Winner winner', description: 'Win a game.', progress: totalWon, goal: 1 },
  { id: 'regular', title: 'Regular', description: 'Finish 25 games.', progress: totalPlayed, goal: 25 },
  { id: 'veteran', title: 'Veteran', description: 'Finish 100 games.', progress: totalPlayed, goal: 100 },
  { id: 'wins-10', title: 'On a roll', description: 'Win 10 games.', progress: totalWon, goal: 10 },
  { id: 'wins-50', title: 'Champion', description: 'Win 50 games.', progress: totalWon, goal: 50 },
  { id: 'streak-3', title: 'Hat trick', description: 'Win 3 games in a row.', progress: (s) => s.bestStreak, goal: 3 },
  { id: 'streak-5', title: 'Unstoppable', description: 'Win 5 games in a row.', progress: (s) => s.bestStreak, goal: 5 },
  { id: 'explorer', title: 'Explorer', description: 'Play 5 different games.', progress: (s) => kinds(s.played), goal: 5 },
  {
    id: 'completionist',
    title: 'Tried them all',
    description: 'Play every game on the shelf.',
    progress: (s) => PLAYABLE_KINDS.filter((k) => s.played[k]).length,
    goal: PLAYABLE_KINDS.length,
  },
  { id: 'all-rounder', title: 'All-rounder', description: 'Win at 5 different games.', progress: (s) => kinds(s.won), goal: 5 },
  {
    id: 'specialist',
    title: 'Specialist',
    description: 'Win 10 games of the same kind.',
    progress: (s) => Math.max(0, ...Object.values(s.won).map((n) => n ?? 0)),
    goal: 10,
  },
  { id: 'host', title: 'Game night host', description: 'Host 10 games to the end.', progress: (s) => s.hosted, goal: 10 },
  { id: 'crowd', title: 'Full house', description: 'Finish a game with 8 or more players.', progress: (s) => s.biggestRoom, goal: 8 },
];

/** Earned first, newest at the top; then the rest, closest to done first. */
export function byRelevance(s: Stats): Achievement[] {
  return [...ACHIEVEMENTS].sort((a, b) => {
    const ua = s.unlocked[a.id] ?? 0;
    const ub = s.unlocked[b.id] ?? 0;
    if (ua || ub) return ub - ua;
    return b.progress(s) / b.goal - a.progress(s) / a.goal;
  });
}

const today = () => new Date().toLocaleDateString('en-CA');

/** Marks anything newly earned and returns those, oldest-defined first. */
function unlockNew(s: Stats): Achievement[] {
  const fresh = ACHIEVEMENTS.filter((a) => !s.unlocked[a.id] && a.progress(s) >= a.goal);
  const now = Date.now();
  for (const a of fresh) s.unlocked[a.id] = now;
  return fresh;
}

const NOTICE_MS = 4000;

/** Shows a notice for a few seconds, unless another replaces it first. */
export function flash(text: string): void {
  useGame.getState().setNotice(text);
  setTimeout(() => {
    if (useGame.getState().notice === text) useGame.getState().setNotice(null);
  }, NOTICE_MS);
}

function announce(earned: Achievement[]) {
  if (!earned.length) return;
  const [first] = earned;
  flash(earned.length === 1 && first ? `🏆 Achievement: ${first.title}` : `🏆 ${earned.length} new achievements`);
}

/**
 * The room we were in when its game started. A game only counts if we were
 * there from the start, so dropping into the last seconds of one isn't a win
 * or a game played. A reload mid-game forgets this and that game goes
 * uncounted, which errs the right way.
 */
let startedIn: string | null = null;

useGame.subscribe((st, prev) => {
  const room = st.room;
  const before = prev.room;
  const me = st.me;
  // Joining or reloading into a room isn't something happening in it.
  if (!room || !before || !me || room.code !== before.code) {
    if (!room) startedIn = null;
    return;
  }
  if (room.meta.stage === 'playing' && before.meta.stage !== 'playing') startedIn = room.code;
  if (room.meta.games <= before.meta.games || startedIn !== room.code) return;
  startedIn = null;

  const won = (room.meta.wins[me] ?? 0) > (before.meta.wins[me] ?? 0);
  const stored = loadStored();
  const device = (stored.devices[browserKey()] ??= emptyDevice());
  countGame(device, { kind: room.kind, won, hosted: room.hostId === me, players: room.players.length, day: today() });
  const now = totals(stored, browserKey());
  const earned = unlockNew(now);
  stored.unlocked = now.unlocked;
  saveStored(stored);
  announce(earned);
});
