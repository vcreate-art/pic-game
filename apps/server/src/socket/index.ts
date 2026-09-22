import type { Server, Socket } from 'socket.io';
import {
  AVATAR_COLORS, AVATAR_FACES, sanitizePoints, PALETTE, BRUSH_SIZES,
  type Avatar, type ClientToServerEvents, type JoinAck, type ServerToClientEvents,
} from '@pic-game/shared';
import { CHAT_BUCKET, DRAW_BUCKET, MAX_NAME_LEN } from '../config.js';
import type { RoomManager } from '../game/RoomManager.js';
import type { Room } from '../game/Room.js';
import { TokenBucket } from '../rateLimit.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Per-connection session. The room/player binding lives here rather than on the
 *  socket id, which is not stable across reconnects. */
interface Session {
  room: Room | null;
  playerId: string | null;
  chat: TokenBucket;
  draw: TokenBucket;
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
  return name.length >= 1 ? name : null;
}

function cleanAvatar(raw: unknown): Avatar {
  const a = raw as Partial<Avatar> | undefined;
  const color = Number(a?.color);
  const face = Number(a?.face);
  return {
    color: Number.isInteger(color) && color >= 0 && color < AVATAR_COLORS.length ? color : 0,
    face: Number.isInteger(face) && face >= 0 && face < AVATAR_FACES.length ? face : 0,
  };
}

/** Colors and brush sizes are validated against the palette rather than accepted
 *  as free strings, which keeps arbitrary CSS out of every other player's canvas. */
function cleanColor(raw: unknown): string {
  return typeof raw === 'string' && (PALETTE as readonly string[]).includes(raw) ? raw : '#000000';
}
function cleanSize(raw: unknown): number {
  const n = Number(raw);
  return (BRUSH_SIZES as readonly number[]).includes(n) ? n : BRUSH_SIZES[0];
}

