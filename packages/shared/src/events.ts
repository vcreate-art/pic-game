import type {
  Avatar, CanvasOp, ChatMessage, GameKind, PenTool, Player,
  RoomSettings, RoomState, TurnPublic, WordOption,
} from './types.js';
import type { KungFuPublic, KungFuSettings, Piece, Side, Square } from './kungfu/types.js';

export interface JoinOk {
  ok: true;
  playerId: string;
  /** Presented on reconnect to reclaim the same seat and score. */
  token: string;
  state: RoomState;
}
export interface JoinErr {
  ok: false;
  code: 'NOT_FOUND' | 'FULL' | 'BAD_NAME' | 'IN_PROGRESS' | 'RATE_LIMITED' | 'KICKED';
  message: string;
}
export type JoinAck = JoinOk | JoinErr;

export type SuggestAck =
  | { ok: true; text: string }
  | { ok: false; message: string };

export interface DrawStart {
  id: string;
  tool: PenTool;
  color: string;
  size: number;
  pts: number[];
}

export interface ClientToServerEvents {
  'room:create': (
    p: { name: string; avatar: Avatar; game?: GameKind },
    cb: (r: JoinAck) => void,
  ) => void;
  'room:join': (
    p: { code: string; name: string; avatar: Avatar; token?: string },
    cb: (r: JoinAck) => void,
  ) => void;
  'room:leave': () => void;
  /** Host only. Removes a player and blocks that seat from coming back. */
  'player:kick': (p: { playerId: string }) => void;
  'room:settings': (p: Partial<RoomSettings>) => void;
  'game:start': () => void;

  /** Identified by id, not position: in the player-suggested mode the option
   *  list grows while the drawer is reading it, so an index picked at one moment
   *  can point at a different word by the time it arrives. */
  'word:choose': (p: { id: string }) => void;
  /** One per player per turn; sending again replaces the previous suggestion. */
  'word:suggest': (p: { text: string }, cb?: (r: SuggestAck) => void) => void;

  'draw:start': (p: DrawStart) => void;
  'draw:append': (p: { id: string; pts: number[] }) => void;
  'draw:end': (p: { id: string }) => void;
  'draw:fill': (p: { x: number; y: number; color: string }) => void;
  'canvas:undo': () => void;
  'canvas:clear': () => void;

  'chat:guess': (p: { text: string }) => void;

  // ---- Kung Fu Chess ----
  /** Claim or release a side. The host starts the game once both are taken. */
  'chess:seat': (p: { side: Side | null }) => void;
  'chess:move': (p: { pieceId: string; to: Square }) => void;
  'chess:settings': (p: Partial<KungFuSettings>) => void;
  'chess:rematch': () => void;

  /** Round-trip probe used to estimate clock offset against the server. */
  'time:ping': (cb: (serverNow: number) => void) => void;
}

export interface ServerToClientEvents {
  'state:sync': (s: RoomState) => void;
  'player:joined': (p: Player) => void;
  'player:left': (p: { id: string }) => void;
  'player:updated': (p: Player) => void;
  'room:settings': (s: RoomSettings) => void;
  'host:changed': (p: { hostId: string }) => void;
  /** Sent to the removed player's socket alone, just before they are dropped. */
  'kicked': (p: { by: string }) => void;

  'turn:choosing': (p: {
    drawerId: string;
    round: number;
    endsAt: number;
    /** Present ONLY on the drawer's own socket, and deliberately carries no
     *  authorship — otherwise the drawer could hand a turn to a friend. */
    words?: WordOption[];
  }) => void;
  /** Suggestion window status. Carries COUNTS, never the suggested words —
   *  those go to the drawer alone, and only once `ready` is true. A sender's own
   *  word comes back in the ack. */
  'suggest:state': (p: {
    open: boolean;
    endsAt: number;
    /** How many have been sent. */
    count: number;
    /** How many are still expected, i.e. connected non-drawers. */
    expected: number;
    /** Everyone is in (or timed out): the drawer may now pick. */
    ready: boolean;
  }) => void;
  /** Emitted to the drawer's socket alone. Never broadcast. */
  'word:secret': (p: { word: string }) => void;
  'turn:drawing': (p: TurnPublic) => void;
  'hint:reveal': (p: { index: number; char: string }) => void;
  'turn:end': (p: {
    word: string;
    deltas: Record<string, number>;
    players: Player[];
    reason: 'timeout' | 'all-guessed' | 'drawer-left';
    /** Who suggested the word, revealed only now that the turn is over. */
    authorId?: string;
  }) => void;
  'game:end': (p: { players: Player[] }) => void;

  'draw:start': (p: DrawStart & { by: string }) => void;
  'draw:append': (p: { id: string; pts: number[] }) => void;
  'draw:end': (p: { id: string }) => void;
  'draw:fill': (p: CanvasOp) => void;
  'canvas:undone': (p: { ops: CanvasOp[] }) => void;
  'canvas:cleared': () => void;

  'chat:message': (m: ChatMessage) => void;
  /** Carries a player id and nothing else — echoing the guess text would
   *  print the secret word to everyone still guessing. */
  'guess:correct': (p: { playerId: string; placement: number }) => void;

  // ---- Kung Fu Chess ----
  'chess:state': (p: KungFuPublic) => void;
  /** A piece moved. `readyAt` is when it may move again, in server time. */
  'chess:moved': (p: {
    pieceId: string;
    from: Square;
    to: Square;
    readyAt: number;
    /** Id of the piece taken, if any. */
    captured?: string;
    /** Set when a pawn promoted, so clients can swap the sprite. */
    promotedTo?: Piece['type'];
  }) => void;
  /** The mover's own attempt was refused; nobody else needs to know. */
  'chess:rejected': (p: { pieceId: string; reason: string }) => void;
  'chess:over': (p: { winner: Side | null; reason: KungFuPublic['reason'] }) => void;

  'error': (p: { code: string; message: string }) => void;
}
