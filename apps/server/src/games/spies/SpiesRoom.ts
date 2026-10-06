import {
  GAME_CAPACITY, SPIES_BOUNDS, SPIES_DEFAULTS, SPY_TEAMS, SPY_WORDS, clueProblem, deal, giveClue,
  parseCustomWords, passTurn, remaining, reveal, validCount, type RoomState, type SpiesGame,
  type SpiesPhase, type SpiesPublic, type SpiesSettings, type SpiesTeamSeats, type SpyRole,
  type SpyTeam,
} from '@pic-game/shared';
import { BaseRoom, type CorePlayer, type IO } from '../../core/BaseRoom.js';

const emptyTeams = (): Record<SpyTeam, SpiesTeamSeats> => ({
  red: { spymaster: null, operatives: [] },
  blue: { spymaster: null, operatives: [] },
});

/**
 * Word Spies: two teams, a board of words, and a key only the spymasters see.
 *
 * Two ways to play. Typed: the app runs the whole game, with seats, roles and
 * clues entered into it. Spoken: the game happens in the room and the app is
 * the table. Nobody needs a seat, anyone can turn a card over or end a turn,
 * clues are said out loud, and a spymaster calls the key up on their own phone.
 *
 * The key is the whole game, so it is handled like the drawer's word in the
 * drawing game: `SpiesPublic` has no field that could carry it while play is
 * on, and it goes to the two spymasters' sockets alone. And since a spymaster
 * cannot unsee it, nobody leaves that seat mid-game to become a guesser.
 */
export class SpiesRoom extends BaseRoom<CorePlayer> {
  readonly kind = 'spies' as const;
  settings: SpiesSettings = { ...SPIES_DEFAULTS, customWords: [] };
  teams = emptyTeams();
  private game: SpiesGame | null = null;
  private marks = new Map<number, Set<string>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private endsAt = 0;

  constructor(code: string, io: IO) {
    super(code, io);
  }

  // ------------------------------------------------------- BaseRoom contract

  get phase(): SpiesPhase {
    return this.game?.phase ?? 'lobby';
  }

  isLobby(): boolean {
    return this.phase === 'lobby';
  }

  get maxPlayers(): number {
    return GAME_CAPACITY.spies;
  }

  protected get minPlayers(): number {
    return 2;
  }

  protected createPlayer(base: CorePlayer): CorePlayer {
    return base;
  }

  protected override onPlayerReconnected(p: CorePlayer): void {
    this.sendKey(p.id);
  }

  protected override onPlayerRemoved(playerId: string): boolean {
    this.unseat(playerId);
    for (const set of this.marks.values()) set.delete(playerId);
    this.broadcast();
    return true;
  }

  protected override onDestroy(): void {
    this.clearTimer();
  }

  // ----------------------------------------------------------------- seats

  private seatOf(id: string): { team: SpyTeam; role: SpyRole } | null {
    for (const team of SPY_TEAMS) {
      const t = this.teams[team];
      if (t.spymaster === id) return { team, role: 'spymaster' };
      if (t.operatives.includes(id)) return { team, role: 'operative' };
    }
    return null;
  }

  private unseat(id: string): void {
    for (const team of SPY_TEAMS) {
      const t = this.teams[team];
      if (t.spymaster === id) t.spymaster = null;
      t.operatives = t.operatives.filter((o) => o !== id);
    }
  }

  private get spoken(): boolean {
    return this.settings.clueMode === 'spoken';
  }

  join(id: string, team: SpyTeam | null, role: SpyRole): void {
    if (!this.players.has(id)) return;
    const seat = this.seatOf(id);
    const playing = this.phase === 'clue' || this.phase === 'guess';
    // At a real table the teams are whoever is sitting where; seats in the
    // app are only labels, so they stay open.
    if (playing && seat && !this.spoken) {
      // Mid-game you stay where you are: a spymaster has seen the key, and an
      // operative switching sides would carry their team's plans across.
      this.emitError(id, 'LOCKED', 'Teams are locked until this game is over.');
      return;
    }
    if (team && role === 'spymaster') {
      const holder = this.teams[team].spymaster;
      if (holder && holder !== id) {
        this.emitError(id, 'SEAT_TAKEN', 'That team already has a spymaster.');
        return;
      }
    }
    this.unseat(id);
    if (team) {
      if (role === 'spymaster') this.teams[team].spymaster = id;
      else this.teams[team].operatives.push(id);
    }
    this.sendKey(id);
    this.broadcast();
  }

