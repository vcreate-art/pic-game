import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@pic-game/shared';
import type { GameKind } from '@pic-game/shared';
import { FightRoom } from '../games/fight/FightRoom.js';
import { KungFuRoom } from '../games/kungfu/KungFuRoom.js';
import { RealmsRoom } from '../games/realms/RealmsRoom.js';
import { SkribblRoom } from '../games/skribbl/SkribblRoom.js';
import type { BaseRoom, CorePlayer } from './BaseRoom.js';
import { makeRoomCode } from './codes.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

/** Any game's room. Callers narrow on `kind`. */
export type AnyRoom = SkribblRoom | KungFuRoom | RealmsRoom | FightRoom;

export class RoomManager {
  private readonly rooms = new Map<string, AnyRoom>();

  constructor(private readonly io: IO) {}

  create(kind: GameKind = 'skribbl'): AnyRoom {
    let code = makeRoomCode();
    while (this.rooms.has(code)) code = makeRoomCode();
    const room: AnyRoom =
      kind === 'kungfu'
        ? new KungFuRoom(code, this.io)
        : kind === 'realms'
          ? new RealmsRoom(code, this.io)
          : kind === 'fight'
            ? new FightRoom(code, this.io)
            : new SkribblRoom(code, this.io);
    room.onEmpty = (r) => this.collect(r);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): AnyRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  private collect(room: BaseRoom<CorePlayer>): void {
    if (room.activeCount() > 0) return; // someone rejoined during the grace period
    room.destroy();
    this.rooms.delete(room.code);
  }

  get size(): number {
    return this.rooms.size;
  }

  stats(): { rooms: number; players: number } {
    let players = 0;
    for (const r of this.rooms.values()) players += r.activeCount();
    return { rooms: this.rooms.size, players };
  }
}
