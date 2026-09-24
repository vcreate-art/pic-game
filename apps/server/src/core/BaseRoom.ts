import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import type {
  Avatar, ChatMessage, ClientToServerEvents, GameKind, Player, RoomState,
  ServerToClientEvents,
} from '@pic-game/shared';
import { EMPTY_ROOM_TTL_MS, RECONNECT_GRACE_MS } from '../config.js';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

/** What every game needs to know about a seat, whatever the game is. */
export interface CorePlayer extends Player {
  /** Secret bearer token; proves seat ownership across reconnects. */
  token: string;
  socketId: string | null;
  disconnectedAt: number | null;
}

/**
 * Everything a room needs regardless of which game is being played: seats,
 * host, presence, reconnection, chat plumbing, removal and collection.
 *
 * Games subclass this and fill in the hooks below. A base class rather than a
 * plugin object on purpose — the game needs the seat list and the emit helpers
 * on nearly every line, and threading a room reference through all of it buys
 * indirection without buying separation.
 */
export abstract class BaseRoom<P extends CorePlayer = CorePlayer> {
  readonly code: string;
  hostId = '';
  readonly players = new Map<string, P>();
  /** Join order, which games may also use as turn order. */
  order: string[] = [];

  /**
   * Seat tokens the host has removed.
   *
   * With no accounts a kick is a soft block: it stops the client reconnecting
   * and stops a return through the invite link on the same seat, which covers
   * ordinary nuisance. Someone determined can clear their session and come back
   * as a new player. Keying on IP would be stronger but would eject everyone
   * behind the same router, which is how this gets played over home Wi-Fi.
   */
  private readonly banned = new Set<string>();

  /** Set when the room empties; cancelled the moment someone joins. */
  emptyTimer: ReturnType<typeof setTimeout> | null = null;
  destroyed = false;
  /** Set by RoomManager so the room can ask to be collected. */
  onEmpty?: (room: BaseRoom<CorePlayer>) => void;

  constructor(code: string, protected readonly io: IO) {
    this.code = code;
  }

  // ---------------------------------------------------------------- game hooks

  /** Which game this room is running. Fixed at creation. */
  abstract readonly kind: GameKind;
  /** Capacity, which each game sets for itself. */
  abstract get maxPlayers(): number;
  /** The full snapshot sent on join and reconnect. */
  abstract publicState(): RoomState;
  /** Games that are mid-play should say so; the lobby is handled generically. */
  abstract isLobby(): boolean;
  /** Below this, an in-progress game gives up and returns to the lobby. */
  protected abstract get minPlayers(): number;
  /** Adds whatever per-game fields a seat needs on top of the core ones. */
  protected abstract createPlayer(base: CorePlayer): P;

  protected onPlayerReconnected(_player: P): void {}
  /** Return true if the game dealt with the departure itself (ended a turn,
   *  say) and the generic follow-up should be skipped. */
  protected onPlayerDisconnected(_player: P): boolean {
    return false;
  }
  protected onPlayerRemoved(_playerId: string): boolean {
    return false;
  }
  protected onTooFewPlayers(): void {}
  protected onDestroy(): void {}

  // ------------------------------------------------------------------ players

  addPlayer(name: string, avatar: Avatar, socketId: string): P {
    const player = this.createPlayer({
      id: randomUUID(),
      token: randomUUID(),
      name,
      avatar,
      score: 0,
      connected: true,
      socketId,
      disconnectedAt: null,
    });
    this.players.set(player.id, player);
    this.order.push(player.id);
    if (!this.hostId) this.hostId = player.id;
    this.cancelEmptyCollection();
    return player;
  }

  /** Rebinds an existing seat to a new socket. Socket.IO issues a fresh
   *  socket.id on every reconnect, so without this a refresh would clone the
   *  player and zero their score. */
  reclaim(token: string, socketId: string): P | null {
    for (const p of this.players.values()) {
      if (p.token !== token) continue;
      if (p.connected) return null; // token in use by a live socket
      if (p.disconnectedAt && Date.now() - p.disconnectedAt > RECONNECT_GRACE_MS) return null;
      p.socketId = socketId;
      p.connected = true;
      p.disconnectedAt = null;
      this.onPlayerReconnected(p);
      this.cancelEmptyCollection();
      return p;
    }
    return null;
  }

