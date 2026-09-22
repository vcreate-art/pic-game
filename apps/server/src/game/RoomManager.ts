import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@pic-game/shared';
import { Room } from './Room.js';
import { makeRoomCode } from './words.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly io: IO) {}

  create(): Room {
    let code = makeRoomCode();
    while (this.rooms.has(code)) code = makeRoomCode();
    const room = new Room(code, this.io);
    room.onEmpty = (r) => this.collect(r);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  private collect(room: Room): void {
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
