import type { BackstageSnapshot } from '@pic-game/shared';

export interface RoomPeek {
  exists: boolean;
  code?: string;
  players?: number;
  maxPlayers?: number;
  phase?: string;
}

/** The join screen's preflight: confirms a code is real before we open a socket,
 *  so a typo produces a clear message instead of a hanging connection. */
export async function peekRoom(code: string): Promise<RoomPeek> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`Room lookup failed (${res.status})`);
  return (await res.json()) as RoomPeek;
}

export interface WordPack {
  id: string;
  name: string;
  count: number;
}

export async function fetchWordPacks(): Promise<WordPack[]> {
  const res = await fetch('/api/word-packs');
  if (!res.ok) throw new Error('Could not load word packs');
  const data = (await res.json()) as { packs: WordPack[] };
  return data.packs;
}

/** Everything the backstage dashboard shows, read fresh on every poll. */
export async function fetchBackstage(): Promise<BackstageSnapshot> {
  const res = await fetch('/api/backstage', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Backstage lookup failed (${res.status})`);
  return (await res.json()) as BackstageSnapshot;
}