export function attachSocket(io: IO, rooms: RoomManager): void {
  io.on('connection', (socket: Sock) => {
    const s: Session = {
      room: null,
      playerId: null,
      chat: new TokenBucket(CHAT_BUCKET.capacity, CHAT_BUCKET.refillPerSec),
      draw: new TokenBucket(DRAW_BUCKET.capacity, DRAW_BUCKET.refillPerSec),
    };

    const bind = (room: Room, playerId: string) => {
      s.room = room;
      s.playerId = playerId;
      socket.join(room.code);
    };

    socket.on('time:ping', (cb) => {
      if (typeof cb === 'function') cb(Date.now());
    });

    socket.on('room:create', (p, cb) => {
      if (typeof cb !== 'function') return;
      const name = cleanName(p?.name);
      if (!name) return cb({ ok: false, code: 'BAD_NAME', message: 'Pick a nickname.' });

      // Creating a room while seated elsewhere gives up the old seat first.
      if (s.room && s.playerId) {
        const prev = s.room;
        const prevId = s.playerId;
        socket.leave(prev.code);
        s.room = null;
        s.playerId = null;
        prev.removePlayer(prevId);
      }

      const room = rooms.create();
      const player = room.addPlayer(name, cleanAvatar(p?.avatar), socket.id);
      bind(room, player.id);
      cb({ ok: true, playerId: player.id, token: player.token, state: room.publicState() });
      room.systemMessage(`${name} created the room.`);
    });

    socket.on('room:join', (p, cb) => {
      if (typeof cb !== 'function') return;
      const name = cleanName(p?.name);
      if (!name) return cb({ ok: false, code: 'BAD_NAME', message: 'Pick a nickname.' });

      const room = rooms.get(String(p?.code ?? ''));
      if (!room) return cb({ ok: false, code: 'NOT_FOUND', message: 'No room with that code.' });

      // A socket that already holds a seat must not be handed a second one. Without
      // this, a duplicate join leaves the first player in the list forever, still
      // flagged connected — which also means "everybody guessed" never becomes true.
      if (s.room && s.playerId) {
        if (s.room.code === room.code) {
          const seated = room.players.get(s.playerId);
          if (seated) {
            return cb({ ok: true, playerId: seated.id, token: seated.token, state: room.publicState() });
          }
        } else {
          const prev = s.room;
          const prevId = s.playerId;
          socket.leave(prev.code);
          s.room = null;
          s.playerId = null;
          prev.removePlayer(prevId);
        }
      }

      // A returning player reclaims their seat and score before any capacity check,
      // so a full room can never lock out someone who is already in it.
      if (p.token) {
        const reclaimed = room.reclaim(p.token, socket.id);
        if (reclaimed) {
          bind(room, reclaimed.id);
          cb({ ok: true, playerId: reclaimed.id, token: reclaimed.token, state: room.publicState() });
          io.to(room.code).emit('player:updated', room.publicPlayers().find((x) => x.id === reclaimed.id)!);
          room.resendSecretIfDrawer(reclaimed.id);
          return;
        }
      }

      if (room.players.size >= room.settings.maxPlayers) {
        return cb({ ok: false, code: 'FULL', message: 'That room is full.' });
      }

      const player = room.addPlayer(name, cleanAvatar(p?.avatar), socket.id);
      bind(room, player.id);
      cb({ ok: true, playerId: player.id, token: player.token, state: room.publicState() });
      socket.to(room.code).emit('player:joined', room.publicPlayers().find((x) => x.id === player.id)!);
      room.systemMessage(`${name} joined.`);
    });

    socket.on('room:settings', (patch) => {
      if (!s.room || !s.playerId || s.playerId !== s.room.hostId) return;
      s.room.updateSettings(patch ?? {});
    });

    socket.on('game:start', () => {
      if (!s.room || !s.playerId) return;
      s.room.startGame(s.playerId);
    });

    socket.on('word:choose', (p) => {
      if (!s.room || !s.playerId) return;
      const i = Number(p?.index);
      if (!Number.isInteger(i) || i < 0 || i > 8) return;
      s.room.chooseWord(s.playerId, i);
    });

    socket.on('draw:start', (p) => {
      if (!s.room || !s.playerId || !s.draw.tryTake()) return;
      const pts = sanitizePoints(p?.pts);
      if (!pts || typeof p?.id !== 'string' || p.id.length > 64) return;
      s.room.strokeStart(s.playerId, {
        id: p.id,
        tool: p.tool === 'eraser' ? 'eraser' : 'pen',
        color: cleanColor(p.color),
        size: cleanSize(p.size),
        pts,
      });
    });

    socket.on('draw:append', (p) => {
      if (!s.room || !s.playerId || !s.draw.tryTake()) return;
      const pts = sanitizePoints(p?.pts);
      if (!pts || typeof p?.id !== 'string') return;
      s.room.strokeAppend(s.playerId, p.id, pts);
    });

    socket.on('draw:end', (p) => {
      if (!s.room || !s.playerId || typeof p?.id !== 'string') return;
      s.room.strokeEnd(s.playerId, p.id);
    });

    socket.on('draw:fill', (p) => {
      if (!s.room || !s.playerId || !s.draw.tryTake(2)) return;
      const pts = sanitizePoints([p?.x, p?.y]);
      if (!pts) return;
      s.room.fill(s.playerId, pts[0]!, pts[1]!, cleanColor(p?.color));
    });

    socket.on('canvas:undo', () => {
      if (!s.room || !s.playerId || !s.draw.tryTake(4)) return;
      s.room.undo(s.playerId);
    });

    socket.on('canvas:clear', () => {
      if (!s.room || !s.playerId || !s.draw.tryTake(8)) return;
      s.room.clearCanvas(s.playerId);
    });

    socket.on('chat:guess', (p) => {
      if (!s.room || !s.playerId) return;
      if (!s.chat.tryTake()) {
        s.room.emitError(s.playerId, 'RATE_LIMITED', 'Slow down a little.');
        return;
      }
      if (typeof p?.text !== 'string') return;
      s.room.handleChat(s.playerId, p.text);
    });

    socket.on('room:leave', () => {
      if (!s.room || !s.playerId) return;
      const room = s.room;
      const id = s.playerId;
      socket.leave(room.code);
      s.room = null;
      s.playerId = null;
      room.removePlayer(id);
    });

    socket.on('disconnect', () => {
      if (!s.room || !s.playerId) return;
      // Kept as a seat rather than removed, so a refresh or a tunnel blip
      // does not cost the player their score.
      s.room.markDisconnected(s.playerId);
    });
  });
}
