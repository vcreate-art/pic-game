import type { GameKind } from '@pic-game/shared';

/**
 * Achievement stats, kept so that several devices can carry them between
 * each other. Each device only ever counts into its own share; moving to a
 * phone hands every share across, and each side keeps the newest copy of
 * each. Totals are the shares added up. However often someone moves back and
 * forth, nothing is counted twice and nothing played on either is lost.
 */

/** What one device has counted. */
export interface DeviceStats {
  /** Goes up on every save, so the newer copy of a share wins a merge. */
  rev: number;
  played: Partial<Record<GameKind, number>>;
  won: Partial<Record<GameKind, number>>;
  /** Games finished while we were the host. */
  hosted: number;
  /** Most players in a game we finished. */
  biggestRoom: number;
  /** Wins in a row on this device, and the best run so far. */
  streak: number;
  bestStreak: number;
  /** Each game's last few nights it was played, oldest first. */
  nights: Partial<Record<GameKind, Night[]>>;
}

/** Everything kept: each device's share, and when each badge was earned. */
export interface Stored {
  v: 2;
  devices: Record<string, DeviceStats>;
  /** Achievement id → when it was first earned (epoch ms). */
  unlocked: Record<string, number>;
}

/** The totals, as the pages and badges read them. */
export interface Stats {
  played: Partial<Record<GameKind, number>>;
  won: Partial<Record<GameKind, number>>;
  hosted: number;
  biggestRoom: number;
  /** This device's current run: a streak doesn't carry across devices. */
  streak: number;
  bestStreak: number;
  unlocked: Record<string, number>;
  nights: Partial<Record<GameKind, Night[]>>;
}

/** One local day's games of one kind. */
export interface Night {
  /** YYYY-MM-DD, in the player's own time zone. */
  day: string;
  played: number;
  won: number;
}

/** How many nights each game keeps. */
export const NIGHTS = 7;

export const emptyDevice = (): DeviceStats => ({
  rev: 0, played: {}, won: {}, hosted: 0, biggestRoom: 0, streak: 0, bestStreak: 0, nights: {},
});

export const emptyStored = (): Stored => ({ v: 2, devices: {}, unlocked: {} });

/**
 * Reads whatever was saved, or sent by another device, into the current
 * shape. Stats from before devices had shares become `me`'s share. Anything
 * malformed is dropped rather than trusted: it may have come over the wire.
 */
export function readStored(raw: unknown, me: string): Stored {
  if (!isObj(raw)) return emptyStored();
  if (raw.v === 2 && isObj(raw.devices)) {
    const devices: Record<string, DeviceStats> = {};
    for (const [id, d] of Object.entries(raw.devices)) if (isObj(d)) devices[id] = readDevice(d);
    return { v: 2, devices, unlocked: readTimes(raw.unlocked) };
  }
  // The first version: one browser's totals, with no shares.
  const d = readDevice(raw);
  const out = emptyStored();
  if (d.hosted || d.biggestRoom || Object.keys(d.played).length) out.devices[me] = { ...d, rev: 1 };
  out.unlocked = readTimes(raw.unlocked);
  return out;
}

/** Each device's newer share, and each badge's earliest date. */
export function mergeStored(a: Stored, b: Stored): Stored {
  const devices = { ...a.devices };
  for (const [id, d] of Object.entries(b.devices)) {
    const mine = devices[id];
    if (!mine || d.rev > mine.rev) devices[id] = d;
  }
  const unlocked = { ...a.unlocked };
  for (const [id, at] of Object.entries(b.unlocked)) unlocked[id] = Math.min(unlocked[id] ?? at, at);
  return { v: 2, devices, unlocked };
}

/** The shares added up. The current streak is `me`'s own. */
export function totals(s: Stored, me: string): Stats {
  const out: Stats = {
    played: {}, won: {}, hosted: 0, biggestRoom: 0, streak: s.devices[me]?.streak ?? 0, bestStreak: 0,
    unlocked: { ...s.unlocked }, nights: {},
  };
  const days: Partial<Record<GameKind, Map<string, Night>>> = {};
  for (const d of Object.values(s.devices)) {
    addUp(out.played, d.played);
    addUp(out.won, d.won);
    out.hosted += d.hosted;
    out.biggestRoom = Math.max(out.biggestRoom, d.biggestRoom);
    out.bestStreak = Math.max(out.bestStreak, d.bestStreak);
    for (const [kind, list] of Object.entries(d.nights) as [GameKind, Night[]][]) {
      const byDay = (days[kind] ??= new Map());
      for (const n of list) {
        const at = byDay.get(n.day) ?? { day: n.day, played: 0, won: 0 };
        byDay.set(n.day, { day: n.day, played: at.played + n.played, won: at.won + n.won });
      }
    }
  }
  for (const [kind, byDay] of Object.entries(days) as [GameKind, Map<string, Night>][]) {
    out.nights[kind] = [...byDay.values()].sort((x, y) => (x.day < y.day ? -1 : 1)).slice(-NIGHTS);
  }
  return out;
}

/** Counts one finished game into a device's share. */
export function countGame(
  d: DeviceStats,
  game: { kind: GameKind; won: boolean; hosted: boolean; players: number; day: string },
): void {
  d.played[game.kind] = (d.played[game.kind] ?? 0) + 1;
  if (game.won) d.won[game.kind] = (d.won[game.kind] ?? 0) + 1;
  if (game.hosted) d.hosted += 1;
  d.biggestRoom = Math.max(d.biggestRoom, game.players);
  d.streak = game.won ? d.streak + 1 : 0;
  d.bestStreak = Math.max(d.bestStreak, d.streak);
  const nights = d.nights[game.kind] ?? [];
  let last = nights[nights.length - 1];
  if (last?.day !== game.day) {
    last = { day: game.day, played: 0, won: 0 };
    nights.push(last);
  }
  last.played += 1;
  if (game.won) last.won += 1;
  d.nights[game.kind] = nights.slice(-NIGHTS);
  d.rev += 1;
}

function addUp(into: Partial<Record<GameKind, number>>, from: Partial<Record<GameKind, number>>) {
  for (const [k, n] of Object.entries(from) as [GameKind, number][]) into[k] = (into[k] ?? 0) + n;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const count = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);

function readCounts(x: unknown): Partial<Record<GameKind, number>> {
  const out: Partial<Record<GameKind, number>> = {};
  if (isObj(x)) for (const [k, n] of Object.entries(x)) if (count(n)) out[k as GameKind] = count(n);
  return out;
}

function readTimes(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObj(x)) for (const [k, n] of Object.entries(x)) if (count(n)) out[k] = count(n);
  return out;
}

function readDevice(x: Record<string, unknown>): DeviceStats {
  const nights: Partial<Record<GameKind, Night[]>> = {};
  if (isObj(x.nights)) {
    for (const [k, list] of Object.entries(x.nights)) {
      if (!Array.isArray(list)) continue;
      const good = list
        .filter((n): n is Record<string, unknown> => isObj(n) && typeof n.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.day))
        .map((n) => ({ day: n.day as string, played: count(n.played), won: Math.min(count(n.won), count(n.played)) }))
        .slice(-NIGHTS);
      if (good.length) nights[k as GameKind] = good;
    }
  }
  return {
    rev: count(x.rev),
    played: readCounts(x.played),
    won: readCounts(x.won),
    hosted: count(x.hosted),
    biggestRoom: count(x.biggestRoom),
    streak: count(x.streak),
    bestStreak: count(x.bestStreak),
    nights,
  };
}
