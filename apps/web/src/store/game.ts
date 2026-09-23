import { create } from 'zustand';
import type {
  CardInstance, ChatMessage, FightPublic, FightRoomState, KungFuPublic, RacePublic, RaceRoomState, KungFuRoomState, Piece, Player,
  RealmsPublic, RealmsRoomState, RealmsSide, RoomSettings, RoomState, Side,
  SkribblRoomState, WordOption,
} from '@pic-game/shared';

const MAX_MESSAGES = 200;

export interface TurnResult {
  word: string;
  deltas: Record<string, number>;
  players: Player[];
  reason: 'timeout' | 'all-guessed' | 'drawer-left';
  /** Present only in the player-suggested mode, and only once the turn is over. */
  authorId?: string;
}

export interface SuggestState {
  open: boolean;
  endsAt: number;
  count: number;
  /** Connected non-drawers still expected to send a word. */
  expected: number;
  /** Everyone is in: the drawer may pick. */
  ready: boolean;
}

interface GameStore {
  connected: boolean;
  /** Our own stable player id, which is how we tell "am I the drawer?". */
  me: string | null;
  room: RoomState | null;
  /** Populated only when we are the drawer. Everyone else holds null. */
  secret: string | null;
  /** Populated only on the drawer's client. */
  choices: WordOption[] | null;
  chooseEndsAt: number | null;
  suggest: SuggestState | null;
  /** Our own submitted word, echoed back by the server. Nobody else's. */
  mySuggestion: string | null;
  suggestError: string | null;
  messages: ChatMessage[];
  turnResult: TurnResult | null;
  final: Player[] | null;
  notice: string | null;
  /** Name of whoever removed us, set only when it happens. */
  kickedBy: string | null;
  /** Our own Star Realms hand. Nobody else's ever arrives. */
  realmsHand: CardInstance[];
  realmsOwed: number;

  setConnected: (c: boolean) => void;
  setMe: (id: string) => void;
  sync: (s: RoomState) => void;
  patchPlayer: (p: Player) => void;
  dropPlayer: (id: string) => void;
  setSettings: (s: RoomSettings) => void;
  setHost: (id: string) => void;
  beginChoosing: (p: { drawerId: string; round: number; endsAt: number; words?: WordOption[] }) => void;
  setSuggest: (s: SuggestState) => void;
  setMySuggestion: (text: string | null) => void;
  setSuggestError: (e: string | null) => void;
  setSecret: (w: string) => void;
  beginDrawing: (turn: NonNullable<SkribblRoomState['turn']>) => void;
  reveal: (index: number, char: string) => void;
  markGuessed: (playerId: string) => void;
  endTurn: (r: TurnResult) => void;
  endGame: (players: Player[]) => void;
  pushMessage: (m: ChatMessage) => void;
  setNotice: (n: string | null) => void;
  setChess: (game: KungFuPublic) => void;
  setRealms: (game: RealmsPublic) => void;
  setFight: (game: FightPublic) => void;
  setRace: (game: RacePublic) => void;
  setRealmsHand: (hand: CardInstance[], owed: number) => void;
  realmsOver: (winner: RealmsSide | null) => void;
  applyChessMove: (m: {
    pieceId: string; to: number; readyAt: number;
    captured?: string; promotedTo?: Piece['type'];
  }) => void;
  chessOver: (winner: Side | null, reason: KungFuPublic['reason']) => void;
  setKickedBy: (name: string) => void;
  reset: () => void;
}

