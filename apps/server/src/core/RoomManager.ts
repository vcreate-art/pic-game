import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@pic-game/shared';
import { SkribblRoom } from '../games/skribbl/SkribblRoom.js';
import type { BaseRoom, CorePlayer } from './BaseRoom.js';
import { makeRoomCode } from './codes.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

export class RoomManager {
  private readonly rooms = new Map<string, SkribblRoom>();

  constructor(private readonly io: IO) {}

  create(): SkribblRoom {
    let code = makeRoomCode();
    while (this.rooms.has(code)) code = makeRoomCode();
    const room = new SkribblRoom(code, this.io);
    room.onEmpty = (r) => this.collect(r);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): SkribblRoom | undefined {
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
