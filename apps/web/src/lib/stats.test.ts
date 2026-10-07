import { describe, expect, it } from 'vitest';
import { countGame, emptyDevice, emptyStored, mergeStored, readStored, totals, type Stored } from './stats.js';

const game = (over: Partial<Parameters<typeof countGame>[1]> = {}) => ({
  kind: 'bingo' as const, won: false, hosted: false, players: 2, day: '2026-10-08', ...over,
});

/** A device's store after it plays some games. */
function played(me: string, games: Parameters<typeof countGame>[1][], from: Stored = emptyStored()): Stored {
  const s = structuredClone(from);
  const d = (s.devices[me] ??= emptyDevice());
  for (const g of games) countGame(d, g);
  return s;
}

describe('readStored', () => {
  it('turns stats from before devices had shares into this device’s share', () => {
    const old = { played: { bingo: 3 }, won: { bingo: 1 }, hosted: 1, biggestRoom: 4, streak: 1, bestStreak: 2, unlocked: { 'first-game': 5 } };
    const s = readStored(old, 'desk');
    expect(totals(s, 'desk')).toMatchObject({ played: { bingo: 3 }, won: { bingo: 1 }, hosted: 1, bestStreak: 2, unlocked: { 'first-game': 5 } });
  });

  it('drops what is malformed, since it may have come over the wire', () => {
    const s = readStored({ v: 2, devices: { x: { played: { bingo: -4, maze: 'lots' }, hosted: Infinity, nights: { bingo: [{ day: 'soon', played: 9 }] } } }, unlocked: { a: 'x' } }, 'me');
    expect(totals(s, 'me')).toMatchObject({ played: {}, hosted: 0, nights: {}, unlocked: {} });
    expect(readStored('nonsense', 'me')).toEqual(emptyStored());
  });
});

describe('totals', () => {
  it('adds the devices up', () => {
    const s = mergeStored(
      played('desk', [game({ won: true }), game()]),
      played('phone', [game({ kind: 'maze', won: true, players: 6 })]),
    );
    const t = totals(s, 'phone');
    expect(t.played).toEqual({ bingo: 2, maze: 1 });
    expect(t.won).toEqual({ bingo: 1, maze: 1 });
    expect(t.biggestRoom).toBe(6);
  });

  it('adds up nights played on the same day on both', () => {
    const s = mergeStored(played('desk', [game({ won: true })]), played('phone', [game(), game()]));
    expect(totals(s, 'desk').nights.bingo).toEqual([{ day: '2026-10-08', played: 3, won: 1 }]);
  });

  it('keeps the current streak to the device it is on', () => {
    const s = mergeStored(played('desk', [game({ won: true }), game({ won: true })]), played('phone', [game()]));
    expect(totals(s, 'desk').streak).toBe(2);
    expect(totals(s, 'phone').streak).toBe(0);
    expect(totals(s, 'phone').bestStreak).toBe(2);
  });
});

describe('mergeStored', () => {
  it('never counts a game twice, however often the stats move back and forth', () => {
    let desk = played('desk', [game(), game()]);
    let phone = mergeStored(emptyStored(), desk); // to the phone
    phone = played('phone', [game()], phone);
    desk = mergeStored(desk, phone); // and back
    desk = played('desk', [game()], desk);
    phone = mergeStored(phone, desk); // to the phone again
    desk = mergeStored(desk, phone); // and back again
    expect(totals(desk, 'desk').played.bingo).toBe(4);
    expect(totals(phone, 'phone').played.bingo).toBe(4);
  });

  it('keeps the newer copy of a device’s share', () => {
    const older = played('desk', [game()]);
    const newer = played('desk', [game()], older);
    expect(totals(mergeStored(newer, older), 'desk').played.bingo).toBe(2);
    expect(totals(mergeStored(older, newer), 'desk').played.bingo).toBe(2);
  });

  it('keeps the earliest date a badge was earned', () => {
    const a = { ...emptyStored(), unlocked: { 'first-win': 200, regular: 50 } };
    const b = { ...emptyStored(), unlocked: { 'first-win': 100 } };
    expect(mergeStored(a, b).unlocked).toEqual({ 'first-win': 100, regular: 50 });
  });
});
