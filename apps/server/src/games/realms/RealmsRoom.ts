import { randomUUID } from 'node:crypto';
import {
  GAME_CAPACITY, EXPLORER_SUPPLY, REALMS_BOUNDS, REALMS_DEFAULTS, REALMS_SIDES, attack,
  buyCard, createGame,
  discardForced, endTurn, playCard, publicView, scrapCard, useCard,
  type AttackTarget, type RealmsPublic, type RealmsSettings, type RealmsSide,
  type RealmsState, type Result, type RoomState,
} from '@pic-game/shared';
import { BaseRoom, type CorePlayer, type IO, type RoomLifecycle } from '../../core/BaseRoom.js';

/**
 * Star Realms: a two-player deckbuilder, turn based.
 *
 * The server holds the only complete copy of the game. Hands and deck order
 * never enter the public state — a player's hand is pushed to their socket
 * alone, and the shuffled order of both decks is known to nobody, which is
 * what stops a client counting cards it should not see.
 */
export class RealmsRoom extends BaseRoom<CorePlayer> {
  readonly kind = 'realms' as const;
  settings: RealmsSettings = { ...REALMS_DEFAULTS };
  phase: RealmsPublic['phase'] = 'lobby';
  seats: Partial<Record<RealmsSide, string | null>> = {};
  private game: RealmsState | null = null;

  constructor(code: string, io: IO) {
    super(code, io);
  }

  // ------------------------------------------------------- BaseRoom contract

  isLobby(): boolean {
    return this.phase === 'lobby';
  }

  lifecycle(): RoomLifecycle {
    return this.isLobby() ? 'lobby' : this.phase === 'ended' ? 'ended' : 'playing';
  }

  /** Seats stay taken, so a restart deals straight back in. */
  protected resetToLobby(): void {
    this.phase = 'lobby';
    this.broadcast();
  }

  get maxPlayers(): number {
    // Two seats, but onlookers are welcome.
    return GAME_CAPACITY.realms;
  }

  protected get minPlayers(): number {
    return 2;
  }

  protected createPlayer(base: CorePlayer): CorePlayer {
    return base;
  }

  protected override onPlayerReconnected(p: CorePlayer): void {
    // Their hand is theirs alone, so it has to be re-sent rather than relied
    // on from a broadcast.
    queueMicrotask(() => this.sendHand(p.id));
  }

  protected override onPlayerDisconnected(p: CorePlayer): boolean {
    return this.handleDeparture(p.id);
  }

  protected override onPlayerRemoved(playerId: string): boolean {
    return this.handleDeparture(playerId);
  }

  private handleDeparture(playerId: string): boolean {
    const side = this.sideOf(playerId);
    if (!side) return false;
    this.seats[side] = null;
    if (this.phase === 'playing') {
      this.finish(side === 'a' ? 'b' : 'a');
    } else {
      this.broadcast();
    }
    return true;
  }

  // ------------------------------------------------------------------ seats

  sideOf(playerId: string): RealmsSide | null {
    return REALMS_SIDES.find((s) => this.seats[s] === playerId) ?? null;
  }

  private allSeated(): boolean {
    return REALMS_SIDES.every((s) => !!this.seats[s]);
  }

  takeSeat(playerId: string, side: RealmsSide | null): void {
    if (this.phase === 'playing') return;
    if (!this.players.has(playerId)) return;

    const held = this.sideOf(playerId);
    if (held) this.seats[held] = null;

    if (side && REALMS_SIDES.includes(side)) {
      if (this.seats[side] && this.seats[side] !== playerId) {
        this.emitError(playerId, 'SEAT_TAKEN', 'Someone is already in that seat.');
        if (held) this.seats[held] = playerId;
        this.broadcast();
        return;
      }
      this.seats[side] = playerId;
    }
    this.broadcast();
  }

  updateSettings(patch: Partial<RealmsSettings>): void {
    if (this.phase === 'playing') return;
    const { min, max } = REALMS_BOUNDS.startingAuthority;
    if (typeof patch.startingAuthority === 'number' && Number.isFinite(patch.startingAuthority)) {
      this.settings.startingAuthority = Math.round(
        Math.max(min, Math.min(max, patch.startingAuthority)),
      );
    }
    this.broadcast();
  }

  // ------------------------------------------------------------------- game

