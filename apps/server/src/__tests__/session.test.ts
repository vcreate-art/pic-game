import { describe, expect, it, vi } from 'vitest';
import type { RoomState } from '@pic-game/shared';
import { BaseRoom, type CorePlayer } from '../core/BaseRoom.js';
import { HANDOFF_MS, RoomSession, topScorers } from '../core/RoomSession.js';
import { fakeIO } from './fakeIO.js';

describe('RoomSession', () => {
  it('gives each tied winner a win and counts the game once', () => {
    const s = new RoomSession();
    s.record('flip7', ['a', 'b']);
    s.record('bingo', ['a']);
    expect(s.winsOf(['a', 'b', 'c'])).toEqual({ a: 2, b: 1 });
    expect(s.games).toBe(2);
  });

  it('counts a game nobody won without giving out wins', () => {
    const s = new RoomSession();
    s.record('maze', []);
    expect(s.winsOf(['a'])).toEqual({});
    expect(s.games).toBe(1);
  });

  it('ignores a repeated winner in one result', () => {
    const s = new RoomSession();
    s.record('race', ['a', 'a']);
    expect(s.winsOf(['a'])).toEqual({ a: 1 });
  });

  it('counts the game as played for everyone in it, winners included', () => {
    const s = new RoomSession();
    s.record('bingo', ['a'], ['a', 'b']);
    s.record('flip7', ['c'], ['a', 'b']);
    expect(s.playedOf(['a', 'b', 'c', 'd'])).toEqual({ a: 2, b: 2, c: 1 });
  });

  it('splits wins by game', () => {
    const s = new RoomSession();
    s.record('bingo', ['a'], ['a', 'b']);
    s.record('bingo', ['a', 'b'], ['a', 'b']);
    s.record('maze', ['a'], ['a', 'b']);
    expect(s.winsByGameOf(['a', 'b'])).toEqual({ a: { bingo: 2, maze: 1 }, b: { bingo: 1 } });
  });

  it('takes back the last result', () => {
    const s = new RoomSession();
    s.record('tourney', ['a']);
    s.record('tourney', ['a', 'b']);
    s.revokeLast();
    expect(s.winsOf(['a', 'b'])).toEqual({ a: 1 });
    expect(s.games).toBe(1);
    expect(s.history).toHaveLength(1);
  });

  it('takes back the played games and per-game wins too', () => {
    const s = new RoomSession();
    s.record('tourney', ['a'], ['a', 'b']);
    s.record('maze', ['b'], ['a', 'b', 'c']);
    s.revokeLast();
    expect(s.playedOf(['a', 'b', 'c'])).toEqual({ a: 1, b: 1 });
    expect(s.winsByGameOf(['a', 'b'])).toEqual({ a: { tourney: 1 } });
  });
});

describe('topScorers', () => {
  it('returns everyone tied on the best score', () => {
    expect(topScorers({ a: 3, b: 5, c: 5 })).toEqual(['b', 'c']);
  });

  it('returns nobody when the best score is zero', () => {
    expect(topScorers({ a: 0, b: 0 })).toEqual([]);
    expect(topScorers({})).toEqual([]);
  });
});

/** The least a game can be, to test what BaseRoom does on its own. */
class TestRoom extends BaseRoom<CorePlayer> {
  readonly kind = 'flip7' as const;
  get maxPlayers(): number {
    return 4;
  }
  protected get minPlayers(): number {
    return 1;
  }
  stage: 'lobby' | 'playing' | 'ended' = 'lobby';
  isLobby(): boolean {
    return this.stage === 'lobby';
  }
  lifecycle(): 'lobby' | 'playing' | 'ended' {
    return this.stage;
  }
  /** Moves the test game to a stage, as a game's own broadcast would. */
  go(stage: 'lobby' | 'playing' | 'ended'): void {
    this.stage = stage;
    this.syncMeta();
  }
  startGame(): void {}
  protected resetToLobby(): void {}
  protected createPlayer(base: CorePlayer): CorePlayer {
    return base;
  }
  publicState(): RoomState {
    return { kind: 'flip7', ...this.baseState(), game: null } as unknown as RoomState;
  }
  win(ids: (string | null)[]): void {
    this.recordWin(ids);
  }
}

describe('BaseRoom.recordWin', () => {
  it('records seated winners, skips missing ones and sends the new meta', () => {
    const { io, sent } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 's1');
    room.addPlayer('Ben', { color: 1, face: 1 }, 's2');

    room.win([a.id, 'gone', null]);

    expect(room.meta().wins).toEqual({ [a.id]: 1 });
    expect(room.meta().games).toBe(1);
    const meta = sent.filter((m) => m.event === 'room:meta');
    expect(meta.at(-1)?.args[0]).toMatchObject({ wins: { [a.id]: 1 }, games: 1 });
  });

  it('counts a game as played only for those there when it started', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 's1');
    const b = room.addPlayer('Ben', { color: 1, face: 1 }, 's2');
    room.go('playing');
    const c = room.addPlayer('Cat', { color: 2, face: 2 }, 's3');
    room.win([a.id]);
    room.go('ended');

    expect(room.meta().played).toEqual({ [a.id]: 1, [b.id]: 1 });
    expect(room.meta().winsByGame).toEqual({ [a.id]: { flip7: 1 } });

    room.go('playing');
    room.win([c.id]);
    expect(room.meta().played).toEqual({ [a.id]: 2, [b.id]: 2, [c.id]: 1 });
  });

  it('counts everyone here when no start was seen', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 's1');
    const b = room.addPlayer('Ben', { color: 1, face: 1 }, 's2');
    room.win([b.id]);
    expect(room.meta().played).toEqual({ [a.id]: 1, [b.id]: 1 });
  });

  it('carries the meta in the room snapshot', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 's1');
    room.win([a.id]);
    expect(room.publicState().meta.wins).toEqual({ [a.id]: 1 });
  });
});