  /** Deals everyone who is here into two even teams; the first of each leads. */
  shuffle(by: string): void {
    if (by !== this.hostId || this.phase === 'clue' || this.phase === 'guess') return;
    const ids = this.connectedPlayers().map((p) => p.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    this.teams = emptyTeams();
    ids.forEach((id, i) => {
      const t = this.teams[i % 2 === 0 ? 'red' : 'blue'];
      if (!t.spymaster) t.spymaster = id;
      else t.operatives.push(id);
    });
    this.broadcast();
  }

  // --------------------------------------------------------------- settings

  private editable(by: string): boolean {
    return by === this.hostId && (this.phase === 'lobby' || this.phase === 'ended');
  }

  updateSettings(by: string, patch: Partial<SpiesSettings>): void {
    if (!this.editable(by)) return;
    if (patch.clueMode === 'typed' || patch.clueMode === 'spoken') this.settings.clueMode = patch.clueMode;
    if (patch.wordSource === 'builtin' || patch.wordSource === 'mixed' || patch.wordSource === 'custom') {
      this.settings.wordSource = patch.wordSource;
    }
    const secs = (n: unknown) =>
      typeof n === 'number' && Number.isFinite(n)
        ? Math.round(Math.max(SPIES_BOUNDS.seconds.min, Math.min(SPIES_BOUNDS.seconds.max, n)))
        : null;
    const c = secs(patch.clueSeconds);
    if (c !== null) this.settings.clueSeconds = c;
    const g = secs(patch.guessSeconds);
    if (g !== null) this.settings.guessSeconds = g;
    this.broadcast();
  }

  setWords(by: string, text: string): void {
    if (!this.editable(by)) return;
    this.settings.customWords = parseCustomWords(text.slice(0, 10_000));
    this.broadcast();
  }

  private pool(): string[] | null {
    const custom = this.settings.customWords;
    switch (this.settings.wordSource) {
      case 'builtin': return [...SPY_WORDS];
      case 'mixed': return [...SPY_WORDS, ...custom];
      case 'custom': return custom.length >= SPIES_BOUNDS.customWords.minForGame ? custom : null;
    }
  }

  // ------------------------------------------------------------------ play

  startGame(by: string): void {
    if (by !== this.hostId) return;
    if (this.phase === 'clue' || this.phase === 'guess') return;
    const missing = SPY_TEAMS.filter((t) => !this.teams[t].spymaster || this.teams[t].operatives.length === 0);
    if (missing.length && !this.spoken) {
      this.emitError(by, 'NOT_READY', 'Each team needs a spymaster and at least one operative.');
      return;
    }
    const pool = this.pool();
    if (!pool) {
      this.emitError(by, 'FEW_WORDS', `Add at least ${SPIES_BOUNDS.customWords.minForGame} words of your own.`);
      return;
    }
    this.game = deal(pool, Math.random);
    this.marks.clear();
    for (const t of SPY_TEAMS) if (this.teams[t].spymaster) this.sendKey(this.teams[t].spymaster!);
    this.startTimer();
    this.broadcast();
    this.systemMessage(`New game: ${this.game.starting} goes first.`);
  }

  clue(id: string, word: string | null, count: number): void {
    const g = this.game;
    if (!g || g.phase !== 'clue') return;
    // Spoken aloud, the clue's number is tapped in by whoever is at the table,
    // like the cards; typed, only this team's spymaster may give it.
    if (this.spoken ? !this.players.has(id) : this.teams[g.turn].spymaster !== id) return;
    if (!validCount(count)) return;
    let clueWord: string | null = null;
    if (this.settings.clueMode === 'typed') {
      const problem = typeof word === 'string' ? clueProblem(g, word) : 'Give a clue word.';
      if (problem) {
        this.emitError(id, 'BAD_CLUE', problem);
        return;
      }
      clueWord = word;
    }
    giveClue(g, clueWord, count);
    this.marks.clear();
    this.startTimer();
    this.broadcast();
  }

  /** Who may touch the cards: the team's guessers, or at a real table anyone. */
  private guesser(id: string): SpiesGame | null {
    const g = this.game;
    if (!g || g.phase !== 'guess') return null;
    if (this.spoken) return this.players.has(id) ? g : null;
    return this.teams[g.turn].operatives.includes(id) ? g : null;
  }

  /** Spoken games: a spymaster at the table asks for the key on their phone. */
  peek(id: string): void {
    const g = this.game;
    if (!g || !this.spoken || g.phase === 'ended' || !this.players.has(id)) return;
    this.emitTo(id, 'spies:key', { key: [...g.key] });
  }

  mark(id: string, index: number): void {
    const g = this.guesser(id);
    if (!g || g.revealed[index] !== null || index >= g.words.length) return;
    const set = this.marks.get(index) ?? new Set<string>();
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.marks.set(index, set);
    this.broadcast();
  }

  revealCard(id: string, index: number): void {
    const g = this.guesser(id);
    if (!g || g.revealed[index] !== null || index >= g.words.length) return;
    const who = this.players.get(id)?.name ?? 'Someone';
    const { color, turnOver } = reveal(g, index);
    this.marks.clear();
    this.systemMessage(`${who} picked ${g.words[index]}: ${color === 'neutral' ? 'a bystander' : color === 'assassin' ? 'the assassin!' : `${color} agent`}.`);
    if (g.phase === 'ended') this.finish();
    else if (turnOver) {
      this.startTimer();
    }
    this.broadcast();
  }

  pass(id: string): void {
    const g = this.guesser(id);
    if (!g) return;
    passTurn(g);
    this.marks.clear();
    this.startTimer();
    this.broadcast();
  }

  private finish(): void {
    this.clearTimer();
    const g = this.game!;
    this.systemMessage(
      g.reason === 'assassin'
        ? `The assassin! ${g.winner} wins.`
        : `${g.winner} found all their agents and wins.`,
    );
  }

  rematch(by: string): void {
    if (by !== this.hostId || this.phase !== 'ended') return;
    this.startGame(by);
  }

  toLobby(by: string): void {
    if (by !== this.hostId || this.phase !== 'ended') return;
    this.game = null;
    this.marks.clear();
    this.broadcast();
  }

  // ----------------------------------------------------------------- timer

  /** An optional clock on each phase. Running out of time passes the turn:
   *  a spymaster who never gives a clue forfeits their team's go. */
  private startTimer(): void {
    this.clearTimer();
    const g = this.game;
    if (!g || g.phase === 'ended') return;
    // Spoken games show one clock, "time per turn", and it starts once the
    // number is tapped in; a clue clock set in a typed game must not linger.
    const secs = g.phase === 'guess' ? this.settings.guessSeconds : this.spoken ? 0 : this.settings.clueSeconds;
    if (!secs) return;
    this.endsAt = Date.now() + secs * 1000;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.game || this.game.phase === 'ended') return;
      this.systemMessage(`Time's up for ${this.game.turn}.`);
      passTurn(this.game);
      this.marks.clear();
      this.startTimer();
      this.broadcast();
    }, secs * 1000);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.endsAt = 0;
  }

  // ----------------------------------------------------------------- state

  /** The key, to this player only if they are a spymaster in a live game. */
  private sendKey(id: string): void {
    const g = this.game;
    if (!g || this.seatOf(id)?.role !== 'spymaster') return;
    this.emitTo(id, 'spies:key', { key: [...g.key] });
  }

  gamePublic(): SpiesPublic {
    const g = this.game;
    const marks: Record<number, string[]> = {};
    for (const [i, set] of this.marks) if (set.size) marks[i] = [...set];
    return {
      phase: this.phase,
      settings: { ...this.settings, customWords: [...this.settings.customWords] },
      teams: {
        red: { ...this.teams.red, operatives: [...this.teams.red.operatives] },
        blue: { ...this.teams.blue, operatives: [...this.teams.blue.operatives] },
      },
      board: g ? g.words.map((word, i) => ({ word, revealed: g.revealed[i] ?? null })) : [],
      turn: g?.turn ?? 'red',
      starting: g?.starting ?? 'red',
      clue: g?.clue ? structuredClone(g.clue) : null,
      guessesLeft: g?.guessesLeft ?? 0,
      remaining: { red: g ? remaining(g, 'red') : 0, blue: g ? remaining(g, 'blue') : 0 },
      log: g ? structuredClone(g.log) : [],
      marks,
      endsAt: this.endsAt,
      winner: g?.winner ?? null,
      reason: g?.reason ?? null,
      // Everyone sees the full key only once the game is over.
      key: g && g.phase === 'ended' ? [...g.key] : null,
    };
  }

  publicState(): RoomState {
    return {
      kind: 'spies',
      ...this.baseState(),
      game: this.gamePublic(),
    };
  }

  broadcast(): void {
    this.io.to(this.code).emit('spies:state', this.gamePublic());
  }

  handleChat(playerId: string, raw: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const text = raw.slice(0, 100).trim();
    if (!text) return;
    this.broadcastChat({ kind: 'chat', playerId, name: player.name, text });
  }
}
