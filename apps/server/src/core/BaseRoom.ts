import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import type {
  Avatar, ChatMessage, ClientToServerEvents, GameKind, Player, RoomCountdown, RoomMeta, RoomPause, RoomState,
  RoomStage, RoomStateBase, ServerToClientEvents,
} from '@pic-game/shared';
import { EMPTY_ROOM_TTL_MS, GAME_COUNTDOWN_MS, PAUSE_HOST_AWAY_MS } from '../config.js';
import { RoomSession } from './RoomSession.js';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

/** Where a room is in its game, in the terms every game shares: getting
 *  ready, in the middle of one, or looking at the result. */
export type RoomLifecycle = RoomStage;

/** What every game needs to know about a seat, whatever the game is. */
export interface CorePlayer extends Player {
  /** Secret bearer token; proves seat ownership across reconnects. */
  token: string;
  /** The browser's own lasting id, from the handshake: it outlives the tab,
   *  so the same person can be known again after closing it or leaving.
   *  Never sent to other players. */
  person: string | null;
  /** What the session files this seat's wins and games under: the person,
   *  so they carry across a leave and rejoin, or the seat's id without one. */
  record: string;
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
  /** The 3-2-1 under way, if any. A countdown holds the game the same way a
   *  pause does, so every game that can pause gets one for free. */
  private countdown: RoomCountdown | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  /** The stage as last broadcast, to notice a game going into play. */
  private lastStage: RoomStage = 'lobby';

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

  addPlayer(name: string, avatar: Avatar, socketId: string, person: string | null = null): P {
    const id = randomUUID();
    const player = this.createPlayer({
      id,
      token: randomUUID(),
      person,
      record: person ?? id,
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
      return this.rebind(p, socketId);
    }
    return null;
  }

  /** The same, for someone back without their tab's token, after closing it:
   *  their browser's person finds the seat they left away. Never a seat that
   *  is still connected, which would be another tab of theirs. */
  reclaimPerson(person: string, socketId: string): P | null {
    for (const p of this.players.values()) {
      if (p.person === person && !p.connected) return this.rebind(p, socketId);
    }
    return null;
  }

  /** A newer tab of someone already here takes their seat over, so one
   *  person is one player. Returns the seat and the socket it was taken from,
   *  which the caller tells to step back. */
  takeOver(person: string, socketId: string): { seat: P; from: string | null } | null {
    for (const p of this.players.values()) {
      if (p.person !== person || !p.connected) continue;
      const from = p.socketId;
      return { seat: this.rebind(p, socketId), from: from === socketId ? null : from };
    }
    return null;
  }

  /** A seat stays reclaimable for as long as it exists: an away seat that
   *  refused its owner would sit in the room beside their new one. */
  private rebind(p: P, socketId: string): P {
    p.socketId = socketId;
    p.connected = true;
    p.disconnectedAt = null;
    if (p.id === this.hostId) this.clearPauseAway();
    this.onPlayerReconnected(p);
    this.cancelEmptyCollection();
    return p;
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
      wins: this.perPlayer((r) => this.session.wins.get(r)),
      winsByGame: this.perPlayer((r) => this.session.winsByGame.get(r)),
      played: this.perPlayer((r) => this.session.played.get(r)),
      games: this.session.games,
      stage: this.lifecycle(),
      paused: this.roomPause,
      countdown: this.countdown,
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

  /** Host only: counts everyone back in, then carries on from exactly where
   *  the game stopped. */
  resumeGame(by: string): void {
    if (by !== this.hostId || !this.roomPause || this.countdown) return;
    this.countIn('resume');
    this.emitMeta();
  }

  /** Holds the game for the 3-2-1, then lets it run. A start holds a game
   *  that has just been set up; a resume holds one that's already paused. */
  private countIn(kind: RoomCountdown['kind']): void {
    if (!this.roomPause) {
      this.roomPause = { by: this.hostId, at: Date.now() };
      this.onPause();
    }
    this.countdown = { kind, until: Date.now() + GAME_COUNTDOWN_MS };
    this.clearCountdown();
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = null;
      this.countdown = null;
      this.resumeNow(kind === 'resume' ? 'Back to the game.' : null);
    }, GAME_COUNTDOWN_MS);
  }

