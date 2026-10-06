import { getSocket } from './socket.js';

/** Server epoch minus client epoch. Every countdown renders against server time,
 *  so a client with a skewed or deliberately altered clock still sees the true
 *  remaining time — and could not shorten the turn even if it lied. */
let offset = 0;
let best = Number.POSITIVE_INFINITY;
/** Server time the game was paused at, while it is. Countdowns read it in
 *  place of now, so they all hold still; the server pushes the deadlines
 *  back on resume, so they carry on from where they stopped. */
let pausedAt: number | null = null;

export function setPausedAt(at: number | null): void {
  pausedAt = at;
}

export function serverNow(): number {
  return Date.now() + offset;
}

/** Server time as the game sees it: standing still while paused. */
export function gameNow(): number {
  return pausedAt ?? serverNow();
}

export function isClockPaused(): boolean {
  return pausedAt !== null;
}

export function msUntil(serverEpoch: number): number {
  return Math.max(0, serverEpoch - (pausedAt ?? serverNow()));
}

/** Takes the sample with the lowest round-trip, which is the least distorted
 *  by queueing — the same trick NTP uses. */
export function syncClock(samples = 5): void {
  const socket = getSocket();
  let n = 0;
  const tick = () => {
    if (n++ >= samples) return;
    const t0 = Date.now();
    socket.timeout(3000).emit('time:ping', (err: unknown, serverT: number) => {
      if (!err && typeof serverT === 'number') {
        const rtt = Date.now() - t0;
        if (rtt < best) {
          best = rtt;
          offset = serverT + rtt / 2 - Date.now();
        }
      }
      setTimeout(tick, 250);
    });
  };
  tick();
}

export function resetClock(): void {
  offset = 0;
  best = Number.POSITIVE_INFINITY;
}
