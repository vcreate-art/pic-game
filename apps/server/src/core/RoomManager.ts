import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@pic-game/shared';
import { GAME_CAPACITY, GAME_LABELS, PLAYABLE_KINDS, type BackstageRoom, type GameKind } from '@pic-game/shared';
import { FightRoom } from '../games/fight/FightRoom.js';
import { KungFuRoom } from '../games/kungfu/KungFuRoom.js';
import { RaceRoom } from '../games/race/RaceRoom.js';
import { RealmsRoom } from '../games/realms/RealmsRoom.js';
import { SpiesRoom } from '../games/spies/SpiesRoom.js';
import { BingoRoom } from '../games/bingo/BingoRoom.js';
import { CryptidRoom } from '../games/cryptid/CryptidRoom.js';
import { Flip7Room } from '../games/flip7/Flip7Room.js';
import { MazeRoom } from '../games/maze/MazeRoom.js';
import { TourneyRoom } from '../games/tourney/TourneyRoom.js';
import { SkribblRoom } from '../games/skribbl/SkribblRoom.js';
import type { BaseRoom, CorePlayer } from './BaseRoom.js';
import { makeRoomCode } from './codes.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

/** Any game's room. Callers narrow on `kind`. */
export type AnyRoom =
  | SkribblRoom | KungFuRoom | RealmsRoom | FightRoom | RaceRoom | SpiesRoom | BingoRoom | CryptidRoom | Flip7Room | MazeRoom | TourneyRoom;

export class RoomManager {
  private readonly rooms = new Map<string, AnyRoom>();

  constructor(private readonly io: IO) {}

  create(kind: GameKind = 'skribbl'): AnyRoom {
    let code = makeRoomCode();
    while (this.rooms.has(code)) code = makeRoomCode();
    const room = this.build(kind, code);
    this.rooms.set(code, room);
    return room;
  }

  /**
   * Swaps the game a room is playing, keeping its code, seats, host and
   * session, so everyone stays where they are. Only the host may, only
   * between games, and only into a game that seats everyone here.
   */
  switchKind(code: string, kind: GameKind, by: string): { ok: true } | { ok: false; message: string } {
    const old = this.get(code);
    if (!old) return { ok: false, message: 'That room has closed.' };
    if (old.hostId !== by) return { ok: false, message: 'Only the host can switch games.' };
    if (!PLAYABLE_KINDS.includes(kind)) return { ok: false, message: 'That game is not available.' };
    if (kind === old.kind) return { ok: false, message: `You're already playing ${GAME_LABELS[kind].name}.` };
    if (!old.canSwitch()) return { ok: false, message: 'Finish or end this game first.' };
    if (old.players.size > GAME_CAPACITY[kind]) {
      return {
        ok: false,
        message: `${GAME_LABELS[kind].name} seats ${GAME_CAPACITY[kind]}, and ${old.players.size} are here.`,
      };
    }

    const next = this.build(kind, old.code);
    next.adoptFrom(old);
    this.rooms.set(old.code, next);
    // Nothing of the old game may act on the room from here: no empty-room
    // collection, and destroy() stops every timer the game had running.
    old.onEmpty = undefined;
    old.destroy();

    next.broadcastSnapshot();
    next.systemMessage(`Switched to ${GAME_LABELS[kind].name}.`);
    return { ok: true };
  }

  /** A fresh room of the given game under the given code. */
  private build(kind: GameKind, code: string): AnyRoom {
    const room: AnyRoom =
      kind === 'kungfu'
        ? new KungFuRoom(code, this.io)
        : kind === 'realms'
          ? new RealmsRoom(code, this.io)
          : kind === 'fight'
            ? new FightRoom(code, this.io)
            : kind === 'race'
              ? new RaceRoom(code, this.io)
              : kind === 'spies'
                ? new SpiesRoom(code, this.io)
                : kind === 'bingo'
                  ? new BingoRoom(code, this.io)
                  : kind === 'cryptid'
                    ? new CryptidRoom(code, this.io)
                    : kind === 'flip7'
                      ? new Flip7Room(code, this.io)
                      : kind === 'maze'
                        ? new MazeRoom(code, this.io)
                        : kind === 'tourney'
                          ? new TourneyRoom(code, this.io)
                          : new SkribblRoom(code, this.io);
    room.onEmpty = (r) => this.collect(r);
    return room;
  }

  get(code: string): AnyRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  private collect(room: BaseRoom<CorePlayer>): void {
    // A game swapped out by switchKind no longer owns the code.
    if (this.rooms.get(room.code) !== room) return;
    if (room.activeCount() > 0) return; // someone rejoined during the grace period
    room.destroy();
    this.rooms.delete(room.code);
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Every live room for the backstage dashboard: who is in it and how far
   *  the game has got, without the code that would let someone join. */
  backstage(): BackstageRoom[] {
    return [...this.rooms.values()].map((room) => {
      const state = room.publicState();
      return {
        id: room.uid,
        kind: room.kind,
        phase: state.kind === 'skribbl' ? state.phase : state.game.phase,
        inLobby: room.isLobby(),
        createdAt: room.createdAt,
        maxPlayers: room.maxPlayers,
        players: state.players.map((p) => ({
          name: p.name, avatar: p.avatar, score: p.score, connected: p.connected, host: p.id === room.hostId,
        })),
      };
    });
  }

  stats(): { rooms: number; players: number } {
    let players = 0;
    for (const r of this.rooms.values()) players += r.activeCount();
    return { rooms: this.rooms.size, players };
  }
}
