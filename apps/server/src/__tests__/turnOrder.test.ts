import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHOOSE_SECONDS } from '@pic-game/shared';
import { GAME_COUNTDOWN_MS, TURN_END_SECONDS } from '../config.js';
import { RoomManager } from '../core/RoomManager.js';
import type { SkribblRoom } from '../games/skribbl/SkribblRoom.js';
import { fakeIO } from './fakeIO.js';

const av = { color: 0, face: 0 };

afterEach(() => {
  vi.useRealTimers();
});

describe('turn order', () => {
  it('still ends the game when the last player in the order is away', () => {
    vi.useFakeTimers();
    const { io, sent } = fakeIO();
    const room = new RoomManager(io).create('skribbl') as SkribblRoom;
    room.updateSettings({ rounds: 2, drawTime: 30 });
    const seats = Array.from({ length: 4 }, (_, i) => room.addPlayer(`P${i}`, av, `sock${i}`));
    room.markDisconnected(seats[3]!.id);
    room.startGame(seats[0]!.id);
    vi.advanceTimersByTime(GAME_COUNTDOWN_MS);

    // Every turn runs out its clocks: choosing, drawing, then the reveal.
    const turn = (CHOOSE_SECONDS + room.settings.drawTime + TURN_END_SECONDS) * 1000 + 100;
    for (let i = 0; i < 20 && room.phase !== 'gameEnd'; i++) vi.advanceTimersByTime(turn);

    expect(room.phase).toBe('gameEnd');
    // Each one there drew once a round, and the one away never did.
    const drew = sent
      .filter((m) => m.event === 'turn:choosing' && m.to === room.code)
      .map((m) => (m.args[0] as { drawerId: string }).drawerId);
    expect(drew).toEqual([0, 1, 2, 0, 1, 2].map((i) => seats[i]!.id));
  });
});
