import { describe, expect, it } from 'vitest';
import type { RoomState } from '@pic-game/shared';
import { BaseRoom, type CorePlayer } from '../core/BaseRoom.js';
import { RoomSession, topScorers } from '../core/RoomSession.js';
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
