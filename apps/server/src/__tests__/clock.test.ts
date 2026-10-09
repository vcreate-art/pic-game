import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomClock } from '../core/RoomClock.js';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('room clock', () => {
  it('reads and runs like real time when left alone', () => {
    const clock = new RoomClock();
    const ran: number[] = [];
    clock.after(1000, () => ran.push(clock.now()));
    expect(clock.now()).toBe(Date.now());
    vi.advanceTimersByTime(999);
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual([Date.now()]);
    expect(clock.mapping()).toBeNull();
  });

  it('holds still while frozen, timers and all', () => {
    const clock = new RoomClock();
    const fn = vi.fn();
    clock.after(1000, fn);
    clock.setSpeed(0);
    const at = clock.now();
    vi.advanceTimersByTime(60_000);
    expect(fn).not.toHaveBeenCalled();
    expect(clock.now()).toBe(at);
    clock.setSpeed(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('runs faster at a higher speed', () => {
    const clock = new RoomClock();
    const fn = vi.fn();
    const start = clock.now();
    clock.after(10_000, fn);
    clock.setSpeed(10);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledOnce();
    expect(clock.now() - start).toBe(10_000);
  });

  it('steps on, running each timer due at its own moment, in order', () => {
    const clock = new RoomClock();
    clock.setSpeed(0);
    const start = clock.now();
    const seen: [string, number][] = [];
    clock.after(3000, () => seen.push(['b', clock.now() - start]));
    clock.after(1000, () => {
      seen.push(['a', clock.now() - start]);
      // A timer set by another one still runs within the same step.
      clock.after(500, () => seen.push(['c', clock.now() - start]));
    });
    clock.advance(5000);
    expect(seen).toEqual([['a', 1000], ['c', 1500], ['b', 3000]]);
    expect(clock.now() - start).toBe(5000);
  });

  it('repeats a repeating timer on every interval stepped past', () => {
    const clock = new RoomClock();
    clock.setSpeed(0);
    const fn = vi.fn();
    clock.every(1000, fn);
    clock.advance(3500);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(clock.pending()[0]!.inMs).toBe(500);
  });

  it('finds the next timer due, and forgets one cancelled', () => {
    const clock = new RoomClock();
    clock.setSpeed(0);
    const fn = vi.fn();
    const h = clock.after(2000, fn, 'first');
    clock.after(4000, () => {}, 'second');
    expect(clock.nextDue()! - clock.now()).toBe(2000);
    clock.cancel(h);
    expect(clock.pending().map((p) => p.label)).toEqual(['second']);
    clock.advance(2000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('gives clients what they need to follow it once touched', () => {
    const clock = new RoomClock();
    clock.setSpeed(2);
    const m = clock.mapping()!;
    vi.advanceTimersByTime(1000);
    expect(m.at + (Date.now() - m.wall) * m.rate).toBe(clock.now());
  });
});
