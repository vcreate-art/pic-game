import { randomUUID } from 'node:crypto';
import {
  CUSTOM_WORDS, DEFAULT_SETTINGS, SETTINGS_BOUNDS, WORDS_EN, WORD_MODES, WORD_SOURCES,
  authorPoints, drawerPoints, guessPoints, judge, maskOf, parseDrawWords, pickHintPositions,
  suggestionKey, validateSuggestion,
  type CanvasOp, type ChatMessage, type Drawing, type Phase, type Player,
  type RoomSettings, type RoomState, type SuggestAck, type TurnPublic,
  type Vote, type WordOption,
} from '@pic-game/shared';
import {
  CHOOSE_SECONDS, GAME_END_SECONDS, MAX_CHAT_LEN, MAX_OPS_PER_TURN,
  SUGGEST_SECONDS, TURN_END_SECONDS, EMPTY_ROOM_TTL_MS,
} from '../../config.js';
import { BaseRoom, type CorePlayer, type IO, type RoomLifecycle } from '../../core/BaseRoom.js';
import { topScorers } from '../../core/RoomSession.js';
import { pickWords } from './words.js';

export interface ServerPlayer extends CorePlayer {
  /** When they solved this turn's word, and in what position. */
  guessedAt: number | null;
  placement: number | null;
}

/** Draw-and-guess. Seats, host, presence and chat come from BaseRoom; this
 *  class is the game itself — turns, words, scoring and the canvas. */
export class SkribblRoom extends BaseRoom<ServerPlayer> {
  readonly kind = 'skribbl' as const;
  settings: RoomSettings = { ...DEFAULT_SETTINGS, customWords: [] };
  phase: Phase = 'lobby';
  round = 0;
  turnIndex = 0;
  ops: CanvasOp[] = [];
  /** The drawer's undone steps, latest last, for redo: an op, or a clear.
   *  Emptied by anything new drawn or filled, or a new turn, as in any editor. */
  private undone: (CanvasOp | { kind: 'clear' })[] = [];
  /** What each clear this turn set aside, latest last, for undo to bring back. */
  private cleared: CanvasOp[][] = [];

  // ---- current turn (word is private to this object and the drawer's socket) ----
  private word: string | null = null;
  /** Built-in words offered when there are not enough suggestions to fill the
   *  list. Indistinguishable from suggestions on the wire — labelling them would
   *  tell the drawer which options belong to somebody. */
  private padding: WordOption[] = [];
  /** playerId -> their current suggestion. A Map keeps insertion order when a
   *  key is overwritten, so re-suggesting does not jump the list. */
  private suggestions = new Map<string, WordOption>();
  /** Every option shown this turn, by id. Append-only, so a pick still resolves
   *  even after the option scrolled off the drawer's visible list. */
  private offered = new Map<string, { text: string; authorId: string | null }>();
  /** Who suggested the chosen word. Null in builtin mode or on a padded pick. */
  private authorId: string | null = null;
  /** Within the `choosing` phase: false while suggestions are still being
   *  collected, true once the drawer has the list in front of them. Always true
   *  straight away in builtin mode. */
  private picking = false;
  drawerId: string | null = null;
  private mask = '';
  private revealed: Record<number, string> = {};
  private hintPositions: number[] = [];
  private hintsShown = 0;
  private endsAt = 0;
  private usedWords = new Set<string>();
  private deltas: Record<string, number> = {};
  private openStrokes = new Set<string>();
  /** Thumbs on the current drawing. A fresh object each turn rather than
   *  cleared, because the finished drawing in the gallery keeps holding it:
   *  people can still react while the word is shown after the turn. */
  private reactions = { likes: new Set<string>(), dislikes: new Set<string>() };
  /** This game's drawings, in the order they were made. Kept after the game so
   *  the podium can show them; cleared when the next game starts. */
  private gallery: {
    id: string; round: number; drawerId: string; drawerName: string; word: string;
    ops: CanvasOp[]; reactions: { likes: Set<string>; dislikes: Set<string> };
  }[] = [];

  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private hintTimer: ReturnType<typeof setInterval> | null = null;
  /** The step the phase timer will run, and when, for pausing. */
  private phaseFn: (() => void) | null = null;
  private phaseDue = 0;
  /** What was left of the phase timer when the game was paused. */
  private heldPhase: { fn: () => void; ms: number } | null = null;

