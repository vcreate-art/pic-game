import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@pic-game/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

const PERSON_KEY = 'pic-game:person';

/**
 * This browser's lasting id: localStorage, so it outlives the tab. Rooms use
 * it to know someone again after they close the tab or leave and come back,
 * and keep their wins for them. Without storage it lasts only this visit.
 */
function personKey(): string {
  // For trying a game with several players from one browser: each tab opened
  // with ?newplayer is someone else.
  if (new URLSearchParams(location.search).has('newplayer')) return tabPerson();
  try {
    let key = localStorage.getItem(PERSON_KEY);
    if (!key) {
      key = uuid();
      localStorage.setItem(PERSON_KEY, key);
    }
    return key;
  } catch {
    return uuid();
  }
}

/** A person for this tab alone, kept across its refreshes. */
function tabPerson(): string {
  try {
    let key = sessionStorage.getItem(PERSON_KEY);
    if (!key) {
      key = uuid();
      sessionStorage.setItem(PERSON_KEY, key);
    }
    return key;
  } catch {
    return uuid();
  }
}

/** crypto.randomUUID is only there on https and localhost; a game over home
 *  Wi-Fi by plain http still needs one. */
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

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
      auth: { person: personKey() },
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

/** sessionStorage, not localStorage: the seat token is this tab's, so a
 *  refresh keeps the seat. A second tab finds the seat by the browser's
 *  person instead, and takes it over. */
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

const REPLACED_KEY = 'pic-game:replaced';

/** The room this tab lost its seat in to a newer tab, so coming back to it,
 *  by Back or a reload, asks before taking the seat again. Per tab, like the
 *  seat itself. */
export function loadReplaced(): string | null {
  try {
    return sessionStorage.getItem(REPLACED_KEY);
  } catch {
    return null;
  }
}

export function saveReplaced(code: string | null): void {
  try {
    if (code) sessionStorage.setItem(REPLACED_KEY, code);
    else sessionStorage.removeItem(REPLACED_KEY);
  } catch {
    /* without storage it lasts as long as the page */
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
