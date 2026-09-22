import { randomUUID } from 'node:crypto';
import {
  KUNGFU_BOUNDS, KUNGFU_DEFAULTS, PROMOTES_TO, cooldownFor, initialPieces,
  isLegalMove, isPromotion, type KungFuPublic, type KungFuSeats, type KungFuSettings,
  type Piece, type RoomState, type Side, type Square,
} from '@pic-game/shared';
import { BaseRoom, type CorePlayer, type IO } from '../../core/BaseRoom.js';

/** Absorbs clock-estimate drift between a client's countdown and the server. */
const COOLDOWN_GRACE_MS = 120;

/**
 * Kung Fu Chess: chess with no turns. Both sides move whenever they like, and
 * a piece rests on a cooldown after moving.
 *
 * The server is authoritative over position and cooldown. Moves are discrete
 * events applied one at a time on a single thread, so two pieces racing for a
 * square resolve by arrival order — the second move is simply re-validated
 * against a board that has already changed, and is refused if it no longer
 * makes sense. That is why there is no tick loop here.
 */
export class KungFuRoom extends BaseRoom<CorePlayer> {
  readonly kind = 'kungfu' as const;
  settings: KungFuSettings = { ...KUNGFU_DEFAULTS };
  phase: KungFuPublic['phase'] = 'lobby';
  seats: KungFuSeats = { w: null, b: null };
  private pieces: Piece[] = [];
  private winner: Side | null = null;
  private reason: KungFuPublic['reason'] = null;

  constructor(code: string, io: IO) {
    super(code, io);
  }

  // ------------------------------------------------------- BaseRoom contract

  isLobby(): boolean {
    return this.phase === 'lobby';
  }

  /** Two seats, but onlookers are welcome. */
  get maxPlayers(): number {
    return 12;
  }

  protected get minPlayers(): number {
    return 2;
  }

  protected createPlayer(base: CorePlayer): CorePlayer {
    return base;
  }

  protected override onPlayerDisconnected(p: CorePlayer): boolean {
    return this.handleDeparture(p.id);
  }

  protected override onPlayerRemoved(playerId: string): boolean {
    return this.handleDeparture(playerId);
  }

  protected override onTooFewPlayers(): void {
    // Handled by handleDeparture, which knows which side was vacated.
  }

  /** Losing a seated player ends the game; losing a spectator changes nothing. */
  private handleDeparture(playerId: string): boolean {
    const side = this.sideOf(playerId);
    if (!side) return false;
    this.seats[side] = null;
    if (this.phase === 'playing') {
      this.finish(side === 'w' ? 'b' : 'w', 'opponent-left');
    } else {
      this.broadcast();
    }
    return true;
  }

  // ------------------------------------------------------------------ seats

  sideOf(playerId: string): Side | null {
    if (this.seats.w === playerId) return 'w';
    if (this.seats.b === playerId) return 'b';
    return null;
  }

  /** Claims a side, or releases whichever one this player holds. */
  takeSeat(playerId: string, side: Side | null): void {
    if (this.phase === 'playing') return;
    if (!this.players.has(playerId)) return;

    const held = this.sideOf(playerId);
    if (held) this.seats[held] = null;

    if (side === 'w' || side === 'b') {
      if (this.seats[side] && this.seats[side] !== playerId) {
        this.emitError(playerId, 'SEAT_TAKEN', 'Someone is already playing that side.');
        if (held) this.seats[held] = playerId; // put them back where they were
        this.broadcast();
        return;
      }
      this.seats[side] = playerId;
    }
    this.broadcast();
  }

  updateSettings(patch: Partial<KungFuSettings>): void {
    if (this.phase === 'playing') return;
    const { min, max } = KUNGFU_BOUNDS.cooldownMs;
    if (typeof patch.cooldownMs === 'number' && Number.isFinite(patch.cooldownMs)) {
      this.settings.cooldownMs = Math.round(Math.max(min, Math.min(max, patch.cooldownMs)));
    }
    this.broadcast();
  }