  constructor(code: string, io: IO) {
    super(code, io);
  }

  // ------------------------------------------------------- BaseRoom contract

  isLobby(): boolean {
    return this.phase === 'lobby';
  }

  lifecycle(): RoomLifecycle {
    return this.isLobby() ? 'lobby' : this.phase === 'gameEnd' ? 'ended' : 'playing';
  }

  protected override get pausable(): boolean {
    return true;
  }

  /** Stops the turn clock and the hints where they are. */
  protected override onPause(): void {
    this.heldPhase = this.phaseFn ? { fn: this.phaseFn, ms: Math.max(0, this.phaseDue - Date.now()) } : null;
    this.clearTimers();
  }

  /** Carries on with the time that was left. While choosing or drawing the
   *  deadline is that step's, so it moves to match, which keeps hint timing
   *  and guess points as they would have been. */
  protected override onResume(): void {
    const held = this.heldPhase;
    this.heldPhase = null;
    if (held) {
      if (this.phase === 'choosing' || this.phase === 'drawing') this.endsAt = Date.now() + held.ms;
      this.schedule(held.ms, held.fn);
    }
    if (this.phase === 'drawing') this.startHints();
    this.io.to(this.code).emit('turn:clock', { endsAt: this.endsAt });
    if (this.phase === 'choosing' && this.playerWords) this.broadcastSuggestState();
  }

  protected resetToLobby(): void {
    this.abortToLobby();
  }

  /** A bigger group than the default can switch in; the limit rises to fit
   *  them rather than turning anyone away. */
  override adoptFrom(old: BaseRoom<CorePlayer>): void {
    super.adoptFrom(old);
    this.settings.maxPlayers = Math.max(this.settings.maxPlayers, this.players.size);
  }

  get maxPlayers(): number {
    return this.settings.maxPlayers;
  }

  protected get minPlayers(): number {
    return 2;
  }

  protected createPlayer(base: CorePlayer): ServerPlayer {
    return { ...base, guessedAt: null, placement: null };
  }

  /** A player back mid-window counts again, so the tally has to say so. */
  protected override onPlayerReconnected(_p: ServerPlayer): void {
    if (this.phase === 'choosing' && this.playerWords) {
      queueMicrotask(() => this.broadcastSuggestState());
    }
  }

  protected override onPlayerDisconnected(p: ServerPlayer): boolean {
    if (this.drawerId === p.id && (this.phase === 'drawing' || this.phase === 'choosing')) {
      this.endTurn('drawer-left');
      return true;
    }
    this.checkTurnComplete();
    // Nobody waits on a player who dropped out mid-window.
    this.broadcastSuggestState();
    this.maybeOpenPicking();
    return true;
  }

  protected override onPlayerRemoved(playerId: string): boolean {
    if (this.drawerId === playerId && (this.phase === 'drawing' || this.phase === 'choosing')) {
      this.endTurn('drawer-left');
    } else if (this.phase === 'choosing') {
      this.suggestions.delete(playerId);
      this.broadcastSuggestState();
      this.maybeOpenPicking();
    }
    return true;
  }

  protected override onTooFewPlayers(): void {
    this.abortToLobby();
  }

  protected override onDestroy(): void {
    this.clearTimers();
  }

  // ------------------------------------------------------------------ settings

