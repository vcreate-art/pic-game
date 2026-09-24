import type { Server, Socket } from 'socket.io';
import {
  AVATAR_COLORS, AVATAR_FACES, GAME_KINDS, sanitizePoints, PALETTE, BRUSH_SIZES,
  type GameKind, type Side,
  type Avatar, type ClientToServerEvents, type JoinAck, type ServerToClientEvents,
} from '@pic-game/shared';
import {
  CHAT_BUCKET, DRAW_BUCKET, FIGHT_INPUT_BUCKET, MAX_NAME_LEN, RACE_POS_BUCKET, SUGGEST_BUCKET,
} from '../config.js';
import type { AnyRoom, RoomManager } from '../core/RoomManager.js';
import type { FightRoom } from '../games/fight/FightRoom.js';
import type { KungFuRoom } from '../games/kungfu/KungFuRoom.js';
import type { RaceRoom } from '../games/race/RaceRoom.js';
import type { SpiesRoom } from '../games/spies/SpiesRoom.js';
import type { RealmsRoom } from '../games/realms/RealmsRoom.js';
import type { SkribblRoom } from '../games/skribbl/SkribblRoom.js';
import { TokenBucket } from '../rateLimit.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

/** Every side letter any board uses. */
const SIDES: readonly Side[] = ['w', 'b', 'r', 'y', 'g'];
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

/** Per-connection session. The room/player binding lives here rather than on the
 *  socket id, which is not stable across reconnects. */
