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

/** Seconds the drawer gets to pick from the offered words before one is auto-picked. */
export const CHOOSE_SECONDS = 15;
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
export const DRAW_BUCKET = { capacity: 120, refillPerSec: 60 };