  updateSettings(patch: Partial<RoomSettings>): void {
    if (this.phase !== 'lobby') return;
    for (const [k, bounds] of Object.entries(SETTINGS_BOUNDS)) {
      const key = k as keyof typeof SETTINGS_BOUNDS;
      const v = patch[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      this.settings[key] = Math.round(Math.max(bounds.min, Math.min(bounds.max, v)));
    }
    // Handled apart from the numeric bounds loop above.
    if (patch.wordMode && WORD_MODES.includes(patch.wordMode)) {
      this.settings.wordMode = patch.wordMode;
    }
    if (patch.wordSource && WORD_SOURCES.includes(patch.wordSource)) {
      this.settings.wordSource = patch.wordSource;
    }
    this.io.to(this.code).emit('room:settings', this.settings);
  }

  setWords(text: string): void {
    if (this.phase !== 'lobby') return;
    this.settings.customWords = parseDrawWords(String(text).slice(0, 20_000));
    this.io.to(this.code).emit('room:settings', this.settings);
  }

  /** The words this game draws from, or null when "only mine" has too few. */
  private wordPool(): readonly string[] | null {
    const custom = this.settings.customWords;
    switch (this.settings.wordSource) {
      case 'builtin': return WORDS_EN;
      case 'custom': return custom.length >= CUSTOM_WORDS.minForGame ? custom : null;
      case 'mixed': {
        // A host word that is already built in would otherwise come up twice as often.
        const builtin = new Set(WORDS_EN.map(suggestionKey));
        return [...WORDS_EN, ...custom.filter((w) => !builtin.has(suggestionKey(w)))];
      }
    }
  }

  private get playerWords(): boolean {
    return this.settings.wordMode === 'players';
  }

  // ------------------------------------------------------------------ game loop

  startGame(byPlayerId: string): void {
    if (byPlayerId !== this.hostId) return;
    if (this.phase !== 'lobby' && this.phase !== 'gameEnd') return;
    if (this.activeCount() < 2) {
      this.emitError(byPlayerId, 'TOO_FEW', 'Need at least 2 players to start.');
      return;
    }
    if (!this.wordPool()) {
      this.emitError(byPlayerId, 'FEW_WORDS', `Add at least ${CUSTOM_WORDS.minForGame} words of your own.`);
      return;
    }
    for (const p of this.players.values()) p.score = 0;
    this.usedWords.clear();
    this.gallery = [];
    this.round = 1;
    this.turnIndex = 0;
    this.order = [...this.players.keys()];
    this.beginTurn();
    this.syncMeta();
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
    this.undone = [];
    this.cleared = [];

    // Always stock a full list of built-ins. In players mode these are padding
    // that suggestions push out; in builtin mode they are the whole list.
    this.padding = pickWords(this.settings.wordChoices, this.usedWords, this.wordPool() ?? WORDS_EN).map((text) => {
      const id = randomUUID();
      this.offered.set(id, { text, authorId: null });
      return { id, text };
    });

    this.io.to(this.code).emit('canvas:cleared');

    if (!this.playerWords) {
      this.openPicking();
      return;
    }

    // Collect first. The drawer is shown nothing until everyone has had their
    // say, so no one's word can be beaten to the punch by a faster typist.
    this.picking = false;
    this.endsAt = Date.now() + SUGGEST_SECONDS * 1000;
    this.io.to(this.code).emit('turn:choosing', {
      drawerId: drawer.id,
      round: this.round,
      endsAt: this.endsAt,
    });
    this.broadcastSuggestState();

    // Backstop only: the window normally closes early, as soon as everyone is in.
    this.schedule(SUGGEST_SECONDS * 1000, () => this.openPicking());

    // A room where the drawer is the only one connected has nobody to wait for.
    this.maybeOpenPicking();
  }

  /** Connected players who are expected to suggest this turn. */
  private expectedSuggesters(): ServerPlayer[] {
    return [...this.players.values()].filter((p) => p.connected && p.id !== this.drawerId);
  }

  /** Someone who drops out mid-window is no longer waited on. */
  private everyoneSuggested(): boolean {
    const expected = this.expectedSuggesters();
    if (expected.length === 0) return true;
    return expected.every((p) => this.suggestions.has(p.id));
  }

  maybeOpenPicking(): void {
    if (this.phase !== 'choosing' || this.picking || !this.playerWords) return;
    if (this.everyoneSuggested()) this.openPicking();
  }

  /** Closes the suggestion window and hands the list to the drawer, restarting
   *  the clock so they get a full turn to choose however long collecting took. */
  private openPicking(): void {
    if (this.phase !== 'choosing' || this.picking || !this.drawerId) return;
    this.picking = true;
    this.clearTimers();
    this.endsAt = Date.now() + CHOOSE_SECONDS * 1000;

    this.io.to(this.code).emit('turn:choosing', {
      drawerId: this.drawerId,
      round: this.round,
      endsAt: this.endsAt,
    });
    this.sendOptions();
    if (this.playerWords) this.broadcastSuggestState();

    this.schedule(CHOOSE_SECONDS * 1000, () => this.autoChoose());
  }

  /** The drawer's visible list: suggestions first, topped up with padding. */
  private optionsForDrawer(): WordOption[] {
    const suggested = [...this.suggestions.values()];
    const shortfall = Math.max(0, this.settings.wordChoices - suggested.length);
    return [...suggested, ...this.padding.slice(0, shortfall)];
  }

  /** Nothing is sent before `picking`: the option list is the one thing that
   *  must not reach the drawer while people are still writing. */
  private sendOptions(): void {
    if (!this.drawerId || this.phase !== 'choosing' || !this.picking) return;
    this.emitTo(this.drawerId, 'turn:choosing', {
      drawerId: this.drawerId,
      round: this.round,
      endsAt: this.endsAt,
      words: this.optionsForDrawer(),
    });
  }

  private broadcastSuggestState(): void {
    this.io.to(this.code).emit('suggest:state', {
      open: this.phase === 'choosing' && this.playerWords && !this.picking,
      endsAt: this.endsAt,
      count: this.suggestions.size,
      expected: this.expectedSuggesters().length,
      ready: this.picking,
    });
  }

  /**
   * Records a player's word for this turn. Replacing an earlier suggestion keeps
   * the old id registered in `offered` rather than deleting it, so a pick that
   * crosses in flight still resolves instead of silently failing.
   */
  suggestWord(playerId: string, raw: unknown): SuggestAck {
    if (!this.playerWords) return { ok: false, message: 'This room uses the built-in words.' };
    if (this.phase !== 'choosing' || this.picking) {
      return { ok: false, message: 'Not taking suggestions right now.' };
    }
    if (playerId === this.drawerId) return { ok: false, message: "You're picking this turn, not suggesting." };
    if (!this.players.has(playerId)) return { ok: false, message: 'You are not in this room.' };

    const taken = new Set<string>();
    for (const [pid, opt] of this.suggestions) {
      if (pid !== playerId) taken.add(suggestionKey(opt.text));
    }

    const result = validateSuggestion(raw, taken);
    if (!result.ok) return { ok: false, message: result.message };

    const id = randomUUID();
    this.offered.set(id, { text: result.text, authorId: playerId });
    this.suggestions.set(playerId, { id, text: result.text });

    this.broadcastSuggestState();
    // Last one in closes the window immediately rather than burning the backstop.
    this.maybeOpenPicking();
    return { ok: true, text: result.text };
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

  chooseWord(playerId: string, id: string): void {
    if (this.phase !== 'choosing' || playerId !== this.drawerId) return;
    const option = this.offered.get(id);
    if (!option) return;
    this.commitWord(option);
  }

  /**
   * Deadline reached with no pick from the drawer.
   *
   * Real suggestions win over padding whenever any exist: the built-ins are only
   * there so the drawer always has something to choose between, and letting them
   * take the auto-pick would throw away a word somebody bothered to write — with
   * one suggestion against two padded slots, it would do so two times in three.
   *
   * Random within that set rather than first, so suggesting early cannot farm a
   * predictable slot.
   */
  private autoChoose(): void {
    if (this.phase !== 'choosing') return;
    const suggested = [...this.suggestions.values()];
    const options = suggested.length > 0 ? suggested : this.optionsForDrawer();
    const pick = options[Math.floor(Math.random() * options.length)];
    const option = pick ? this.offered.get(pick.id) : undefined;
    if (!option) {
      this.abortToLobby();
      return;
    }
    this.commitWord(option);
  }

  private commitWord(option: { text: string; authorId: string | null }): void {
    const playerId = this.drawerId;
    if (!playerId) return;
    const word = option.text;

    this.clearTimers();
    this.authorId = option.authorId;
    this.word = word;
    this.usedWords.add(word);
    this.mask = maskOf(word);
    this.revealed = {};
    this.hintPositions = pickHintPositions(word, this.settings.hints, Math.random);
    this.hintsShown = 0;
    this.phase = 'drawing';
    this.endsAt = Date.now() + this.settings.drawTime * 1000;
    // Before the secret goes out, so every guess of this turn lands below it.
    this.broadcastChat({ kind: 'divider', text: `${this.players.get(playerId)?.name ?? 'Someone'} is drawing` });

    // The one place the word leaves this object, addressed to a single socket.
    this.emitTo(playerId, 'word:secret', { word });
    if (this.playerWords) this.broadcastSuggestState();
    const turn = this.turnPublic();
    if (turn) this.io.to(this.code).emit('turn:drawing', turn);

    this.schedule(this.settings.drawTime * 1000, () => this.endTurn('timeout'));
    this.startHints();
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

    const authorId = this.authorId;

    if (reason !== 'drawer-left' && this.drawerId) {
      const guessers = this.eligibleGuessers();
      const got = guessers.filter((p) => p.guessedAt !== null).length;

      const drawer = this.players.get(this.drawerId);
      if (drawer && got > 0) {
        const pts = drawerPoints(got, guessers.length);
        drawer.score += pts;
        this.deltas[drawer.id] = (this.deltas[drawer.id] ?? 0) + pts;
      }

      // Pays more the fewer people cracked it, and nothing at all when nobody
      // did — which is what stops "submit gibberish" being the winning play.
      const author = authorId ? this.players.get(authorId) : undefined;
      if (author) {
        const pts = authorPoints(got, guessers.length);
        if (pts > 0) {
          author.score += pts;
          this.deltas[author.id] = (this.deltas[author.id] ?? 0) + pts;
        }
      }
    }

    // A turn that ended before anything was drawn leaves nothing to keep.
    if (word && this.drawerId && this.ops.length > 0) {
      this.gallery.push({
        id: randomUUID(),
        round: this.round,
        drawerId: this.drawerId,
        drawerName: this.players.get(this.drawerId)?.name ?? 'Someone',
        word,
        ops: this.ops,
        reactions: this.reactions,
      });
    }

    this.phase = 'turnEnd';
    this.io.to(this.code).emit('turn:end', {
      word,
      deltas: this.deltas,
      players: this.publicPlayers(),
      reason,
      // First and only moment authorship becomes public.
      ...(authorId ? { authorId } : {}),
    });
    this.word = null;
    this.schedule(TURN_END_SECONDS * 1000, () => this.nextTurn());
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
    this.recordWin(topScorers(Object.fromEntries([...this.players.values()].map((p) => [p.id, p.score]))));
    this.io.to(this.code).emit('game:end', { players: this.publicPlayers(), gallery: this.galleryPublic() });
    this.schedule(GAME_END_SECONDS * 1000, () => this.abortToLobby());
  }

  private abortToLobby(): void {
    this.clearTimers();
    this.resetTurnState();
    this.phase = 'lobby';
    this.round = 0;
    this.turnIndex = 0;
    this.ops = [];
    this.undone = [];
    this.cleared = [];
    this.broadcastState();
  }

  private resetTurnState(): void {
    this.word = null;
    this.padding = [];
    this.suggestions.clear();
    this.offered.clear();
    this.authorId = null;
    this.drawerId = null;
    this.mask = '';
    this.revealed = {};
    this.hintPositions = [];
    this.hintsShown = 0;
    this.deltas = {};
    this.picking = false;
    this.openStrokes.clear();
    this.reactions = { likes: new Set(), dislikes: new Set() };
    for (const p of this.players.values()) {
      p.guessedAt = null;
      p.placement = null;
    }
  }

  /** Every timer the room owns dies here. Miss one and an abandoned room keeps
   *  firing turn transitions forever and never gets collected. */
  /** Runs the phase's next step after `ms`, remembering what is due and when
   *  so a pause can stop it and pick it up again with the time that was left. */
  private schedule(ms: number, fn: () => void): void {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    // Someone leaving can move the game on mid-pause; the next step waits.
    if (this.isPaused) {
      this.phaseTimer = null;
      this.phaseFn = null;
      this.heldPhase = { fn, ms };
      return;
    }
    this.phaseFn = fn;
    this.phaseDue = Date.now() + ms;
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      this.phaseFn = null;
      fn();
    }, ms);
  }