describe('coming back to a room', () => {
  const ME = '11111111-1111-4111-8111-111111111111';

  it('reclaims a seat by its token however long it was away', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 's1');
    room.markDisconnected(a.id);
    a.disconnectedAt = Date.now() - 60 * 60_000;
    expect(room.reclaim(a.token, 's2')?.id).toBe(a.id);
  });

  it('finds an away seat by the browser after the tab was closed', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 's1', ME);
    room.win([a.id]);
    room.markDisconnected(a.id);
    const back = room.reclaimPerson(ME, 's2');
    expect(back?.id).toBe(a.id);
    expect(room.players.size).toBe(1);
    expect(room.meta().wins).toEqual({ [a.id]: 1 });
  });

  it('never takes over a seat that is still connected', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    room.addPlayer('Ana', { color: 0, face: 0 }, 's1', ME);
    expect(room.reclaimPerson(ME, 's2')).toBeNull();
  });

  it('keeps wins and games for someone who leaves and rejoins', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 's1', ME);
    room.addPlayer('Ben', { color: 1, face: 1 }, 's2');
    room.win([a.id]);
    room.removePlayer(a.id);

    const again = room.addPlayer('Ana', { color: 0, face: 0 }, 's3', ME);
    expect(again.id).not.toBe(a.id);
    expect(room.meta().wins).toEqual({ [again.id]: 1 });
    expect(room.meta().played[again.id]).toBe(1);
    expect(room.meta().winsByGame).toEqual({ [again.id]: { flip7: 1 } });
  });

  it("tells everyone else a rejoining player's record straight away", () => {
    const { io, sent } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 's1', ME);
    room.addPlayer('Ben', { color: 1, face: 1 }, 's2');
    room.win([a.id]);
    room.removePlayer(a.id);

    const again = room.addPlayer('Ana', { color: 0, face: 0 }, 's3', ME);
    const meta = sent.filter((m) => m.event === 'room:meta');
    expect(meta.at(-1)?.args[0]).toMatchObject({ wins: { [again.id]: 1 } });
  });

  it('lets a newer tab of the same browser take the seat over', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 's1', ME);
    room.win([a.id]);
    const took = room.takeOver(ME, 's2');
    expect(took?.seat.id).toBe(a.id);
    expect(took?.from).toBe('s1');
    expect(a.socketId).toBe('s2');
    expect(room.players.size).toBe(1);
    expect(room.meta().wins).toEqual({ [a.id]: 1 });
  });

  it('takes over nothing for a browser that has no seat here', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    room.addPlayer('Ana', { color: 0, face: 0 }, 's1', ME);
    expect(room.takeOver('22222222-2222-4222-8222-222222222222', 's2')).toBeNull();
  });
});

describe('handing a seat to another device', () => {
  const DESK = '11111111-1111-4111-8111-111111111111';
  const PHONE = '33333333-3333-4333-8333-333333333333';

  it('moves the seat, wins and all, to the device with the code', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 'desk', DESK);
    room.win([a.id]);
    const { token } = room.issueHandoff(a.id)!;
    const moved = room.useHandoff(token, PHONE, 'phone');
    expect(moved).toMatchObject({ from: 'desk', to: 'device' });
    expect(moved?.seat.id).toBe(a.id);
    expect(a.socketId).toBe('phone');
    expect(room.meta().wins).toEqual({ [a.id]: 1 });
  });

  it('carries the stats sent with the code, untouched', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 'desk', DESK);
    const { token } = room.issueHandoff(a.id, '{"v":2}')!;
    expect(room.useHandoff(token, PHONE, 'phone')?.stats).toBe('{"v":2}');
  });

  it('works once', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 'desk', DESK);
    const { token } = room.issueHandoff(a.id)!;
    room.useHandoff(token, PHONE, 'phone');
    expect(room.useHandoff(token, PHONE, 'phone2')).toBeNull();
  });

  it('runs out', () => {
    vi.useFakeTimers();
    try {
      const { io } = fakeIO();
      const room = new TestRoom('ABCDEF', io);
      const a = room.addPlayer('Ana', { color: 0, face: 0 }, 'desk', DESK);
      const { token } = room.issueHandoff(a.id)!;
      vi.advanceTimersByTime(HANDOFF_MS + 1);
      expect(room.useHandoff(token, PHONE, 'phone')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the first device take the seat back, and the phone after that', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 'desk', DESK);
    room.useHandoff(room.issueHandoff(a.id)!.token, PHONE, 'phone');
    expect(room.takeOver(DESK, 'desk2')).toMatchObject({ from: 'phone', to: 'device' });
    expect(room.takeOver(PHONE, 'phone2')).toMatchObject({ from: 'desk2', to: 'device' });
    expect(room.players.size).toBe(1);
  });

  it('keeps only the newest code for a seat', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 'desk', DESK);
    const first = room.issueHandoff(a.id)!.token;
    room.issueHandoff(a.id);
    expect(room.useHandoff(first, PHONE, 'phone')).toBeNull();
  });
});
