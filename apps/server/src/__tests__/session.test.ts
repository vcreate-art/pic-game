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

  it('takes back the last result', () => {
    const s = new RoomSession();
    s.record('tourney', ['a']);
    s.record('tourney', ['a', 'b']);
    s.revokeLast();
    expect(s.winsOf(['a', 'b'])).toEqual({ a: 1 });
    expect(s.games).toBe(1);
    expect(s.history).toHaveLength(1);
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
  isLobby(): boolean {
    return true;
  }
  lifecycle(): 'lobby' {
    return 'lobby';
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

  it('carries the meta in the room snapshot', () => {
    const { io } = fakeIO();
    const room = new TestRoom('ABCDEF', io);
    const a = room.addPlayer('Ana', { color: 0, face: 0 }, 's1');
    room.win([a.id]);
    expect(room.publicState().meta.wins).toEqual({ [a.id]: 1 });
  });
});