  // ------------------------------------------------------------------- game

  startGame(byPlayerId: string): void {
    if (byPlayerId !== this.hostId) return;
    if (this.phase === 'playing') return;
    if (!this.seats.w || !this.seats.b) {
      this.emitError(byPlayerId, 'NO_SEATS', 'Both sides need a player first.');
      return;
    }
    this.pieces = initialPieces(() => randomUUID());
    this.winner = null;
    this.reason = null;
    this.phase = 'playing';
    this.broadcast();
    this.systemMessage('Game on — no turns, just cooldowns.');
  }

  rematch(byPlayerId: string): void {
    if (this.phase !== 'ended') return;
    if (byPlayerId !== this.hostId && !this.sideOf(byPlayerId)) return;
    if (!this.seats.w || !this.seats.b) {
      this.phase = 'lobby';
      this.broadcast();
      return;
    }
    this.startGame(this.hostId);
  }

  move(playerId: string, pieceId: string, to: Square): void {
    const reject = (reason: string) =>
      this.emitTo(playerId, 'chess:rejected', { pieceId, reason });

    if (this.phase !== 'playing') return reject('The game is not running.');
    const side = this.sideOf(playerId);
    if (!side) return reject('You are watching, not playing.');

    const piece = this.pieces.find((p) => p.id === pieceId);
    if (!piece) return reject('That piece is gone.');
    if (piece.side !== side) return reject('That is not your piece.');

    // A small grace on the boundary. The client counts down against an
    // estimate of server time, and a clock off by a few tens of milliseconds
    // would otherwise show a piece as ready and then have the move bounce.
    // Against multi-second cooldowns this costs nothing.
    const now = Date.now();
    if (piece.readyAt - now > COOLDOWN_GRACE_MS) return reject('Still catching its breath.');

    // Re-checked against the live board, which may have changed since the
    // client decided this move was legal.
    if (!isLegalMove(this.pieces, piece, to)) return reject('That piece cannot go there.');

    const from = piece.square;
    const target = this.pieces.find((p) => p.square === to);
    let captured: string | undefined;
    if (target) {
      captured = target.id;
      this.pieces = this.pieces.filter((p) => p.id !== target.id);
    }

    piece.square = to;
    piece.readyAt = now + cooldownFor(piece.type, this.settings.cooldownMs);

    let promotedTo: Piece['type'] | undefined;
    if (isPromotion(piece, to)) {
      piece.type = PROMOTES_TO;
      promotedTo = PROMOTES_TO;
    }

    this.io.to(this.code).emit('chess:moved', {
      pieceId,
      from,
      to,
      readyAt: piece.readyAt,
      ...(captured ? { captured } : {}),
      ...(promotedTo ? { promotedTo } : {}),
    });

    // No checkmate in real time — taking the king is the win.
    if (target?.type === 'k') this.finish(side, 'king-captured');
  }

  private finish(winner: Side | null, reason: KungFuPublic['reason']): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.winner = winner;
    this.reason = reason;
    this.io.to(this.code).emit('chess:over', { winner, reason });
    this.broadcast();
  }

  // ---------------------------------------------------------------- state

  gamePublic(): KungFuPublic {
    return {
      phase: this.phase,
      settings: this.settings,
      seats: { ...this.seats },
      pieces: this.pieces.map((p) => ({ ...p })),
      winner: this.winner,
      reason: this.reason,
    };
  }

  publicState(): RoomState {
    return {
      kind: 'kungfu',
      code: this.code,
      players: this.publicPlayers(),
      hostId: this.hostId,
      serverTime: Date.now(),
      game: this.gamePublic(),
    };
  }

  broadcast(): void {
    this.io.to(this.code).emit('chess:state', this.gamePublic());
  }

  broadcastState(): void {
    this.io.to(this.code).emit('state:sync', this.publicState());
  }

  handleChat(playerId: string, raw: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const text = raw.slice(0, 100).trim();
    if (!text) return;
    this.broadcastChat({ kind: 'chat', playerId, name: player.name, text });
  }
}