export const useGame = create<GameStore>((set) => ({
  connected: false,
  me: null,
  room: null,
  secret: null,
  choices: null,
  chooseEndsAt: null,
  suggest: null,
  mySuggestion: null,
  suggestError: null,
  messages: [],
  turnResult: null,
  final: null,
  notice: null,
  kickedBy: null,
  realmsHand: [],
  realmsOwed: 0,

  setConnected: (connected) => set({ connected }),
  setMe: (me) => set({ me }),

  sync: (room) => set({ room, turnResult: null }),

  patchPlayer: (p) =>
    set((s) =>
      s.room
        ? {
            room: {
              ...s.room,
              players: s.room.players.some((x) => x.id === p.id)
                ? s.room.players.map((x) => (x.id === p.id ? p : x))
                : [...s.room.players, p],
            },
          }
        : {},
    ),

  dropPlayer: (id) =>
    set((s) =>
      s.room ? { room: { ...s.room, players: s.room.players.filter((p) => p.id !== id) } } : {},
    ),

  setSettings: (settings) =>
    set((s) => (s.room?.kind === 'skribbl' ? { room: { ...s.room, settings } } : {})),
  setHost: (hostId) => set((s) => (s.room ? { room: { ...s.room, hostId } } : {})),

  beginChoosing: (p) =>
    set((s) => ({
      // `words` is present only on the drawer's own socket; for everyone else
      // this is simply "someone is choosing".
      choices: p.words ?? null,
      chooseEndsAt: p.endsAt,
      secret: null,
      turnResult: null,
      mySuggestion: null,
      suggestError: null,
      room: s.room?.kind === 'skribbl'
        ? {
            ...s.room,
            phase: 'choosing',
            round: p.round,
            turn: {
              drawerId: p.drawerId,
              round: p.round,
              turnIndex: s.room.turn?.turnIndex ?? 0,
              mask: '',
              revealed: {},
              endsAt: p.endsAt,
              guessed: [],
            },
            ops: [],
          }
        : null,
    })),

  setSecret: (secret) => set({ secret }),

  setSuggest: (suggest) => set({ suggest }),
  setMySuggestion: (mySuggestion) => set({ mySuggestion, suggestError: null }),
  setSuggestError: (suggestError) => set({ suggestError }),

  beginDrawing: (turn) =>
    set((s) => ({
      choices: null,
      chooseEndsAt: null,
      suggest: null,
      room: s.room?.kind === 'skribbl' ? { ...s.room, phase: 'drawing', turn } : s.room,
    })),

  reveal: (index, char) =>
    set((s) =>
      s.room?.kind === 'skribbl' && s.room.turn
        ? {
            room: {
              ...s.room,
              turn: { ...s.room.turn, revealed: { ...s.room.turn.revealed, [index]: char } },
            },
          }
        : {},
    ),

  markGuessed: (playerId) =>
    set((s) =>
      s.room?.kind === 'skribbl' && s.room.turn && !s.room.turn.guessed.includes(playerId)
        ? {
            room: {
              ...s.room,
              turn: { ...s.room.turn, guessed: [...s.room.turn.guessed, playerId] },
            },
          }
        : {},
    ),

  endTurn: (turnResult) =>
    set((s) => ({
      turnResult,
      secret: null,
      choices: null,
      room: s.room?.kind === 'skribbl'
        ? { ...s.room, phase: 'turnEnd', players: turnResult.players }
        : s.room,
    })),

  endGame: (final) =>
    set((s) => ({
      final,
      turnResult: null,
      room: s.room?.kind === 'skribbl' ? { ...s.room, phase: 'gameEnd', players: final } : s.room,
    })),

  pushMessage: (m) =>
    set((s) => ({ messages: [...s.messages, m].slice(-MAX_MESSAGES) })),

  setNotice: (notice) => set({ notice }),

  setChess: (game) =>
    set((s) => (s.room?.kind === 'kungfu' ? { room: { ...s.room, game } } : {})),

  setRealms: (game) =>
    set((s) => (s.room?.kind === 'realms' ? { room: { ...s.room, game } } : {})),

  setFight: (game) =>
    set((s) => (s.room?.kind === 'fight' ? { room: { ...s.room, game } } : {})),

  setRace: (game) =>
    set((s) => (s.room?.kind === 'race' ? { room: { ...s.room, game } } : {})),

  setRealmsHand: (realmsHand, realmsOwed) => set({ realmsHand, realmsOwed }),

  realmsOver: (winner) =>
    set((s) =>
      s.room?.kind === 'realms'
        ? { room: { ...s.room, game: { ...s.room.game, phase: 'ended', winner } } }
        : {},
    ),

  /** Applies one move to the local board. Cheap enough to re-render on: a
   *  handful of moves a second, versus a stroke stream. */
  applyChessMove: (m) =>
    set((s) => {
      if (s.room?.kind !== 'kungfu') return {};
      const pieces = s.room.game.pieces
        .filter((p) => p.id !== m.captured)
        .map((p) =>
          p.id === m.pieceId
            ? { ...p, square: m.to, readyAt: m.readyAt, type: m.promotedTo ?? p.type }
            : p,
        );
      return { room: { ...s.room, game: { ...s.room.game, pieces } } };
    }),

  chessOver: (winner, reason) =>
    set((s) =>
      s.room?.kind === 'kungfu'
        ? { room: { ...s.room, game: { ...s.room.game, phase: 'ended', winner, reason } } }
        : {},
    ),
  setKickedBy: (kickedBy) => set({ kickedBy }),

  reset: () =>
    set({
      me: null, room: null, secret: null, choices: null, chooseEndsAt: null,
      suggest: null, mySuggestion: null, suggestError: null,
      messages: [], turnResult: null, final: null, notice: null, kickedBy: null,
      realmsHand: [], realmsOwed: 0,
    }),
}));

// ---- selectors ----

/** Narrows the room union. Components for one game read through these, so
 *  touching the other game's fields cannot compile. */
export const selectSkribbl = (s: GameStore): SkribblRoomState | null =>
  s.room && s.room.kind === 'skribbl' ? s.room : null;

export const selectKungFu = (s: GameStore): KungFuRoomState | null =>
  s.room && s.room.kind === 'kungfu' ? s.room : null;

export const selectRealms = (s: GameStore): RealmsRoomState | null =>
  s.room && s.room.kind === 'realms' ? s.room : null;

export const selectFight = (s: GameStore): FightRoomState | null =>
  s.room && s.room.kind === 'fight' ? s.room : null;

export const selectRace = (s: GameStore): RaceRoomState | null =>
  s.room && s.room.kind === 'race' ? s.room : null;

// kept here so components never reach into `ops` and re-render on strokes

export const selectIsDrawer = (s: GameStore): boolean =>
  !!s.me && selectSkribbl(s)?.turn?.drawerId === s.me;

export const selectIsHost = (s: GameStore): boolean => !!s.me && s.room?.hostId === s.me;

export const selectDrawer = (s: GameStore): Player | null => {
  const room = selectSkribbl(s);
  return room?.players.find((p) => p.id === room.turn?.drawerId) ?? null;
};

export const selectHaveGuessed = (s: GameStore): boolean =>
  !!s.me && !!selectSkribbl(s)?.turn?.guessed.includes(s.me);
