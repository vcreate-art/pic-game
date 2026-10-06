import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import type {
  Avatar, ChatMessage, ClientToServerEvents, GameKind, Player, RoomMeta, RoomPause, RoomState,
  RoomStateBase, ServerToClientEvents,
} from '@pic-game/shared';
import { EMPTY_ROOM_TTL_MS, PAUSE_HOST_AWAY_MS, RECONNECT_GRACE_MS } from '../config.js';
import { RoomSession } from './RoomSession.js';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

/** Where a room is in its game, in the terms every game shares: getting
 *  ready, in the middle of one, or looking at the result. */
export type RoomLifecycle = 'lobby' | 'playing' | 'ended';

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
  /** Names the room where the code must not appear, such as the backstage
   *  dashboard. Random, so it says nothing about the code. */
  readonly uid = randomUUID();
  readonly createdAt = Date.now();
  hostId = '';
  readonly players = new Map<string, P>();
  /** Join order, which games may also use as turn order. */
  order: string[] = [];

  /** Set while the host has the game paused. */
  private roomPause: RoomPause | null = null;
  /** Resumes a paused game whose host has dropped out. */
  private pauseAwayTimer: ReturnType<typeof setTimeout> | null = null;

  /** Wins, kicks and history that outlive this game. Handed on when the
   *  room switches to a different game. */
  session = new RoomSession();

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
  /** Each game's own phases, mapped onto the shared three. */
  abstract lifecycle(): RoomLifecycle;
  /** Starts a game from the lobby (host only), or explains why it can't. */
  abstract startGame(by: string): void;
  /** Drops whatever game is on and goes back to the lobby, keeping the
   *  seats and settings. Stops every timer the game had running. */
  protected abstract resetToLobby(): void;
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

  /** How long a room with nobody connected is kept. Games that run for hours
   *  between visits, like a tournament, keep theirs longer. */
  protected get emptyTtlMs(): number {
    return EMPTY_ROOM_TTL_MS;
  }
  /** How long a dropped player may come back and reclaim their seat. */
  protected get reconnectGraceMs(): number {
    return RECONNECT_GRACE_MS;
  }
  protected onDestroy(): void {}

  /** Whether this game can pause at all. Games turn it on as their pause
   *  support lands; the rest never offer it. */
  protected get pausable(): boolean {
    return false;
  }
  /** Called once a game is paused: stop whatever runs on its own. */
  protected onPause(): void {}
  /** Called on resume with how long the game was paused, to restart what
   *  onPause stopped and push its deadlines back by that much. */
  protected onResume(_pausedMs: number): void {}

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
      if (p.disconnectedAt && Date.now() - p.disconnectedAt > this.reconnectGraceMs) return null;
      p.socketId = socketId;
      p.connected = true;
      p.disconnectedAt = null;
      if (p.id === this.hostId) this.clearPauseAway();
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
    // Only the host can resume, so a host who drops out mustn't leave the
    // game stuck. The pause may already be gone if the drop ended the game.
    if (this.roomPause && playerId === this.hostId) {
      this.clearPauseAway();
      this.pauseAwayTimer = setTimeout(
        () => this.resumeNow('The host is away, so the game carries on.'),
        PAUSE_HOST_AWAY_MS,
      );
    }
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
      // The new host can resume a paused game; no need to wait out the old one.
      this.clearPauseAway();
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
    this.session.banned.add(target.token);
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
    return !!token && this.session.banned.has(token);
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
    this.emptyTimer = setTimeout(() => this.onEmpty?.(this), this.emptyTtlMs);
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

  /** Room-level facts every game's state carries. */
  meta(): RoomMeta {
    return {
      wins: this.session.winsOf(this.players.keys()),
      games: this.session.games,
      paused: this.roomPause,
      can: {
        pause: this.canPause(),
        restart: this.lifecycle() !== 'lobby',
        toLobby: this.lifecycle() !== 'lobby',
        switch: this.canSwitch(),
      },
    };
  }

  get isPaused(): boolean {
    return !!this.roomPause;
  }

  /** Only mid-game, and only in a game that supports it. */
  canPause(): boolean {
    return this.pausable && this.lifecycle() === 'playing';
  }

  /** Host only: stops the game where it is until the host resumes it. */
  pauseGame(by: string): void {
    if (by !== this.hostId || this.roomPause || !this.canPause()) return;
    this.roomPause = { by, at: Date.now() };
    this.onPause();
    this.systemMessage(`${this.players.get(by)?.name ?? 'The host'} paused the game.`);
    this.emitMeta();
  }

  /** Host only: carries on from exactly where the game stopped. */
  resumeGame(by: string): void {
    if (by !== this.hostId || !this.roomPause) return;
    this.resumeNow('Back to the game.');
  }

  private resumeNow(message: string): void {
    const paused = this.roomPause;
    if (!paused) return;
    this.roomPause = null;
    this.clearPauseAway();
    this.onResume(Date.now() - paused.at);
    this.systemMessage(message);
    this.emitMeta();
  }

  /** Forgets a pause without resuming the game, for when the game it paused
   *  is over or being thrown away. */
  private dropPause(): void {
    this.roomPause = null;
    this.clearPauseAway();
  }

  private clearPauseAway(): void {
    if (this.pauseAwayTimer) clearTimeout(this.pauseAwayTimer);
    this.pauseAwayTimer = null;
  }

  /** Host only: the same game again from the start, with the same players
   *  and settings. Abandons a game in progress without recording a result. */
  restart(by: string): void {
    if (by !== this.hostId || this.lifecycle() === 'lobby') return;
    const midGame = this.lifecycle() === 'playing';
    this.dropPause();
    this.resetToLobby();
    if (midGame) this.systemMessage('The host restarted the game.');
    this.startGame(by);
    this.syncMeta();
  }

  /** Host only: back to the lobby, abandoning a game in progress without
   *  recording a result. */
  backToLobby(by: string): void {
    if (by !== this.hostId || this.lifecycle() === 'lobby') return;
    const midGame = this.lifecycle() === 'playing';
    this.dropPause();
    this.resetToLobby();
    if (midGame) this.systemMessage('The host ended the game.');
    this.syncMeta();
  }

  /** Switching games is only allowed between them, never mid-game. */
  canSwitch(): boolean {
    return this.lifecycle() !== 'playing';
  }

  /**
   * Takes over the table from the room this one replaces when the host
   * switches games: the same seats, host, order and session. Each seat is
   * rebuilt through this game's own createPlayer, and starts this game on 0.
   */
  adoptFrom(old: BaseRoom<CorePlayer>): void {
    this.session = old.session;
    this.hostId = old.hostId;
    this.order = old.order.filter((id) => old.players.has(id));
    for (const id of this.order) {
      const p = old.players.get(id)!;
      this.players.set(id, this.createPlayer({
        id: p.id, token: p.token, name: p.name, avatar: p.avatar, score: 0,
        connected: p.connected, socketId: p.socketId, disconnectedAt: p.disconnectedAt,
      }));
    }
    if (this.activeCount() === 0) this.scheduleEmptyCollection();
  }

  /** The meta as last sent, to tell when it has changed. */
  private sentMeta = '';

  /** Sends the room-level facts on their own. Most games broadcast only their
   *  own state, which doesn't carry them. */
  protected emitMeta(): void {
    const meta = this.meta();
    this.sentMeta = JSON.stringify(meta);
    this.io.to(this.code).emit('room:meta', meta);
  }

  /** Sends the meta if it differs from what clients last had: a game starting
   *  or ending changes what the host can do. Each game calls this whenever it
   *  broadcasts its own state. */
  protected syncMeta(): void {
    // A game can still end while paused, when a player it needs leaves.
    if (this.roomPause && this.lifecycle() !== 'playing') this.dropPause();
    if (JSON.stringify(this.meta()) !== this.sentMeta) this.emitMeta();
  }

  /** Every game reports its result here, from wherever it ends. Ties give each
   *  winner a win; an empty list is a game nobody won. Players who have left
   *  the room by now don't score. */
  protected recordWin(ids: readonly (string | null | undefined)[]): void {
    const winners = ids.filter((id): id is string => !!id && this.players.has(id));
    this.session.record(this.kind, winners);
    this.emitMeta();
  }

  /** Takes back the last recorded result, for a host undoing a game's end. */
  protected revokeLastWin(): void {
    this.session.revokeLast();
    this.emitMeta();
  }

  /** The fields every game's `publicState()` starts from. */
  protected baseState(): Omit<RoomStateBase, 'kind'> {
    return {
      code: this.code,
      players: this.publicPlayers(),
      hostId: this.hostId,
      serverTime: Date.now(),
      meta: this.meta(),
    };
  }

  publicPlayers(): Player[] {
    return this.order
      .map((id) => this.players.get(id))
      .filter((p): p is P => !!p)
      .map((p) => this.publicPlayer(p));
  }

  destroy(): void {
    this.dropPause();
    this.onDestroy();
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
    this.destroyed = true;
  }
}
