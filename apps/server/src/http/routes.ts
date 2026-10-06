import { Router } from 'express';
import { WORDS_EN, type BackstageSnapshot } from '@pic-game/shared';
import type { RoomManager } from '../core/RoomManager.js';

export function makeRoutes(rooms: RoomManager): Router {
  const r = Router();

  r.get('/health', (_req, res) => {
    res.json({ ok: true, ...rooms.stats(), uptime: Math.round(process.uptime()) });
  });

  /** Lets the join screen say "no such room" before opening a socket.
   *  Deliberately exposes nothing but whether the code is joinable. */
  r.get('/api/rooms/:code', (req, res) => {
    const room = rooms.get(req.params.code ?? '');
    if (!room) {
      res.status(404).json({ exists: false });
      return;
    }
    res.json({
      exists: true,
      code: room.code,
      players: room.activeCount(),
      maxPlayers: room.maxPlayers,
      kind: room.kind,
      inLobby: room.isLobby(),
    });
  });

  /** Read-only feed for the backstage dashboard. Open, with no auth, so it
   *  carries names and progress but never room codes or seat tokens. */
  r.get('/api/backstage', (_req, res) => {
    const body: BackstageSnapshot = { at: Date.now(), rooms: rooms.backstage() };
    res.set('Cache-Control', 'no-store').json(body);
  });

  r.get('/api/word-packs', (_req, res) => {
    res.json({ packs: [{ id: 'en', name: 'English', count: WORDS_EN.length }] });
  });

  return r;
}