  private startHints(): void {
    if (this.hintTimer) clearInterval(this.hintTimer);
    if (this.isPaused) return;
    this.hintTimer = setInterval(() => this.maybeReveal(), 1000);
  }

  private clearTimers(): void {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    if (this.hintTimer) clearInterval(this.hintTimer);
    this.phaseTimer = null;
    this.hintTimer = null;
    this.phaseFn = null;
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
    this.undone = [];
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

  /** A stroke of the drawer's own, snapped to a clean shape: its points are
   *  swapped for the shape's, and everyone else's copy with them. */
  replaceStroke(playerId: string, id: string, pts: number[]): void {
    if (!this.isDrawer(playerId)) return;
    const op = this.ops.find((o) => o.id === id);
    if (!op || op.kind !== 'stroke' || op.by !== playerId) return;
    op.pts = [...pts];
    this.io.to(this.code).except(this.socketOf(playerId) ?? '').emit('draw:replace', { id, pts: op.pts });
  }

  fill(playerId: string, x: number, y: number, color: string): void {
    if (!this.isDrawer(playerId)) return;
    if (this.ops.length >= MAX_OPS_PER_TURN) return;
    const op: CanvasOp = { kind: 'fill', id: randomUUID(), by: playerId, x, y, color };
    this.ops.push(op);
    this.undone = [];
    this.io.to(this.code).except(this.socketOf(playerId) ?? '').emit('draw:fill', op);
  }

  undo(playerId: string): void {
    if (!this.isDrawer(playerId)) return;
    let took = false;
    for (let i = this.ops.length - 1; i >= 0; i--) {
      if (this.ops[i]!.by === playerId) {
        this.undone.push(...this.ops.splice(i, 1));
        took = true;
        break;
      }
    }
    // Nothing of theirs drawn since the last clear: that clear is the latest
    // step, and undoing it brings back what it set aside.
    const before = took ? undefined : this.cleared.pop();
    if (before) {
      this.ops = [...before, ...this.ops];
      this.undone.push({ kind: 'clear' });
    }
    // Undo ships the surviving history rather than a reverse-op: replaying a known
    // list is always correct, where incremental un-drawing drifts over time.
    this.io.to(this.code).emit('canvas:undone', { ops: this.ops });
  }

  /** Puts back the last step undone (an op, or a clear, done again), and
   *  ships the history as undo does. */
  redo(playerId: string): void {
    if (!this.isDrawer(playerId)) return;
    if (this.ops.length >= MAX_OPS_PER_TURN) return;
    const step = this.undone.pop();
    if (!step) return;
    if (step.kind === 'clear') {
      this.cleared.push(this.ops);
      this.ops = [];
    } else {
      this.ops.push(step);
    }
    this.io.to(this.code).emit('canvas:undone', { ops: this.ops });
  }

  /** Clears the drawing, setting it aside so undo can bring it back. */
  clearCanvas(playerId: string): void {
    if (!this.isDrawer(playerId)) return;
    if (this.ops.length) this.cleared.push(this.ops);
    this.ops = [];
    this.undone = [];
    this.openStrokes.clear();
    this.io.to(this.code).emit('canvas:cleared');
  }

  // ------------------------------------------------------------------ reactions

  /**
   * A thumbs up or down on the drawing everyone is looking at: while it is
   * being drawn, and while the word is shown after. One vote each, which a
   * second tap on the same thumb takes back. Not the drawer's own.
   */
  react(playerId: string, vote: Vote | null): void {
    if (this.phase !== 'drawing' && this.phase !== 'turnEnd') return;
    if (!this.drawerId || playerId === this.drawerId || !this.players.has(playerId)) return;
    const { likes, dislikes } = this.reactions;
    likes.delete(playerId);
    dislikes.delete(playerId);
    if (vote === 'like') likes.add(playerId);
    if (vote === 'dislike') dislikes.add(playerId);
    this.io.to(this.code).emit('draw:reactions', { likes: [...likes], dislikes: [...dislikes] });
  }

  private galleryPublic(): Drawing[] {
    return this.gallery.map(({ reactions, ...d }) => ({
      ...d,
      likes: [...reactions.likes],
      dislikes: [...reactions.dislikes],
    }));
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

    // Paused, a guess must wait: scoring it would race the clock that's
    // stopped, and showing it would hand the word to everyone.
    if (this.isPaused && judge(text, this.word) !== 'wrong') {
      this.emitTo(playerId, 'chat:message', {
        id: randomUUID(),
        kind: 'close',
        text: 'The game is paused. Hold that guess until it carries on.',
        at: Date.now(),
      });
      return;
    }

    // The author wrote this word, so typing it is not a guess. It is swallowed
    // rather than rejected: falling through would broadcast it as ordinary chat
    // and print the answer to everyone still guessing.
    if (playerId === this.authorId && judge(text, this.word) === 'correct') {
      this.emitTo(playerId, 'chat:message', {
        id: randomUUID(),
        kind: 'close',
        text: "That's your own word — you can't score it, but you earn points if others get it.",
        at: Date.now(),
      });
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

  /**
   * Who can actually win points this turn. The author is excluded along with the
   * drawer — they already know the word. Leaving them in would also stop the
   * "everybody guessed" early end from ever firing, since they never register a
   * correct guess.
   */
  private eligibleGuessers(): ServerPlayer[] {
    return [...this.players.values()].filter(
      (p) => p.id !== this.drawerId && p.id !== this.authorId && p.connected,
    );
  }

  /** Once nobody is left guessing, sitting out the remaining clock is dead time. */
  private checkTurnComplete(): void {
    if (this.phase !== 'drawing') return;
    const guessers = this.eligibleGuessers();
    if (guessers.length > 0 && guessers.every((p) => p.guessedAt !== null)) {
      this.endTurn('all-guessed');
    }
  }

  private sendToSolvers(m: Omit<ChatMessage, 'id' | 'at'>): void {
    const msg: ChatMessage = { ...m, id: randomUUID(), at: Date.now() };
    for (const p of this.players.values()) {
      if (p.guessedAt !== null || p.id === this.drawerId) this.emitTo(p.id, 'chat:message', msg);
    }
  }

  // ------------------------------------------------------------ serialization

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
      likes: [...this.reactions.likes],
      dislikes: [...this.reactions.dislikes],
    };
  }

  /** The public snapshot. Note `turn` is built from `turnPublic()`, which has no
   *  field capable of carrying the word — the type itself enforces the invariant. */
  publicState(): RoomState {
    return {
      kind: 'skribbl',
      ...this.baseState(),
      phase: this.phase,
      settings: this.settings,
      round: this.round,
      turn: this.turnPublic(),
      ops: this.ops,
      // Only at the podium: sent to everyone in `game:end` already, and heavy
      // enough that every join in the lobby should not carry it.
      gallery: this.phase === 'gameEnd' ? this.galleryPublic() : [],
    };
  }

  broadcastState(): void {
    this.broadcastSnapshot();
  }

  /** Re-sends the secret to a drawer who reconnected mid-turn. */
  resendSecretIfDrawer(playerId: string): void {
    if (this.phase === 'drawing' && this.drawerId === playerId && this.word) {
      this.emitTo(playerId, 'word:secret', { word: this.word });
    }
    if (this.phase === 'choosing' && this.drawerId === playerId) {
      this.sendOptions();
    }
    if (this.phase === 'choosing' && this.playerWords) {
      this.broadcastSuggestState();
    }
  }
}
