import { createHash, timingSafeEqual } from 'node:crypto';
import type { Namespace, Server } from 'socket.io';
import {
  GOD_MAX_STEP, GOD_NAMESPACE, GOD_SPEEDS,
  type GodAction, type GodClientEvents, type GodReply, type GodRoom, type GodRoomSummary,
} from '@pic-game/shared';
import { IS_PROD } from '../config.js';
import type { AnyRoom, RoomManager } from '../core/RoomManager.js';

/**
 * Whether a key opens god mode. With GOD_KEY set, only that key does. Without
 * it, a development server lets anyone in and a production one lets nobody.
 */
export function godKeyOk(given: unknown, key = process.env.GOD_KEY, prod = IS_PROD): boolean {
  if (!key) return !prod;
  if (typeof given !== 'string' || !given) return false;
  // Hashed first, so the comparison takes the same time whatever the length.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given), digest(key));
}

function summary(room: AnyRoom): GodRoomSummary {
  const state = room.publicState();
  return {
    code: room.code,
    kind: room.kind,
    stage: room.lifecycle(),
    phase: state.kind === 'skribbl' ? state.phase : state.game.phase,
    players: room.players.size,
    connected: room.activeCount(),
    createdAt: room.createdAt,
  };
}

function snapshot(room: AnyRoom, since: number): GodRoom {
  const meta = room.meta();
  const now = Date.now();
  return {
    code: room.code,
    kind: room.kind,
    stage: room.lifecycle(),
    createdAt: room.createdAt,
    hostId: room.hostId,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      score: p.score,
      host: p.id === room.hostId,
      awayForMs: p.disconnectedAt === null ? null : now - p.disconnectedAt,
    })),
    paused: meta.paused,
    countdown: meta.countdown,
    clock: room.clockState(),
    details: room.godDetails(),
    timeline: room.timeline().filter((e) => e.seq > since),
  };
}

/** Carries out one god action on a room, checking what came over the wire. */
export function godAct(room: AnyRoom, action: GodAction): GodReply {
  const drawGuess = room.kind === 'skribbl' ? room : null;
  switch (action?.kind) {
    case 'speed':
      if (!(GOD_SPEEDS as readonly number[]).includes(action.speed)) return { ok: false, message: 'Not a speed on offer.' };
      if (!room.clockState().controllable) return { ok: false, message: "This game's time can't be changed yet." };
      room.godClock({ kind: 'speed', speed: action.speed });
      return { ok: true };
    case 'step': {
      const ticks = Math.floor(Number(action.ticks));
      if (!(ticks >= 1 && ticks <= GOD_MAX_STEP)) return { ok: false, message: `Step 1 to ${GOD_MAX_STEP} ticks.` };
      if (!room.clockState().controllable) return { ok: false, message: "This game's time can't be changed yet." };
      room.godClock({ kind: 'step', ticks });
      return { ok: true };
    }
    case 'next':
      if (!room.clockState().controllable) return { ok: false, message: "This game's time can't be changed yet." };
      room.godClock({ kind: 'next' });
      return { ok: true };
    case 'pause':
      room.godPause();
      return { ok: true };
    case 'resume':
      room.godResume();
      return { ok: true };
    case 'restart':
      room.godRestart();
      return { ok: true };
    case 'lobby':
      room.godToLobby();
      return { ok: true };
    case 'kick':
      if (typeof action.playerId !== 'string' || !room.players.has(action.playerId)) {
        return { ok: false, message: 'No such player.' };
      }
      room.godKick(action.playerId);
      return { ok: true };
    case 'skipTurn':
    case 'endRound':
    case 'endGame':
      if (!drawGuess) return { ok: false, message: 'Only Draw & Guess has turns to control.' };
      if (action.kind === 'skipTurn') drawGuess.godSkipTurn();
      else if (action.kind === 'endRound') drawGuess.godEndRound();
      else drawGuess.godEndGame();
      return { ok: true };
    default:
      return { ok: false, message: 'Unknown action.' };
  }
}

/** Opens the god namespace: a key at the handshake, then room listings,
 *  room snapshots polled by the page, and actions. */
export function attachGod(io: Server, rooms: RoomManager): void {
  const god = io.of(GOD_NAMESPACE) as unknown as Namespace<GodClientEvents>;

  god.use((socket, next) => {
    const key = (socket.handshake.auth as { key?: unknown } | undefined)?.key;
    if (godKeyOk(key)) return next();
    next(new Error(process.env.GOD_KEY || !IS_PROD ? 'Wrong key.' : 'God mode is off on this server.'));
  });

  god.on('connection', (socket) => {
    socket.on('god:rooms', (cb) => {
      if (typeof cb !== 'function') return;
      cb(rooms.all().map(summary).sort((a, b) => b.createdAt - a.createdAt));
    });

    socket.on('god:room', (p, cb) => {
      if (typeof cb !== 'function') return;
      const room = rooms.get(String(p?.code ?? ''));
      cb(room ? snapshot(room, Number(p?.since) || 0) : null);
    });

    socket.on('god:act', (p, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      const room = rooms.get(String(p?.code ?? ''));
      if (!room) return reply({ ok: false, message: 'That room is gone.' });
      reply(godAct(room, p.action));
    });
  });
}
