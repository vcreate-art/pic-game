import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  DEFAULT_SETTINGS, SETTINGS_BOUNDS,
  drawerPoints, guessPoints, judge, maskOf, pickHintPositions,
  type Avatar, type CanvasOp, type ChatMessage, type ClientToServerEvents,
  type Phase, type Player, type RoomSettings, type RoomState,
  type ServerToClientEvents, type TurnPublic,
} from '@pic-game/shared';
import {
  CHOOSE_SECONDS, GAME_END_SECONDS, MAX_CHAT_LEN, MAX_OPS_PER_TURN,
  RECONNECT_GRACE_MS, TURN_END_SECONDS, EMPTY_ROOM_TTL_MS,
} from '../config.js';
import { pickWords } from './words.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;

export interface ServerPlayer extends Player {
  /** Secret bearer token; proves seat ownership across reconnects. */
  token: string;
  socketId: string | null;
  disconnectedAt: number | null;
  guessedAt: number | null;
  placement: number | null;
}

export class Room {
  readonly code: string;
  settings: RoomSettings = { ...DEFAULT_SETTINGS };
  phase: Phase = 'lobby';
  hostId = '';
  round = 0;
  turnIndex = 0;

  readonly players = new Map<string, ServerPlayer>();
  /** Join order, which is also turn order. */
  order: string[] = [];
  ops: CanvasOp[] = [];

  // ---- current turn (word is private to this object and the drawer's socket) ----
  private word: string | null = null;
  private wordChoices: string[] = [];
  drawerId: string | null = null;
  private mask = '';
  private revealed: Record<number, string> = {};
  private hintPositions: number[] = [];
  private hintsShown = 0;
  private endsAt = 0;
  private usedWords = new Set<string>();
  private deltas: Record<string, number> = {};
  private openStrokes = new Set<string>();

  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private hintTimer: ReturnType<typeof setInterval> | null = null;
  /** Set when the room empties; cancelled the moment someone joins. */
  emptyTimer: ReturnType<typeof setTimeout> | null = null;
  destroyed = false;

  constructor(code: string, private readonly io: IO) {
    this.code = code;
  }

  // ------------------------------------------------------------------ players

  addPlayer(name: string, avatar: Avatar, socketId: string): ServerPlayer {
    const p: ServerPlayer = {
      id: randomUUID(),
      token: randomUUID(),
      name,
      avatar,
      score: 0,
      connected: true,
      socketId,
      disconnectedAt: null,
      guessedAt: null,
      placement: null,
    };
    this.players.set(p.id, p);
    this.order.push(p.id);
    if (!this.hostId) this.hostId = p.id;
    if (this.emptyTimer) {
      clearTimeout(this.emptyTimer);
      this.emptyTimer = null;
    }
    return p;
  }

