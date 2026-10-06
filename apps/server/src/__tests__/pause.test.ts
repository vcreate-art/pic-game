import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameKind } from '@pic-game/shared';
import { PAUSE_HOST_AWAY_MS } from '../config.js';
import { RoomManager } from '../core/RoomManager.js';
import { allowedWhilePaused } from '../socket/index.js';
import { fakeIO } from './fakeIO.js';

const av = { color: 0, face: 0 };

function playing(kind: GameKind, n = 3) {
  const { io, sent } = fakeIO();
  const rooms = new RoomManager(io);
  const room = rooms.create(kind);
  const seats = Array.from({ length: n }, (_, i) => room.addPlayer(`P${i}`, av, `sock${i}`));
  room.startGame(seats[0]!.id);
  return { rooms, room, seats, sent, host: seats[0]!.id };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('pausing a turn-based game', () => {
  it.each(['flip7', 'cryptid'] as const)('lets the host pause and resume %s', (kind) => {
    const { room, host } = playing(kind);
    expect(room.lifecycle()).toBe('playing');
    expect(room.meta().can.pause).toBe(true);
    room.pauseGame(host);
    expect(room.isPaused).toBe(true);
    expect(room.meta().paused).toMatchObject({ by: host });
    room.resumeGame(host);
    expect(room.isPaused).toBe(false);
    expect(room.meta().paused).toBeNull();
  });

  it('is the host’s call alone', () => {
    const { room, seats, host } = playing('flip7');
    room.pauseGame(seats[1]!.id);
    expect(room.isPaused).toBe(false);
    room.pauseGame(host);
    room.resumeGame(seats[1]!.id);
    expect(room.isPaused).toBe(true);
  });

  it('cannot pause from the lobby', () => {
    const { io } = fakeIO();
    const room = new RoomManager(io).create('flip7');
    const a = room.addPlayer('A', av, 's');
    room.pauseGame(a.id);
    expect(room.isPaused).toBe(false);
    expect(room.meta().can.pause).toBe(false);
  });

  it('makes no stand-in move for an away player while paused', () => {
    vi.useFakeTimers();
    const { room, seats, host, sent } = playing('flip7');
    room.pauseGame(host);
    for (const p of seats.slice(1)) room.markDisconnected(p.id);
    vi.advanceTimersByTime(5 * 60_000);
    const moved = sent.some((m) => m.event === 'chat:message' && JSON.stringify(m.args).includes('moved for them'));
    expect(moved).toBe(false);
  });

  it('carries on by itself when the host stays away', () => {
    vi.useFakeTimers();
    const { room, host } = playing('flip7');
    room.pauseGame(host);
    room.markDisconnected(host);
    vi.advanceTimersByTime(PAUSE_HOST_AWAY_MS - 1000);
    expect(room.isPaused).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(room.isPaused).toBe(false);
  });

  it('stays paused if the host comes back in time', () => {
    vi.useFakeTimers();
    const { room, seats, host } = playing('flip7');
    room.pauseGame(host);
    room.markDisconnected(host);
    room.reclaim(seats[0]!.token, 'back');
    vi.advanceTimersByTime(PAUSE_HOST_AWAY_MS * 2);
    expect(room.isPaused).toBe(true);
  });

  it('is dropped by a restart', () => {
    const { room, host } = playing('flip7');
    room.pauseGame(host);
    room.restart(host);
    expect(room.isPaused).toBe(false);
    expect(room.lifecycle()).toBe('playing');
  });
});

describe('games that cannot pause yet', () => {
  it.each(['race', 'skribbl', 'maze'] as const)('%s does not offer pause', (kind) => {
    const { room, host } = playing(kind, 2);
    room.pauseGame(host);
    expect(room.isPaused).toBe(false);
    expect(room.meta().can.pause).toBe(false);
    room.destroy();
  });
});

describe('what goes through while paused', () => {
  it('lets the room and chat through and holds game moves', () => {
    for (const e of ['room:resume', 'room:leave', 'chat:guess', 'game:restart', 'player:kick']) {
      expect(allowedWhilePaused(e)).toBe(true);
    }
    for (const e of ['flip7:hit', 'realms:play', 'cryptid:search', 'tourney:report', 'game:start']) {
      expect(allowedWhilePaused(e)).toBe(false);
    }
  });
});
