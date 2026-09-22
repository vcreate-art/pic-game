import { Router } from 'express';
import { WORDS_EN } from '@pic-game/shared';
import type { RoomManager } from '../game/RoomManager.js';

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
      maxPlayers: room.settings.maxPlayers,
      phase: room.phase,
    });
  });

  r.get('/api/word-packs', (_req, res) => {
    res.json({ packs: [{ id: 'en', name: 'English', count: WORDS_EN.length }] });
  });

  return r;
}
