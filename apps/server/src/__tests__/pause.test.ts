import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHOOSE_SECONDS, DEFAULT_SETTINGS, type GameKind } from '@pic-game/shared';
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
  it.each(['race', 'maze'] as const)('%s does not offer pause', (kind) => {
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

describe('pausing Draw & Guess', () => {
  /** A drawing turn under way, with the word as the drawer was told it. */
  function drawing() {
    vi.useFakeTimers();
    const t = playing('skribbl', 3);
    vi.advanceTimersByTime(CHOOSE_SECONDS * 1000 + 50); // the drawer runs out of time and gets a word
    const secret = t.sent.find((m) => m.event === 'word:secret');
    const word = (secret?.args[0] as { word: string }).word;
    const drawer = t.seats.find((p) => p.socketId === secret?.to)!;
    const guesser = t.seats.find((p) => p.id !== drawer.id)!;
    return { ...t, word, drawer, guesser };
  }
  const phase = (r: unknown) => (r as { publicState(): { phase: string } }).publicState().phase;

  it('holds the turn clock for as long as it is paused', () => {
    const { room, host } = drawing();
    expect(phase(room)).toBe('drawing');
    vi.advanceTimersByTime(10_000);
    room.pauseGame(host);
    vi.advanceTimersByTime(10 * 60_000);
    expect(phase(room)).toBe('drawing');
  });

  it('carries on with the time that was left', () => {
    const { room, host, sent } = drawing();
    const drawMs = DEFAULT_SETTINGS.drawTime * 1000;
    vi.advanceTimersByTime(10_000);
    room.pauseGame(host);
    vi.advanceTimersByTime(60_000);
    room.resumeGame(host);
    const clock = sent.filter((m) => m.event === 'turn:clock').at(-1)?.args[0] as { endsAt: number };
    expect(Math.abs(clock.endsAt - Date.now() - (drawMs - 10_000))).toBeLessThan(200);
    vi.advanceTimersByTime(drawMs - 10_000 - 1000);
    expect(phase(room)).toBe('drawing');
    vi.advanceTimersByTime(2000);
    expect(phase(room)).toBe('turnEnd');
  });

  it('holds back a correct guess until it carries on', () => {
    const { room, host, word, guesser, sent } = drawing();
    room.pauseGame(host);
    room.handleChat(guesser.id, word);
    expect(sent.some((m) => m.event === 'guess:correct')).toBe(false);
    expect(sent.some((m) => m.event === 'chat:message' && JSON.stringify(m.args).includes(word))).toBe(false);
    room.resumeGame(host);
    room.handleChat(guesser.id, word);
    expect(sent.some((m) => m.event === 'guess:correct')).toBe(true);
  });

  it('still lets people talk while paused', () => {
    const { room, host, guesser, sent } = drawing();
    room.pauseGame(host);
    room.handleChat(guesser.id, 'brb, getting a drink');
    expect(sent.some((m) => m.event === 'chat:message' && JSON.stringify(m.args).includes('getting a drink'))).toBe(true);
  });
});