  startGame(byPlayerId: string): void {
    if (byPlayerId !== this.hostId) return;
    if (this.phase === 'playing') return;
    if (!this.allSeated()) {
      this.emitError(byPlayerId, 'NO_SEATS', 'Both seats need a player first.');
      return;
    }
    this.game = createGame(this.settings, Math.random, () => randomUUID());
    this.phase = 'playing';
    this.broadcast();
    this.systemMessage('Game on — build a deck, then blow them up.');
  }

  rematch(byPlayerId: string): void {
    if (this.phase !== 'ended') return;
    if (byPlayerId !== this.hostId && !this.sideOf(byPlayerId)) return;
    if (!this.allSeated()) {
      this.phase = 'lobby';
      this.broadcast();
      return;
    }
    this.phase = 'lobby';
    this.startGame(this.hostId);
  }

  /**
   * Every action funnels through here: check the player owns a seat, run the
   * engine, then push the new state. The engine decides legality; this only
   * decides who is allowed to ask.
   */
  private act(playerId: string, run: (side: RealmsSide, g: RealmsState) => Result): void {
    if (this.phase !== 'playing' || !this.game) {
      return this.emitTo(playerId, 'realms:rejected', { reason: 'The game is not running.' });
    }
    const side = this.sideOf(playerId);
    if (!side) {
      return this.emitTo(playerId, 'realms:rejected', { reason: 'You are watching, not playing.' });
    }
    const result = run(side, this.game);
    if (!result.ok) {
      return this.emitTo(playerId, 'realms:rejected', { reason: result.reason });
    }
    if (this.game.phase === 'ended') this.finish(this.game.winner);
    else this.broadcast();
  }

  play(playerId: string, cardId: string): void {
    this.act(playerId, (side, g) => playCard(g, side, cardId, Math.random));
  }
  use(playerId: string, cardId: string, option: number): void {
    this.act(playerId, (side, g) => useCard(g, side, cardId, option, Math.random));
  }
  scrap(playerId: string, cardId: string): void {
    this.act(playerId, (side, g) => scrapCard(g, side, cardId, Math.random));
  }
  buy(playerId: string, cardId: string): void {
    this.act(playerId, (side, g) => buyCard(g, side, cardId));
  }
  attackWith(playerId: string, target: AttackTarget): void {
    this.act(playerId, (side, g) => attack(g, side, target));
  }
  discard(playerId: string, cardId: string): void {
    this.act(playerId, (side, g) => discardForced(g, side, cardId));
  }
  end(playerId: string): void {
    this.act(playerId, (side, g) => endTurn(g, Math.random));
  }

  private finish(winner: RealmsSide | null): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    if (this.game) {
      this.game.phase = 'ended';
      this.game.winner = winner;
    }
    this.recordWin([winner && this.seats[winner]]);
    this.io.to(this.code).emit('realms:over', { winner });
    this.broadcast();
  }

  // ---------------------------------------------------------------- state

  gamePublic(): RealmsPublic {
    if (this.game) return publicView(this.game, this.seats, this.phase);

    // Before the deal there is nothing but seats and settings. Built directly
    // rather than by dealing a throwaway game to copy the shape from.
    const nobody = {
      authority: this.settings.startingAuthority,
      deckCount: 0, handCount: 0, discardCount: 0, discardTop: null,
      inPlay: [], bases: [],
    };
    return {
      phase: this.phase,
      settings: this.settings,
      seats: { ...this.seats },
      turn: 'a',
      trade: 0,
      combat: 0,
      players: { a: { ...nobody }, b: { ...nobody } },
      tradeRow: [],
      tradeDeckCount: 0,
      explorersLeft: EXPLORER_SUPPLY,
      scrapHeapCount: 0,
      winner: null,
    };
  }

  publicState(): RoomState {
    return {
      kind: 'realms',
      ...this.baseState(),
      game: this.gamePublic(),
    };
  }

  /** The one message carrying private information, addressed to one socket. */
  private sendHand(playerId: string): void {
    const side = this.sideOf(playerId);
    if (!side || !this.game) return;
    const p = this.game.players[side];
    this.emitTo(playerId, 'realms:hand', {
      hand: p.hand.map((c) => ({ ...c })),
      owedDiscards: p.owedDiscards,
    });
  }

  broadcast(): void {
    this.io.to(this.code).emit('realms:state', this.gamePublic());
    this.syncMeta();
    for (const side of REALMS_SIDES) {
      const holder = this.seats[side];
      if (holder) this.sendHand(holder);
    }
  }

  handleChat(playerId: string, raw: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const text = raw.slice(0, 100).trim();
    if (!text) return;
    this.broadcastChat({ kind: 'chat', playerId, name: player.name, text });
  }
}
