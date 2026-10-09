import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHOOSE_SECONDS } from '@pic-game/shared';
import { GAME_COUNTDOWN_MS, TURN_END_SECONDS } from '../config.js';
import { RoomManager } from '../core/RoomManager.js';
import type { SkribblRoom } from '../games/skribbl/SkribblRoom.js';
import { fakeIO } from './fakeIO.js';

const av = { color: 0, face: 0 };

/** A Draw & Guess game of `n` seats and two rounds, before it starts. Uses fake timers. */
function game(n: number) {
  vi.useFakeTimers();
  const { io, sent } = fakeIO();
  const room = new RoomManager(io).create('skribbl') as SkribblRoom;
  room.updateSettings({ rounds: 2, drawTime: 30 });
  const seats = Array.from({ length: n }, (_, i) => room.addPlayer(`P${i}`, av, `sock${i}`));
  const start = () => {
    room.startGame(seats[0]!.id);
    vi.advanceTimersByTime(GAME_COUNTDOWN_MS);
  };
  /** Who was handed each turn, in order, by seat number. */
  const drew = () =>
    sent
      .filter((m) => m.event === 'turn:choosing' && m.to === room.code)
      .map((m) => seats.findIndex((s) => s.id === (m.args[0] as { drawerId: string }).drawerId));
  return { room, seats, start, drew };
}

/** Runs out every clock of a turn: choosing, drawing, then the reveal. */
const turn = (room: SkribblRoom) =>
  vi.advanceTimersByTime((CHOOSE_SECONDS + room.settings.drawTime + TURN_END_SECONDS) * 1000 + 100);

const finish = (room: SkribblRoom) => {
  for (let i = 0; i < 20 && room.phase !== 'gameEnd'; i++) turn(room);
};

afterEach(() => {
  vi.useRealTimers();
});

describe('turn order', () => {
  it('still ends the game when the last player in the order is away', () => {
    const { room, seats, start, drew } = game(4);
    room.markDisconnected(seats[3]!.id);
    start();
    finish(room);
    expect(room.phase).toBe('gameEnd');
    // Each one there drew once a round, and the one away never did.
    expect(drew()).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('skips nobody when someone before the drawer leaves', () => {
    const { room, seats, start, drew } = game(4);
    start();
    turn(room);
    turn(room); // P2 is drawing
    room.removePlayer(seats[0]!.id);
    finish(room);
    expect(drew()).toEqual([0, 1, 2, 3, 1, 2, 3]);
  });

  it('hands the turn to the next player when the drawer leaves mid-turn', () => {
    const { room, seats, start, drew } = game(4);
    start();
    turn(room); // P1 is choosing
    room.removePlayer(seats[1]!.id);
    finish(room);
    expect(drew()).toEqual([0, 1, 2, 3, 0, 2, 3]);
  });

  it('hands the turn to the next player when the drawer leaves after their turn', () => {
    const { room, seats, start } = game(4);
    start();
    vi.advanceTimersByTime((CHOOSE_SECONDS + room.settings.drawTime) * 1000 + 100); // P0's word is shown
    expect(room.phase).toBe('turnEnd');
    room.removePlayer(seats[0]!.id);
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000 + 100);
    expect(room.drawerId).toBe(seats[1]!.id);
  });
});
