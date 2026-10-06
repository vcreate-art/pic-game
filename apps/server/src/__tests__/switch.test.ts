import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_ROOM_TTL_MS } from '../config.js';
import { RoomManager } from '../core/RoomManager.js';
import { fakeIO } from './fakeIO.js';

const av = { color: 0, face: 0 };

function table(kind: 'flip7' | 'bingo' = 'flip7', n = 3) {
  const { io, sent } = fakeIO();
  const rooms = new RoomManager(io);
  const room = rooms.create(kind);
  const seats = Array.from({ length: n }, (_, i) => room.addPlayer(`P${i}`, av, `sock${i}`));
  return { rooms, room, seats, sent };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RoomManager.switchKind', () => {
  it('keeps the code, seats, tokens, host, order and session', () => {
    const { rooms, room, seats, sent } = table();
    room.session.record('flip7', [seats[1]!.id]);

    expect(rooms.switchKind(room.code, 'bingo', seats[0]!.id)).toEqual({ ok: true });

    const next = rooms.get(room.code)!;
    expect(next).not.toBe(room);
    expect(next.kind).toBe('bingo');
    expect(next.hostId).toBe(seats[0]!.id);
    expect(next.order).toEqual(seats.map((p) => p.id));
    expect([...next.players.values()].map((p) => p.token)).toEqual(seats.map((p) => p.token));
    expect(next.meta().wins).toEqual({ [seats[1]!.id]: 1 });
    expect(room.destroyed).toBe(true);
    expect(sent.some((m) => m.event === 'state:sync' && (m.args[0] as { kind: string }).kind === 'bingo')).toBe(true);
  });

  it('starts every seat on zero in the new game', () => {
    const { rooms, room, seats } = table('flip7');
    seats[0]!.score = 5;
    rooms.switchKind(room.code, 'skribbl', seats[0]!.id);
    expect([...rooms.get(room.code)!.players.values()].every((p) => p.score === 0)).toBe(true);
  });

  it('refuses anyone but the host', () => {
    const { rooms, room, seats } = table();
    expect(rooms.switchKind(room.code, 'bingo', seats[1]!.id).ok).toBe(false);
    expect(rooms.get(room.code)).toBe(room);
  });

  it('refuses the game already being played', () => {
    const { rooms, room, seats } = table();
    expect(rooms.switchKind(room.code, 'flip7', seats[0]!.id).ok).toBe(false);
  });

  it('refuses in the middle of a game', () => {
    const { rooms, room, seats } = table('flip7');
    room.startGame(seats[0]!.id);
    expect(room.lifecycle()).toBe('playing');
    const r = rooms.switchKind(room.code, 'bingo', seats[0]!.id);
    expect(r).toEqual({ ok: false, message: 'Finish or end this game first.' });
    expect(rooms.get(room.code)).toBe(room);
  });

  it('refuses a game too small for everyone here', () => {
    const { rooms, room, seats } = table('flip7', 9);
    const r = rooms.switchKind(room.code, 'race', seats[0]!.id);
    expect(r.ok).toBe(false);
    expect(rooms.get(room.code)).toBe(room);
    expect(room.players.size).toBe(9);
  });

  it('raises the Draw & Guess limit for a bigger group', () => {
    const { rooms, room, seats } = table('flip7', 14);
    expect(rooms.switchKind(room.code, 'skribbl', seats[0]!.id).ok).toBe(true);
    expect(rooms.get(room.code)!.maxPlayers).toBe(14);
  });

  it('still turns away a kicked player afterwards', () => {
    const { rooms, room, seats } = table();
    const kicked = seats[2]!;
    room.kick(seats[0]!.id, kicked.id);
    rooms.switchKind(room.code, 'bingo', seats[0]!.id);
    expect(rooms.get(room.code)!.isBanned(kicked.token)).toBe(true);
  });

  it('lets a dropped player reclaim their seat in the new game', () => {
    const { rooms, room, seats } = table();
    room.markDisconnected(seats[1]!.id);
    rooms.switchKind(room.code, 'bingo', seats[0]!.id);
    const back = rooms.get(room.code)!.reclaim(seats[1]!.token, 'fresh-socket');
    expect(back?.id).toBe(seats[1]!.id);
  });

  it('collects the room once, by the new game, when nobody comes back', () => {
    vi.useFakeTimers();
    const { rooms, room, seats } = table('flip7', 2);
    for (const p of seats) room.markDisconnected(p.id);
    rooms.switchKind(room.code, 'bingo', seats[0]!.id);
    const next = rooms.get(room.code)!;
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS + 1000);
    expect(rooms.get(room.code)).toBeUndefined();
    expect(next.destroyed).toBe(true);
  });
});

describe('room meta', () => {
  it('tells clients when switching stops being allowed', () => {
    const { room, seats, sent } = table('flip7');
    room.startGame(seats[0]!.id);
    const last = sent.filter((m) => m.event === 'room:meta').at(-1);
    expect(last?.args[0]).toMatchObject({ can: { switch: false } });
  });
});

describe('restart and back to lobby', () => {
  it('restarts a game in progress without recording a result', () => {
    const { room, seats, sent } = table('flip7');
    room.startGame(seats[0]!.id);
    const before = room.publicState();
    room.restart(seats[0]!.id);
    expect(room.lifecycle()).toBe('playing');
    expect(room.meta().games).toBe(0);
    expect(room.publicState()).not.toEqual(before);
    expect(sent.some((m) => m.event === 'chat:message' && JSON.stringify(m.args).includes('restarted'))).toBe(true);
  });

  it('goes back to the lobby without recording a result', () => {
    const { room, seats } = table('bingo');
    room.startGame(seats[0]!.id);
    room.backToLobby(seats[0]!.id);
    expect(room.lifecycle()).toBe('lobby');
    expect(room.meta().games).toBe(0);
    expect(room.meta().can).toEqual({ pause: false, restart: false, toLobby: false, switch: true });
  });

  it('is the host’s call alone', () => {
    const { room, seats } = table('flip7');
    room.startGame(seats[0]!.id);
    room.backToLobby(seats[1]!.id);
    room.restart(seats[1]!.id);
    expect(room.lifecycle()).toBe('playing');
  });

  it('does nothing from the lobby', () => {
    const { room, seats, sent } = table('flip7');
    const count = sent.length;
    room.restart(seats[0]!.id);
    room.backToLobby(seats[0]!.id);
    expect(room.lifecycle()).toBe('lobby');
    expect(sent.length).toBe(count);
  });

  it('stops a real-time game’s loop when it goes back to the lobby', () => {
    vi.useFakeTimers();
    const { rooms } = table();
    const maze = rooms.create('maze');
    const a = maze.addPlayer('A', av, 'x1');
    maze.addPlayer('B', av, 'x2');
    maze.startGame(a.id);
    expect(maze.lifecycle()).toBe('playing');
    maze.backToLobby(a.id);
    expect(vi.getTimerCount()).toBe(0);
  });
});