  /** Rebinds an existing seat to a new socket. Socket.IO issues a fresh socket.id on
   *  every reconnect, so without this a refresh would clone the player and zero their score. */
  reclaim(token: string, socketId: string): ServerPlayer | null {
    for (const p of this.players.values()) {
      if (p.token !== token) continue;
      if (p.connected) return null; // token in use by a live socket
      if (p.disconnectedAt && Date.now() - p.disconnectedAt > RECONNECT_GRACE_MS) return null;
      p.socketId = socketId;
      p.connected = true;
      p.disconnectedAt = null;
      if (this.emptyTimer) {
        clearTimeout(this.emptyTimer);
        this.emptyTimer = null;
      }
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

    if (this.drawerId === playerId && (this.phase === 'drawing' || this.phase === 'choosing')) {
      this.endTurn('drawer-left');
    } else {
      this.checkTurnComplete();
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
    }
    if (this.drawerId === playerId && (this.phase === 'drawing' || this.phase === 'choosing')) {
      this.endTurn('drawer-left');
    }
    if (this.players.size < 2 && this.phase !== 'lobby') this.abortToLobby();
    if (this.activeCount() === 0) this.scheduleEmptyCollection();
  }

  activeCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  private scheduleEmptyCollection(): void {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = setTimeout(() => this.onEmpty?.(this), EMPTY_ROOM_TTL_MS);
  }

  /** Set by RoomManager so the room can ask to be collected. */
  onEmpty?: (room: Room) => void;

  // ------------------------------------------------------------------ settings

  updateSettings(patch: Partial<RoomSettings>): void {
    if (this.phase !== 'lobby') return;
    for (const [k, bounds] of Object.entries(SETTINGS_BOUNDS)) {
      const key = k as keyof RoomSettings;
      const v = patch[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      this.settings[key] = Math.round(Math.max(bounds.min, Math.min(bounds.max, v)));
    }
    this.io.to(this.code).emit('room:settings', this.settings);
  }

  // ------------------------------------------------------------------ game loop

  startGame(byPlayerId: string): void {
    if (byPlayerId !== this.hostId) return;
    if (this.phase !== 'lobby' && this.phase !== 'gameEnd') return;
    if (this.activeCount() < 2) {
      this.emitError(byPlayerId, 'TOO_FEW', 'Need at least 2 players to start.');
      return;
    }
    for (const p of this.players.values()) p.score = 0;
    this.usedWords.clear();
    this.round = 1;
    this.turnIndex = 0;
    this.order = [...this.players.keys()];
    this.beginTurn();
  }

  private beginTurn(): void {
    this.clearTimers();
    this.resetTurnState();

    const drawer = this.nextConnectedDrawer();
    if (!drawer) {
      this.abortToLobby();
      return;
    }
    this.drawerId = drawer.id;
    this.phase = 'choosing';
    this.ops = [];
    this.wordChoices = pickWords(this.settings.wordChoices, this.usedWords);
    this.endsAt = Date.now() + CHOOSE_SECONDS * 1000;

    this.io.to(this.code).emit('canvas:cleared');
    // Everyone learns WHO is drawing; only the drawer learns the candidate words.
    this.io.to(this.code).emit('turn:choosing', {
      drawerId: drawer.id,
      round: this.round,
      endsAt: this.endsAt,
    });
    this.emitTo(drawer.id, 'turn:choosing', {
      drawerId: drawer.id,
      round: this.round,
      endsAt: this.endsAt,
      words: this.wordChoices,
    });

    this.phaseTimer = setTimeout(() => this.chooseWord(drawer.id, 0), CHOOSE_SECONDS * 1000);
  }

  private nextConnectedDrawer(): ServerPlayer | null {
    for (let i = 0; i < this.order.length; i++) {
      const idx = (this.turnIndex + i) % this.order.length;
      const p = this.players.get(this.order[idx]!);
      if (p?.connected) {
        this.turnIndex = idx;
        return p;
      }
    }
    return null;
  }

  chooseWord(playerId: string, index: number): void {
    if (this.phase !== 'choosing' || playerId !== this.drawerId) return;
    const word = this.wordChoices[index] ?? this.wordChoices[0];
    if (!word) return;

    this.clearTimers();
    this.word = word;
    this.usedWords.add(word);
    this.mask = maskOf(word);
    this.revealed = {};
    this.hintPositions = pickHintPositions(word, this.settings.hints, Math.random);
    this.hintsShown = 0;
    this.phase = 'drawing';
    this.endsAt = Date.now() + this.settings.drawTime * 1000;

    // The one place the word leaves this object, addressed to a single socket.
    this.emitTo(playerId, 'word:secret', { word });
    this.io.to(this.code).emit('turn:drawing', this.turnPublic());

    this.phaseTimer = setTimeout(() => this.endTurn('timeout'), this.settings.drawTime * 1000);
    this.hintTimer = setInterval(() => this.maybeReveal(), 1000);
  }

  private maybeReveal(): void {
    if (this.phase !== 'drawing' || !this.word) return;
    const total = this.hintPositions.length;
    if (this.hintsShown >= total) return;

    const elapsed = this.settings.drawTime * 1000 - (this.endsAt - Date.now());
    const due = (this.settings.drawTime * 1000 * (this.hintsShown + 1)) / (total + 1);
    if (elapsed < due) return;

    const idx = this.hintPositions[this.hintsShown]!;
    const char = this.word[idx]!;
    this.revealed[idx] = char;
    this.hintsShown++;
    this.io.to(this.code).emit('hint:reveal', { index: idx, char });
  }

  private endTurn(reason: 'timeout' | 'all-guessed' | 'drawer-left'): void {
    if (this.phase !== 'drawing' && this.phase !== 'choosing') return;
    this.clearTimers();
    const word = this.word ?? '';

    if (reason !== 'drawer-left' && this.drawerId) {
      const drawer = this.players.get(this.drawerId);
      const guessers = this.eligibleGuessers();
      const got = guessers.filter((p) => p.guessedAt !== null).length;
      if (drawer && got > 0) {
        const pts = drawerPoints(got, guessers.length);
        drawer.score += pts;
        this.deltas[drawer.id] = (this.deltas[drawer.id] ?? 0) + pts;
      }
    }

    this.phase = 'turnEnd';
    this.io.to(this.code).emit('turn:end', {
      word,
      deltas: this.deltas,
      players: this.publicPlayers(),
      reason,
    });
    this.word = null;
    this.phaseTimer = setTimeout(() => this.nextTurn(), TURN_END_SECONDS * 1000);
  }

  private nextTurn(): void {
    this.turnIndex++;
    if (this.turnIndex >= this.order.length) {
      this.turnIndex = 0;
      this.round++;
    }
    if (this.round > this.settings.rounds) {
      this.endGame();
      return;
    }
    if (this.activeCount() < 2) {
      this.abortToLobby();
      return;
    }
    this.beginTurn();
  }

  private endGame(): void {
    this.clearTimers();
    this.phase = 'gameEnd';
    this.io.to(this.code).emit('game:end', { players: this.publicPlayers() });
    this.phaseTimer = setTimeout(() => this.abortToLobby(), GAME_END_SECONDS * 1000);
  }

  private abortToLobby(): void {
    this.clearTimers();
    this.resetTurnState();
    this.phase = 'lobby';
    this.round = 0;
    this.turnIndex = 0;
    this.ops = [];
    this.broadcastState();
  }

  private resetTurnState(): void {
    this.word = null;
    this.wordChoices = [];
    this.drawerId = null;
    this.mask = '';
    this.revealed = {};
    this.hintPositions = [];
    this.hintsShown = 0;
    this.deltas = {};
    this.openStrokes.clear();
    for (const p of this.players.values()) {
      p.guessedAt = null;
      p.placement = null;
    }
  }

  /** Every timer the room owns dies here. Miss one and an abandoned room keeps
   *  firing turn transitions forever and never gets collected. */
  private clearTimers(): void {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    if (this.hintTimer) clearInterval(this.hintTimer);
    this.phaseTimer = null;
    this.hintTimer = null;
  }

  destroy(): void {
    this.clearTimers();
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = null;
    this.destroyed = true;
  }

  // ------------------------------------------------------------------ drawing

  /** Authorization is re-checked on every drawing event rather than once at
   *  connection time, so a client that keeps emitting after its turn ends is ignored. */
  isDrawer(playerId: string): boolean {
    return this.phase === 'drawing' && this.drawerId === playerId;
  }

  strokeStart(playerId: string, op: { id: string; tool: 'pen' | 'eraser'; color: string; size: number; pts: number[] }): void {
    if (!this.isDrawer(playerId)) return;
    if (this.ops.length >= MAX_OPS_PER_TURN) return;
    this.ops.push({ kind: 'stroke', id: op.id, by: playerId, tool: op.tool, color: op.color, size: op.size, pts: [...op.pts] });
    this.openStrokes.add(op.id);
    this.io.to(this.code).except(this.socketOf(playerId) ?? '').emit('draw:start', { ...op, by: playerId });
  }

  strokeAppend(playerId: string, id: string, pts: number[]): void {
    if (!this.isDrawer(playerId) || !this.openStrokes.has(id)) return;
    const op = this.ops.find((o) => o.id === id);
    if (!op || op.kind !== 'stroke' || op.by !== playerId) return;
    if (op.pts.length > 8192) return;
    op.pts.push(...pts);
    this.io.to(this.code).except(this.socketOf(playerId) ?? '').emit('draw:append', { id, pts });
  }

  strokeEnd(playerId: string, id: string): void {
    if (!this.isDrawer(playerId)) return;
    this.openStrokes.delete(id);
    this.io.to(this.code).except(this.socketOf(playerId) ?? '').emit('draw:end', { id });
  }

  fill(playerId: string, x: number, y: number, color: string): void {
    if (!this.isDrawer(playerId)) return;
    if (this.ops.length >= MAX_OPS_PER_TURN) return;
    const op: CanvasOp = { kind: 'fill', id: randomUUID(), by: playerId, x, y, color };
    this.ops.push(op);
    this.io.to(this.code).except(this.socketOf(playerId) ?? '').emit('draw:fill', op);
  }

  undo(playerId: string): void {
    if (!this.isDrawer(playerId)) return;
    for (let i = this.ops.length - 1; i >= 0; i--) {
      if (this.ops[i]!.by === playerId) {
        this.ops.splice(i, 1);
        break;
      }
    }
    // Undo ships the surviving history rather than a reverse-op: replaying a known
    // list is always correct, where incremental un-drawing drifts over time.
    this.io.to(this.code).emit('canvas:undone', { ops: this.ops });
  }

  clearCanvas(playerId: string): void {
    if (!this.isDrawer(playerId)) return;
    this.ops = [];
    this.openStrokes.clear();
    this.io.to(this.code).emit('canvas:cleared');
  }

  // ------------------------------------------------------------------ chat & guessing

  handleChat(playerId: string, raw: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const text = raw.slice(0, MAX_CHAT_LEN).trim();
    if (!text) return;

    // Outside a live turn there is no secret to protect, so this is plain chat.
    if (this.phase !== 'drawing' || !this.word) {
      this.broadcastChat({ kind: 'chat', playerId, name: player.name, text });
      return;
    }

    // The drawer typing in chat would simply hand over the answer.
    if (playerId === this.drawerId) {
      this.emitError(playerId, 'NO_CHAT', "You're drawing — no chatting this turn!");
      return;
    }

    // Players who already solved it talk on a channel the still-guessing cannot see.
    if (player.guessedAt !== null) {
      this.sendToSolvers({ kind: 'secret', playerId, name: player.name, text });
      return;
    }

    const verdict = judge(text, this.word);

    if (verdict === 'correct') {
      this.awardGuess(player);
      return;
    }

    if (verdict === 'close') {
      // Sent to the near-misser alone; broadcasting it would narrow the word for everyone.
      this.emitTo(playerId, 'chat:message', {
        id: randomUUID(),
        kind: 'close',
        text: `'${text}' is close!`,
        at: Date.now(),
      });
    }

    this.broadcastChat({ kind: 'chat', playerId, name: player.name, text });
  }

  private awardGuess(player: ServerPlayer): void {
    const placement = this.eligibleGuessers().filter((p) => p.guessedAt !== null).length;
    player.guessedAt = Date.now();
    player.placement = placement;

    const pts = guessPoints(this.endsAt - Date.now(), this.settings.drawTime, placement);
    player.score += pts;
    this.deltas[player.id] = (this.deltas[player.id] ?? 0) + pts;

    // Carries an id and a placement, never the guess text — that text is the word.
    this.io.to(this.code).emit('guess:correct', { playerId: player.id, placement });
    this.io.to(this.code).emit('player:updated', this.publicPlayer(player));
    this.broadcastChat({ kind: 'correct', playerId: player.id, name: player.name, text: `${player.name} guessed the word!` });

    this.checkTurnComplete();
  }

  private eligibleGuessers(): ServerPlayer[] {
    return [...this.players.values()].filter((p) => p.id !== this.drawerId && p.connected);
  }

  /** Once nobody is left guessing, sitting out the remaining clock is dead time. */
  private checkTurnComplete(): void {
    if (this.phase !== 'drawing') return;
    const guessers = this.eligibleGuessers();
    if (guessers.length > 0 && guessers.every((p) => p.guessedAt !== null)) {
      this.endTurn('all-guessed');
    }
  }

  private broadcastChat(m: Omit<ChatMessage, 'id' | 'at'>): void {
    this.io.to(this.code).emit('chat:message', { ...m, id: randomUUID(), at: Date.now() });
  }

  private sendToSolvers(m: Omit<ChatMessage, 'id' | 'at'>): void {
    const msg: ChatMessage = { ...m, id: randomUUID(), at: Date.now() };
    for (const p of this.players.values()) {
      if (p.guessedAt !== null || p.id === this.drawerId) this.emitTo(p.id, 'chat:message', msg);
    }
  }

  systemMessage(text: string): void {
    this.broadcastChat({ kind: 'system', text });
  }

  // ------------------------------------------------------------------ serialization

  private socketOf(playerId: string): string | null {
    return this.players.get(playerId)?.socketId ?? null;
  }

  private emitTo<E extends keyof ServerToClientEvents>(
    playerId: string,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    const sid = this.socketOf(playerId);
    if (sid) this.io.to(sid).emit(event, ...args);
  }

  emitError(playerId: string, code: string, message: string): void {
    this.emitTo(playerId, 'error', { code, message });
  }

  private publicPlayer(p: ServerPlayer): Player {
    return { id: p.id, name: p.name, avatar: p.avatar, score: p.score, connected: p.connected };
  }

  publicPlayers(): Player[] {
    return this.order
      .map((id) => this.players.get(id))
      .filter((p): p is ServerPlayer => !!p)
      .map((p) => this.publicPlayer(p));
  }

  private turnPublic(): TurnPublic | null {
    if (!this.drawerId || this.phase === 'lobby') return null;
    return {
      drawerId: this.drawerId,
      round: this.round,
      turnIndex: this.turnIndex,
      mask: this.mask,
      revealed: { ...this.revealed },
      endsAt: this.endsAt,
      guessed: [...this.players.values()].filter((p) => p.guessedAt !== null).map((p) => p.id),
    };
  }

  /** The public snapshot. Note `turn` is built from `turnPublic()`, which has no
   *  field capable of carrying the word — the type itself enforces the invariant. */
  publicState(): RoomState {
    return {
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      players: this.publicPlayers(),
      hostId: this.hostId,
      round: this.round,
      turn: this.turnPublic(),
      ops: this.ops,
      serverTime: Date.now(),
    };
  }

  broadcastState(): void {
    this.io.to(this.code).emit('state:sync', this.publicState());
  }

  /** Re-sends the secret to a drawer who reconnected mid-turn. */
  resendSecretIfDrawer(playerId: string): void {
    if (this.phase === 'drawing' && this.drawerId === playerId && this.word) {
      this.emitTo(playerId, 'word:secret', { word: this.word });
    }
    if (this.phase === 'choosing' && this.drawerId === playerId) {
      this.emitTo(playerId, 'turn:choosing', {
        drawerId: playerId,
        round: this.round,
        endsAt: this.endsAt,
        words: this.wordChoices,
      });
    }
  }
}