  markDisconnected(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    p.disconnectedAt = Date.now();
    this.io.to(this.code).emit('player:updated', this.publicPlayer(p));

    this.onPlayerDisconnected(p);
    if (this.activeCount() === 0) this.scheduleEmptyCollection();
  }

  removePlayer(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    this.players.delete(playerId);
    this.order = this.order.filter((id) => id !== playerId);
    this.io.to(this.code).emit('player:left', { id: playerId });

    if (this.hostId === playerId) {
      this.hostId = this.order[0] ?? '';
      if (this.hostId) this.io.to(this.code).emit('host:changed', { hostId: this.hostId });
    }

    this.onPlayerRemoved(playerId);
    if (this.players.size < this.minPlayers && !this.isLobby()) this.onTooFewPlayers();
    if (this.activeCount() === 0) this.scheduleEmptyCollection();
  }

  /**
   * Removes a player at the host's request. Everything after the ban is the
   * ordinary leave path, so a removed drawer ends the turn and a removed host
   * hands over — the same handling a disconnect already gets.
   */
  kick(byPlayerId: string, targetId: string): void {
    if (byPlayerId !== this.hostId) return;
    if (byPlayerId === targetId) return; // the host cannot kick themselves
    const target = this.players.get(targetId);
    if (!target) return;

    const host = this.players.get(byPlayerId);
    this.banned.add(target.token);
    // Told before removal, while the socket is still in the room.
    this.emitTo(targetId, 'kicked', { by: host?.name ?? 'the host' });
    this.systemMessage(`${target.name} was removed by ${host?.name ?? 'the host'}.`);
    this.removePlayer(targetId);
  }

  /** A player renames themselves, or changes their avatar. The seat, score and
   *  everything else stay put: only how they are shown changes. */
  rename(playerId: string, name: string, avatar: Avatar): void {
    const p = this.players.get(playerId);
    if (!p) return;
    const was = p.name;
    p.name = name;
    p.avatar = avatar;
    this.io.to(this.code).emit('player:updated', this.publicPlayer(p));
    if (was !== name) this.systemMessage(`${was} is now ${name}.`);
  }

  isBanned(token: string | undefined): boolean {
    return !!token && this.banned.has(token);
  }

  activeCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  protected connectedPlayers(): P[] {
    return [...this.players.values()].filter((p) => p.connected);
  }

  private scheduleEmptyCollection(): void {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = setTimeout(() => this.onEmpty?.(this), EMPTY_ROOM_TTL_MS);
  }

  private cancelEmptyCollection(): void {
    if (!this.emptyTimer) return;
    clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
  }

  // ------------------------------------------------------------------- comms

  protected socketOf(playerId: string): string | null {
    return this.players.get(playerId)?.socketId ?? null;
  }

  protected emitTo<E extends keyof ServerToClientEvents>(
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    const sid = this.socketOf(playerId);
    if (sid) this.io.to(sid).emit(event, ...args);
  }

  protected broadcastChat(m: Omit<ChatMessage, 'id' | 'at'>): void {
    this.io.to(this.code).emit('chat:message', { ...m, id: randomUUID(), at: Date.now() });
  }

  systemMessage(text: string): void {
    this.broadcastChat({ kind: 'system', text });
  }

  emitError(playerId: string, code: string, message: string): void {
    this.emitTo(playerId, 'error', { code, message });
  }

  protected publicPlayer(p: P): Player {
    return { id: p.id, name: p.name, avatar: p.avatar, score: p.score, connected: p.connected };
  }

  publicPlayers(): Player[] {
    return this.order
      .map((id) => this.players.get(id))
      .filter((p): p is P => !!p)
      .map((p) => this.publicPlayer(p));
  }

  destroy(): void {
    this.onDestroy();
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
    this.destroyed = true;
  }
}
