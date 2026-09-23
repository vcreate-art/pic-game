export const PORT = Number(process.env.PORT ?? 3001);
export const IS_PROD = process.env.NODE_ENV === 'production';

/** Explicit allowlist, comma-separated. Required in production. */
const CONFIGURED_ORIGINS = (process.env.CLIENT_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/** localhost plus the RFC1918 private ranges, so phones and laptops on the same
 *  Wi-Fi can join during development without naming each address. */
const PRIVATE_ORIGIN =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

/**
 * A same-origin request (curl, health checks) sends no Origin header at all and
 * is always allowed; only cross-origin browser traffic is filtered.
 *
 * In production nothing is inferred — set CLIENT_ORIGIN explicitly, or only
 * same-origin requests get through.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (CONFIGURED_ORIGINS.includes(origin)) return true;
  if (IS_PROD) return false;
  return PRIVATE_ORIGIN.test(origin);
}

// Phase timings live in @pic-game/shared so the client's countdown and the
// server's timers are driven by the same numbers.
export { CHOOSE_SECONDS, SUGGEST_SECONDS } from '@pic-game/shared';
/** Scoreboard pause between turns. */
export const TURN_END_SECONDS = 6;
/** Podium display before the room falls back to the lobby. */
export const GAME_END_SECONDS = 15;

/** A reconnecting socket may reclaim its seat and score within this window. */
export const RECONNECT_GRACE_MS = 60_000;
/** An empty room is collected after this long. */
export const EMPTY_ROOM_TTL_MS = 120_000;

export const MAX_NAME_LEN = 20;
export const MAX_CHAT_LEN = 100;
export const MAX_OPS_PER_TURN = 4000;

/** Token buckets, sized so normal play never notices and a scripted flood does. */
export const CHAT_BUCKET = { capacity: 6, refillPerSec: 1.5 };
export const SUGGEST_BUCKET = { capacity: 5, refillPerSec: 0.8 };
export const DRAW_BUCKET = { capacity: 120, refillPerSec: 60 };

/** Controller updates. A fighter sends one per change, which even frantic
 *  mashing keeps well under this; a script flooding the room does not. */
export const FIGHT_INPUT_BUCKET = { capacity: 120, refillPerSec: 90 };
/** A fighter whose connection drops has this long to come back before they
 *  forfeit. The match is frozen in the meantime. */
export const FIGHT_FORFEIT_MS = 10_000;
/** Countdown after a dropped fighter returns, so nobody is hit cold. */
export const FIGHT_RESUME_MS = 3_000;

/** Position updates from a runner: a dozen a second, with plenty of slack. */
export const RACE_POS_BUCKET = { capacity: 60, refillPerSec: 30 };