  private clearCountdown(): void {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
  }

  private resumeNow(message: string | null): void {
    const paused = this.roomPause;
    if (!paused) return;
    this.roomPause = null;
    this.countdown = null;
    this.clearCountdown();
    this.clearPauseAway();
    this.onResume(Date.now() - paused.at);
    if (message) this.systemMessage(message);
    this.emitMeta();
  }

  /** Forgets a pause without resuming the game, for when the game it paused
   *  is over or being thrown away. */
  private dropPause(): void {
    this.roomPause = null;
    this.countdown = null;
    this.clearCountdown();
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

  /** Switching games happens from the lobby: from an end screen the host
   *  goes back to the lobby first. */
  canSwitch(): boolean {
    return this.lifecycle() === 'lobby';
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
        id: p.id, token: p.token, person: p.person, record: p.record, name: p.name, avatar: p.avatar, score: 0,
        connected: p.connected, socketId: p.socketId, disconnectedAt: p.disconnectedAt,
      }));
    }
    if (this.activeCount() === 0) this.scheduleEmptyCollection();
  }

  /** The meta as last sent, to tell when it has changed. */
  private sentMeta = '';

  /** Who was here when the current game went into play: the players it
   *  counts as played for. Null until a game has started. */
  private takingPart: Set<string> | null = null;

  /** Notes who is taking part when play begins, however it was reached. */
  private noteStage(stage: RoomStage): void {
    if (stage === 'playing' && this.lastStage !== 'playing') this.takingPart = new Set(this.players.keys());
  }

  /** Sends the room-level facts on their own. Most games broadcast only their
   *  own state, which doesn't carry them. */
  protected emitMeta(): void {
    const meta = this.meta();
    this.sentMeta = JSON.stringify(meta);
    this.io.to(this.code).emit('room:meta', meta);
  }

  /** Sends the whole room to everyone. The meta rides along, so it counts as
   *  sent: otherwise a change straight after it would look like no change. */
  broadcastSnapshot(): void {
    const state = this.publicState();
    this.sentMeta = JSON.stringify(state.meta);
    this.noteStage(state.meta.stage);
    this.lastStage = state.meta.stage;
    this.io.to(this.code).emit('state:sync', state);
  }

  /** Sends the meta if it differs from what clients last had: a game starting
   *  or ending changes what the host can do. Each game calls this whenever it
   *  broadcasts its own state. */
  protected syncMeta(): void {
    const stage = this.lifecycle();
    // A game can still end while paused, when a player it needs leaves.
    if (this.roomPause && stage !== 'playing') this.dropPause();
    // Every way into play, start or rematch or restart, gets the 3-2-1.
    if (stage === 'playing' && this.lastStage !== 'playing' && this.pausable && !this.roomPause) {
      this.countIn('start');
    }
    this.noteStage(stage);
    this.lastStage = stage;
    if (JSON.stringify(this.meta()) !== this.sentMeta) this.emitMeta();
  }

  /** Every game reports its result here, from wherever it ends. Ties give each
   *  winner a win; an empty list is a game nobody won. Players who have left
   *  the room by now don't score. The game counts as played for whoever was
   *  here when it started and still is; without a start seen, everyone here. */
  protected recordWin(ids: readonly (string | null | undefined)[]): void {
    const winners = ids.filter((id): id is string => !!id && this.players.has(id));
    const players = [...(this.takingPart ?? this.players.keys())].filter((id) => this.players.has(id));
    const rec = (id: string) => this.players.get(id)!.record;
    this.session.record(this.kind, winners.map(rec), players.map(rec));
    this.emitMeta();
  }

  /** A session tally for each seated player, by player id, leaving out
   *  anyone with nothing. The session keeps it by record. */
  private perPlayer<T>(get: (record: string) => T | undefined): Record<string, T> {
    const out: Record<string, T> = {};
    for (const p of this.players.values()) {
      const v = get(p.record);
      if (v) out[p.id] = v;
    }
    return out;
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