interface Session {
  room: AnyRoom | null;
  playerId: string | null;
  chat: TokenBucket;
  draw: TokenBucket;
  suggest: TokenBucket;
  fight: TokenBucket;
  race: TokenBucket;
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
      suggest: new TokenBucket(SUGGEST_BUCKET.capacity, SUGGEST_BUCKET.refillPerSec),
      fight: new TokenBucket(FIGHT_INPUT_BUCKET.capacity, FIGHT_INPUT_BUCKET.refillPerSec),
      race: new TokenBucket(RACE_POS_BUCKET.capacity, RACE_POS_BUCKET.refillPerSec),
    };

    const bind = (room: AnyRoom, playerId: string) => {
      s.room = room;
      s.playerId = playerId;
      socket.join(room.code);
    };

    /** The room this socket is in, if it is the drawing game. */
    const skribbl = (): SkribblRoom | null =>
      s.room?.kind === 'skribbl' && s.playerId ? s.room : null;
    const chess = (): KungFuRoom | null =>
      s.room?.kind === 'kungfu' && s.playerId ? s.room : null;
    const realms = (): RealmsRoom | null =>
      s.room?.kind === 'realms' && s.playerId ? s.room : null;
    const fight = (): FightRoom | null =>
      s.room?.kind === 'fight' && s.playerId ? s.room : null;
    const race = (): RaceRoom | null =>
      s.room?.kind === 'race' && s.playerId ? s.room : null;
    const spies = (): SpiesRoom | null =>
      s.room?.kind === 'spies' && s.playerId ? s.room : null;

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

      // Validated against the list rather than a chain of comparisons, which
      // silently dropped a new kind into the default the last two times.
      const asked = p?.game;
      const kind = GAME_KINDS.includes(asked as GameKind) ? (asked as GameKind) : 'skribbl';
      const room = rooms.create(kind);
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

      if (room.isBanned(p.token)) {
        return cb({ ok: false, code: 'KICKED', message: 'You were removed from this room.' });
      }

      // A returning player reclaims their seat and score before any capacity check,
      // so a full room can never lock out someone who is already in it.
      if (p.token) {
        const reclaimed = room.reclaim(p.token, socket.id);
        if (reclaimed) {
          bind(room, reclaimed.id);
          cb({ ok: true, playerId: reclaimed.id, token: reclaimed.token, state: room.publicState() });
          io.to(room.code).emit('player:updated', room.publicPlayers().find((x) => x.id === reclaimed.id)!);
          if (room.kind === 'skribbl') room.resendSecretIfDrawer(reclaimed.id);
          return;
        }
      }

      if (room.players.size >= room.maxPlayers) {
        return cb({ ok: false, code: 'FULL', message: 'That room is full.' });
      }

      const player = room.addPlayer(name, cleanAvatar(p?.avatar), socket.id);
      bind(room, player.id);
      cb({ ok: true, playerId: player.id, token: player.token, state: room.publicState() });
      socket.to(room.code).emit('player:joined', room.publicPlayers().find((x) => x.id === player.id)!);
      room.systemMessage(`${name} joined.`);
    });

    socket.on('room:settings', (patch) => {
      const room = skribbl();
      if (!room || s.playerId !== room.hostId) return;
      room.updateSettings(patch ?? {});
    });

    socket.on('game:start', () => {
      if (!s.room || !s.playerId) return;
      s.room.startGame(s.playerId);
    });

    socket.on('word:choose', (p) => {
      const room = skribbl();
      if (!room || !s.playerId) return;
      if (typeof p?.id !== 'string' || p.id.length > 64) return;
      room.chooseWord(s.playerId, p.id);
    });

    socket.on('word:suggest', (p, cb) => {
      const room = skribbl();
      if (!room || !s.playerId) return;
      if (!s.suggest.tryTake()) {
        if (typeof cb === 'function') cb({ ok: false, message: 'Slow down a little.' });
        return;
      }
      // Validation lives in the room so it can see what is already suggested.
      const result = room.suggestWord(s.playerId, p?.text);
      if (typeof cb === 'function') cb(result);
    });

    socket.on('draw:start', (p) => {
      const room = skribbl();
      if (!room || !s.playerId || !s.draw.tryTake()) return;
      const pts = sanitizePoints(p?.pts);
      if (!pts || typeof p?.id !== 'string' || p.id.length > 64) return;
      room.strokeStart(s.playerId, {
        id: p.id,
        tool: p.tool === 'eraser' ? 'eraser' : 'pen',
        color: cleanColor(p.color),
        size: cleanSize(p.size),
        pts,
      });
    });

    socket.on('draw:append', (p) => {
      const room = skribbl();
      if (!room || !s.playerId || !s.draw.tryTake()) return;
      const pts = sanitizePoints(p?.pts);
      if (!pts || typeof p?.id !== 'string') return;
      room.strokeAppend(s.playerId, p.id, pts);
    });

    socket.on('draw:end', (p) => {
      const room = skribbl();
      if (!room || !s.playerId || typeof p?.id !== 'string') return;
      room.strokeEnd(s.playerId, p.id);
    });

    socket.on('draw:fill', (p) => {
      const room = skribbl();
      if (!room || !s.playerId || !s.draw.tryTake(2)) return;
      const pts = sanitizePoints([p?.x, p?.y]);
      if (!pts) return;
      room.fill(s.playerId, pts[0]!, pts[1]!, cleanColor(p?.color));
    });

    socket.on('canvas:undo', () => {
      const room = skribbl();
      if (!room || !s.playerId || !s.draw.tryTake(4)) return;
      room.undo(s.playerId);
    });

    socket.on('canvas:clear', () => {
      const room = skribbl();
      if (!room || !s.playerId || !s.draw.tryTake(8)) return;
      room.clearCanvas(s.playerId);
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

    socket.on('player:rename', (p) => {
      if (!s.room || !s.playerId || !s.chat.tryTake()) return;
      const name = cleanName(p?.name);
      if (!name) return;
      s.room.rename(s.playerId, name, cleanAvatar(p?.avatar));
    });

    socket.on('player:kick', (p) => {
      if (!s.room || !s.playerId) return;
      if (typeof p?.playerId !== 'string') return;
      s.room.kick(s.playerId, p.playerId);
    });

    socket.on('chess:seat', (p) => {
      const room = chess();
      if (!room || !s.playerId) return;
      // Which sides exist depends on the board, so only shape is checked here;
      // the room rejects a side its own variant does not have.
      const side = p?.side;
      if (side !== null && !SIDES.includes(side as Side)) return;
      room.takeSeat(s.playerId, side);
    });

    socket.on('chess:move', (p) => {
      const room = chess();
      if (!room || !s.playerId) return;
      // Same bucket as drawing: a move is the chess equivalent of a stroke.
      if (!s.draw.tryTake()) return;
      if (typeof p?.pieceId !== 'string' || p.pieceId.length > 64) return;
      room.move(s.playerId, p.pieceId, Number(p.to));
    });

    socket.on('chess:settings', (p) => {
      const room = chess();
      if (!room || s.playerId !== room.hostId) return;
      room.updateSettings(p ?? {});
    });

    socket.on('chess:rematch', () => {
      const room = chess();
      if (!room || !s.playerId) return;
      room.rematch(s.playerId);
    });

    socket.on('realms:seat', (p) => {
      const room = realms();
      if (!room || !s.playerId) return;
      const side = p?.side;
      if (side !== null && side !== 'a' && side !== 'b') return;
      room.takeSeat(s.playerId, side);
    });

    socket.on('realms:settings', (p) => {
      const room = realms();
      if (!room || s.playerId !== room.hostId) return;
      room.updateSettings(p ?? {});
    });

    // Card ids are opaque strings the server handed out; the room checks that
    // each one is actually in the zone the action needs it to be in.
    const cardAction = (fn: (room: RealmsRoom, playerId: string, cardId: string) => void) =>
      (p: { cardId?: unknown }) => {
        const room = realms();
        if (!room || !s.playerId) return;
        if (typeof p?.cardId !== 'string' || p.cardId.length > 64) return;
        if (!s.chat.tryTake()) return;
        fn(room, s.playerId, p.cardId);
      };

    socket.on('realms:play', cardAction((r, pid, id) => r.play(pid, id)));
    socket.on('realms:scrap', cardAction((r, pid, id) => r.scrap(pid, id)));
    socket.on('realms:buy', cardAction((r, pid, id) => r.buy(pid, id)));
    socket.on('realms:discard', cardAction((r, pid, id) => r.discard(pid, id)));

    socket.on('realms:use', (p) => {
      const room = realms();
      if (!room || !s.playerId) return;
      if (typeof p?.cardId !== 'string' || p.cardId.length > 64) return;
      const option = Number(p.option);
      if (!Number.isInteger(option) || option < 0 || option > 4) return;
      room.use(s.playerId, p.cardId, option);
    });

    socket.on('realms:attack', (p) => {
      const room = realms();
      if (!room || !s.playerId) return;
      const t = p?.target;
      if (!t || (t.kind !== 'player' && t.kind !== 'base')) return;
      if (t.kind === 'base' && typeof t.cardId !== 'string') return;
      room.attackWith(s.playerId, t);
    });

    socket.on('realms:end', () => {
      const room = realms();
      if (!room || !s.playerId) return;
      room.end(s.playerId);
    });

    socket.on('realms:rematch', () => {
      const room = realms();
      if (!room || !s.playerId) return;
      room.rematch(s.playerId);
    });

    socket.on('fight:seat', (p) => {
      const room = fight();
      if (!room || !s.playerId) return;
      const side = p?.side;
      if (side !== null && side !== 'a' && side !== 'b') return;
      room.takeSeat(s.playerId, side);
    });

    socket.on('fight:pick', (p) => {
      const room = fight();
      if (!room || !s.playerId) return;
      // The room checks it against the roster; here only the shape.
      if (typeof p?.fighter !== 'string' || p.fighter.length > 16) return;
      room.pick(s.playerId, p.fighter);
    });

    socket.on('fight:settings', (p) => {
      const room = fight();
      if (!room || s.playerId !== room.hostId) return;
      room.updateSettings(p ?? {});
    });

    socket.on('fight:input', (p) => {
      const room = fight();
      if (!room || !s.playerId) return;
      if (!s.fight.tryTake()) return;
      const seq = Number(p?.seq);
      const held = Number(p?.held);
      const pressed = Number(p?.pressed);
      if (!Number.isSafeInteger(seq) || !Number.isInteger(held) || !Number.isInteger(pressed)) return;
      room.input(s.playerId, seq, held, pressed);
    });

    socket.on('fight:rematch', () => {
      const room = fight();
      if (!room || !s.playerId) return;
      room.rematch(s.playerId);
    });

    socket.on('fight:toSelect', () => {
      const room = fight();
      if (!room || !s.playerId) return;
      room.toSelect(s.playerId);
    });

    socket.on('race:settings', (p) => {
      const room = race();
      if (!room || s.playerId !== room.hostId) return;
      room.updateSettings(p ?? {});
    });

    socket.on('race:pos', (p) => {
      const room = race();
      if (!room || !s.playerId || !s.race.tryTake()) return;
      const g = p?.g;
      const seq = Number(p?.seq);
      if (!Array.isArray(g) || g.length !== 5 || !Number.isSafeInteger(seq)) return;
      if (!g.every((n) => typeof n === 'number' && Number.isFinite(n))) return;
      room.position(s.playerId, seq, g as [number, number, number, number, number]);
    });

    socket.on('race:checkpoint', (p) => {
      const room = race();
      const n = Number(p?.n);
      if (!room || !s.playerId || !Number.isInteger(n) || n < 0 || n > 50) return;
      room.checkpoint(s.playerId, n);
    });

    socket.on('race:died', (p) => {
      const room = race();
      if (!room || !s.playerId || !s.chat.tryTake()) return;
      const cause = p?.cause;
      if (!['spikes', 'saw', 'laser', 'cannon', 'pit'].includes(cause as string)) return;
      room.died(s.playerId, cause);
    });

    socket.on('race:finish', () => {
      const room = race();
      if (room && s.playerId) room.finish(s.playerId);
    });

    socket.on('race:caught', () => {
      const room = race();
      if (room && s.playerId) room.caught(s.playerId);
    });

    socket.on('race:again', () => {
      const room = race();
      if (room && s.playerId) room.again(s.playerId);
    });

    socket.on('spies:join', (p) => {
      const room = spies();
      if (!room || !s.playerId) return;
      const team = p?.team;
      const role = p?.role;
      if (team !== null && team !== 'red' && team !== 'blue') return;
      if (role !== 'spymaster' && role !== 'operative') return;
      room.join(s.playerId, team, role);
    });

    socket.on('spies:shuffle', () => {
      const room = spies();
      if (room && s.playerId) room.shuffle(s.playerId);
    });

    socket.on('spies:settings', (p) => {
      const room = spies();
      if (room && s.playerId) room.updateSettings(s.playerId, p ?? {});
    });

    socket.on('spies:words', (p) => {
      const room = spies();
      if (!room || !s.playerId || typeof p?.text !== 'string') return;
      room.setWords(s.playerId, p.text);
    });

    socket.on('spies:clue', (p) => {
      const room = spies();
      if (!room || !s.playerId || !s.chat.tryTake()) return;
      const word = p?.word;
      if (word !== null && (typeof word !== 'string' || word.length > 40)) return;
      room.clue(s.playerId, word, Number(p?.count));
    });

    // Card indexes are checked for shape here and against the board in the room.
    const cardIndex = (p: { index?: unknown }) => {
      const i = Number(p?.index);
      return Number.isInteger(i) && i >= 0 && i < 25 ? i : null;
    };

    socket.on('spies:mark', (p) => {
      const room = spies();
      const i = cardIndex(p);
      if (!room || !s.playerId || i === null || !s.chat.tryTake()) return;
      room.mark(s.playerId, i);
    });

    socket.on('spies:reveal', (p) => {
      const room = spies();
      const i = cardIndex(p);
      if (!room || !s.playerId || i === null) return;
      room.revealCard(s.playerId, i);
    });

    socket.on('spies:pass', () => {
      const room = spies();
      if (room && s.playerId) room.pass(s.playerId);
    });

    socket.on('spies:peek', () => {
      const room = spies();
      if (room && s.playerId && s.chat.tryTake()) room.peek(s.playerId);
    });

    socket.on('spies:rematch', () => {
      const room = spies();
      if (room && s.playerId) room.rematch(s.playerId);
    });

    socket.on('spies:toLobby', () => {
      const room = spies();
      if (room && s.playerId) room.toLobby(s.playerId);
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
