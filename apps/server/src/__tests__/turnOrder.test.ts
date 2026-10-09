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
  /** The popups everyone was shown, in order. */
  const notices = () =>
    sent.filter((m) => m.event === 'turn:notice').map((m) => (m.args[0] as { text: string }).text);
  return { room, seats, start, drew, notices };
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
  it('says so when the drawer drops out mid-turn', () => {
    const { room, seats, start, notices } = game(3);
    start();
    room.markDisconnected(seats[0]!.id);
    expect(notices()).toEqual(['P0 is away, so their turn ends here.']);
    expect(room.phase).toBe('turnEnd');
  });

  it('still ends the game when the last player in the order is away', () => {
    const { room, seats, start, drew, notices } = game(4);
    room.markDisconnected(seats[3]!.id);
    start();
    finish(room);
    expect(room.phase).toBe('gameEnd');
    // Each one there drew once a round, and the one away never did.
    expect(drew()).toEqual([0, 1, 2, 0, 1, 2]);
    expect(notices()).toEqual([
      "P3 is away, so they'll draw last this round.",
      'P3 is still away, so their turn is skipped.',
      "P3 is away, so they'll draw last this round.",
      'P3 is still away, so their turn is skipped.',
    ]);
  });

  it('lets someone away draw last in the round once they are back', () => {
    const { room, seats, start, drew, notices } = game(4);
    room.markDisconnected(seats[1]!.id);
    start();
    turn(room); // P0 drew; P1 is away, so P2 is up
    expect(notices()).toEqual(["P1 is away, so they'll draw last this round."]);
    room.reclaim(seats[1]!.token, 'sock1b');
    finish(room);
    expect(drew()).toEqual([0, 2, 3, 1, 0, 1, 2, 3]);
  });

  it('says so when someone put back left before their turn came', () => {
    const { room, seats, start, drew, notices } = game(4);
    room.markDisconnected(seats[1]!.id);
    start();
    turn(room);
    room.removePlayer(seats[1]!.id);
    finish(room);
    expect(drew()).toEqual([0, 2, 3, 0, 2, 3]);
    expect(notices()).toEqual([
      "P1 is away, so they'll draw last this round.",
      'P1 left, so their turn is skipped.',
    ]);
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
    const { room, seats, start, drew, notices } = game(4);
    start();
    turn(room); // P1 is choosing
    room.removePlayer(seats[1]!.id);
    expect(notices()).toEqual(['P1 left, so their turn ends here.']);
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
