import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@pic-game/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

/** One connection per tab, created lazily. Socket.IO handles reconnect and
 *  backoff; our job is only to re-present the seat token afterwards. */
export function getSocket(): GameSocket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 400,
      reconnectionDelayMax: 4000,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export interface Seat {
  code: string;
  playerId: string;
  token: string;
}

const SEAT_KEY = 'pic-game:seat';

/** sessionStorage, not localStorage: two tabs should be two players, but a
 *  refresh in one tab should keep its seat. */
export function saveSeat(seat: Seat): void {
  try {
    sessionStorage.setItem(SEAT_KEY, JSON.stringify(seat));
  } catch {
    /* private mode — reconnect simply falls back to a fresh seat */
  }
}

export function loadSeat(code: string): Seat | null {
  try {
    const raw = sessionStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const seat = JSON.parse(raw) as Seat;
    return seat.code === code ? seat : null;
  } catch {
    return null;
  }
}

export function clearSeat(): void {
  try {
    sessionStorage.removeItem(SEAT_KEY);
  } catch {
    /* ignore */
  }
}

const PROFILE_KEY = 'pic-game:profile';

export interface Profile {
  name: string;
  avatar: { color: number; face: number };
}

/** Fired on every save, so the header and the join form stay in step. */
export const PROFILE_EVENT = 'pic-game:profile';

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent<Profile>(PROFILE_EVENT, { detail: p }));
}

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}
