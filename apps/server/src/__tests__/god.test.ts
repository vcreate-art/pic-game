import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHOOSE_SECONDS } from '@pic-game/shared';
import { GAME_COUNTDOWN_MS, TURN_END_SECONDS } from '../config.js';
import { RoomManager } from '../core/RoomManager.js';
import type { SkribblRoom } from '../games/skribbl/SkribblRoom.js';
import { godAct, godKeyOk } from '../god/index.js';
import { fakeIO } from './fakeIO.js';

const av = { color: 0, face: 0 };

/** A Draw & Guess game of three, two rounds, just past its count-in. Uses fake timers. */
function game(words?: string[]) {
  vi.useFakeTimers();
  const { io, sent } = fakeIO();
  const room = new RoomManager(io).create('skribbl') as SkribblRoom;
  room.updateSettings({ rounds: 2, drawTime: 30 });
  if (words) {
    room.setWords(words.join('\n'));
    room.updateSettings({ wordSource: 'custom' });
  }
  const seats = Array.from({ length: 3 }, (_, i) => room.addPlayer(`P${i}`, av, `sock${i}`));
  room.startGame(seats[0]!.id);
  vi.advanceTimersByTime(GAME_COUNTDOWN_MS);
  return { room, seats, sent };
}

const act = (room: SkribblRoom, action: Parameters<typeof godAct>[1]) => expect(godAct(room, action)).toEqual({ ok: true });

afterEach(() => {
  vi.useRealTimers();
});

describe('god key', () => {
  it('takes only the key set, and lets nobody in on production without one', () => {
    expect(godKeyOk('s3cret', 's3cret', true)).toBe(true);
    expect(godKeyOk('nope', 's3cret', true)).toBe(false);
    expect(godKeyOk(undefined, 's3cret', false)).toBe(false);
    expect(godKeyOk(undefined, undefined, false)).toBe(true);
    expect(godKeyOk('anything', undefined, true)).toBe(false);
  });
});

describe('god mode on Draw & Guess', () => {
  it('holds a frozen game where it is, however long passes', () => {
    const { room } = game();
    act(room, { kind: 'speed', speed: 0 });
    expect(room.phase).toBe('choosing');
    vi.advanceTimersByTime(10 * 60_000);
    expect(room.phase).toBe('choosing');
  });

  it('steps a frozen game through its states a tick at a time', () => {
    const { room } = game();
    act(room, { kind: 'speed', speed: 0 });
    act(room, { kind: 'step', ticks: CHOOSE_SECONDS - 1 });
    expect(room.phase).toBe('choosing');
    act(room, { kind: 'step', ticks: 1 });
    expect(room.phase).toBe('drawing'); // the word was picked for them
    act(room, { kind: 'step', ticks: room.settings.drawTime });
    expect(room.phase).toBe('turnEnd');
    act(room, { kind: 'step', ticks: TURN_END_SECONDS });
    expect(room.phase).toBe('choosing');
    expect(room.godDetails().turnIndex).toBe(1);
  });

  it('jumps to whatever is due next', () => {
    const { room } = game();
    act(room, { kind: 'speed', speed: 0 });
    act(room, { kind: 'next' });
    expect(room.phase).toBe('drawing');
    // Drawing has a hint check every second ahead of the turn running out.
    act(room, { kind: 'next' });
    expect(room.phase).toBe('drawing');
  });

  it('reveals hints on the ticks they are due', () => {
    // Long words only: a short one is allowed fewer hints, which moves the first.
    const { room } = game([
      'elephant', 'umbrella', 'pineapple', 'butterfly', 'mountain',
      'calendar', 'dinosaur', 'keyboard', 'sandwich', 'treasure',
    ]);
    act(room, { kind: 'speed', speed: 0 });
    act(room, { kind: 'next' }); // into drawing, with 2 hints over 30s: at 10s and 20s
    const shown = () => room.godDetails().hintsShown;
    act(room, { kind: 'step', ticks: 9 });
    expect(shown()).toBe(0);
    act(room, { kind: 'step', ticks: 1 });
    expect(shown()).toBe(1);
  });

  it('runs a whole game faster at a higher speed', () => {
    const { room } = game();
    act(room, { kind: 'speed', speed: 10 });
    const turn = (CHOOSE_SECONDS + room.settings.drawTime + TURN_END_SECONDS) * 1000;
    vi.advanceTimersByTime((6 * turn) / 10 + 1000);
    expect(room.phase).toBe('gameEnd');
  });

  it('ends a round, or the game, through the turn end as it would have', () => {
    const { room } = game();
    act(room, { kind: 'endRound' });
    expect(room.phase).toBe('turnEnd');
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000 + 100);
    expect(room.round).toBe(2);
    expect(room.phase).toBe('choosing');
    act(room, { kind: 'endGame' });
    vi.advanceTimersByTime(TURN_END_SECONDS * 1000 + 100);
    expect(room.phase).toBe('gameEnd');
  });

  it('keeps a timeline of what happened, its own actions included', () => {
    const { room } = game();
    act(room, { kind: 'skipTurn' });
    const lines = room.timeline().map((e) => e.text);
    expect(lines).toContain('god: skip the turn');
    expect(lines).toContain('turn over (timeout)');
    expect(lines.some((l) => l.startsWith('round 1: P0 is choosing'))).toBe(true);
  });

  it('sends players the clock once it has changed, so their countdowns follow', () => {
    const { room, sent } = game();
    expect(room.meta().clock).toBeNull();
    act(room, { kind: 'speed', speed: 0 });
    const meta = sent.filter((m) => m.event === 'room:meta').at(-1)!.args[0] as { clock: { rate: number } };
    expect(meta.clock.rate).toBe(0);
  });

  it('turns away a speed not on offer and a step too big', () => {
    const { room } = game();
    expect(godAct(room, { kind: 'speed', speed: 1000 }).ok).toBe(false);
    expect(godAct(room, { kind: 'step', ticks: 100_000 }).ok).toBe(false);
  });
});
