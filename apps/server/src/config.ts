export const PORT = Number(process.env.PORT ?? 3001);
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

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
