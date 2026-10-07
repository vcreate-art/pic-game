import { create } from 'zustand';
import type {
  BingoCard, BingoPublic, BingoRoomState, CardColor, CryptidClue, CryptidPublic, CryptidRoomState, Flip7Public, Flip7RoomState, MazePublic, MazeRoomState, Drawing, TourneyPublic, TourneyRoomState, CardInstance, ChatMessage, FightPublic, FightRoomState, KungFuPublic, RacePublic,
  RaceRoomState, SpiesPublic, SpiesRoomState, KungFuRoomState, Piece, Player,
  RealmsPublic, RealmsRoomState, RealmsSide, RoomMeta, RoomSettings, RoomState, Side,
  SkribblRoomState, WordOption,
} from '@pic-game/shared';

const MAX_MESSAGES = 200;

/** Everything one game keeps for this player alone. Cleared when the room
 *  switches to a different game, so nothing of the last one leaks into it. */
const noGamePrivate = (): Partial<GameStore> => ({
  secret: null, choices: null, chooseEndsAt: null,
  suggest: null, mySuggestion: null, suggestError: null,
  turnResult: null, final: null,
  realmsHand: [], realmsOwed: 0, spiesKey: null, bingoCard: null, cryptidClue: null,
  gallery: null, galleryOpen: false,
});

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
  /** A newer tab of this browser took our seat. */
  replaced: boolean;
  /** Our own Star Realms hand. Nobody else's ever arrives. */
  realmsHand: CardInstance[];
  realmsOwed: number;
  /** The Word Spies key. Only ever arrives on a spymaster's client. */
  spiesKey: CardColor[] | null;
  /** Our own Bingo card. Nobody else's arrives until the game is over. */
  bingoCard: BingoCard | null;
  /** Our own Cryptid clue. Nobody else's arrives until they leave or the game ends. */
  cryptidClue: CryptidClue | null;
  /** Draw & Guess: the last game's drawings. Outlives the podium, so the
   *  gallery stays open when the room drops back to the lobby. */
  gallery: Drawing[] | null;
  galleryOpen: boolean;

  setConnected: (c: boolean) => void;
  setMe: (id: string) => void;
  sync: (s: RoomState) => void;
  patchPlayer: (p: Player) => void;
  dropPlayer: (id: string) => void;
  setSettings: (s: RoomSettings) => void;
  setHost: (id: string) => void;
  setMeta: (meta: RoomMeta) => void;
  /** Moves the turn's deadline, after a pause pushed it back. */
  setTurnClock: (endsAt: number) => void;
  beginChoosing: (p: { drawerId: string; round: number; endsAt: number; words?: WordOption[] }) => void;
  setSuggest: (s: SuggestState) => void;
  setMySuggestion: (text: string | null) => void;
  setSuggestError: (e: string | null) => void;
  setSecret: (w: string) => void;
  beginDrawing: (turn: NonNullable<SkribblRoomState['turn']>) => void;
  reveal: (index: number, char: string) => void;
  markGuessed: (playerId: string) => void;
  endTurn: (r: TurnResult) => void;
  endGame: (players: Player[], gallery: Drawing[]) => void;
  setReactions: (r: { likes: string[]; dislikes: string[] }) => void;
  setGalleryOpen: (open: boolean) => void;
  pushMessage: (m: ChatMessage) => void;
  setNotice: (n: string | null) => void;
  setChess: (game: KungFuPublic) => void;
  setRealms: (game: RealmsPublic) => void;
  setFight: (game: FightPublic) => void;
  setRace: (game: RacePublic) => void;
  setSpies: (game: SpiesPublic) => void;
  setSpiesKey: (key: CardColor[] | null) => void;
  setBingo: (game: BingoPublic) => void;
  setBingoCard: (card: BingoCard | null) => void;
  setCryptid: (game: CryptidPublic) => void;
  setCryptidClue: (clue: CryptidClue | null) => void;
  setFlip7: (game: Flip7Public) => void;
  setMaze: (game: MazePublic) => void;
  setTourney: (game: TourneyPublic) => void;
  setRealmsHand: (hand: CardInstance[], owed: number) => void;
  realmsOver: (winner: RealmsSide | null) => void;
  applyChessMove: (m: {
    pieceId: string; to: number; readyAt: number;
    captured?: string; promotedTo?: Piece['type'];
  }) => void;
  chessOver: (winner: Side | null, reason: KungFuPublic['reason']) => void;
  setKickedBy: (name: string) => void;
  setReplaced: (replaced: boolean) => void;
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
  replaced: false,
  realmsHand: [],
  realmsOwed: 0,
  spiesKey: null,
  bingoCard: null,
  cryptidClue: null,
  gallery: null,
  galleryOpen: false,

  setConnected: (connected) => set({ connected }),
  setMe: (me) => set({ me }),

  sync: (room) =>
    set((s) => ({
      ...(s.room && s.room.kind !== room.kind ? noGamePrivate() : {}),
      room,
      turnResult: null,
      // A podium snapshot carries the gallery; any other state keeps the one we have.
      ...(room.kind === 'skribbl' && room.gallery.length ? { gallery: room.gallery } : {}),
    })),

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
  setMeta: (meta) => set((s) => (s.room ? { room: { ...s.room, meta } } : {})),
  setTurnClock: (endsAt) =>
    set((s) => ({
      chooseEndsAt: s.chooseEndsAt === null ? null : endsAt,
      suggest: s.suggest ? { ...s.suggest, endsAt } : null,
      room: s.room?.kind === 'skribbl' && s.room.turn ? { ...s.room, turn: { ...s.room.turn, endsAt } } : s.room,
    })),

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
              likes: [],
              dislikes: [],
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

  endGame: (final, gallery) =>
    set((s) => ({
      final,
      gallery,
      turnResult: null,
      room: s.room?.kind === 'skribbl' ? { ...s.room, phase: 'gameEnd', players: final } : s.room,
    })),

  setReactions: ({ likes, dislikes }) =>
    set((s) =>
      s.room?.kind === 'skribbl' && s.room.turn
        ? { room: { ...s.room, turn: { ...s.room.turn, likes, dislikes } } }
        : {},
    ),

  setGalleryOpen: (galleryOpen) => set({ galleryOpen }),

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

  // Back in the lobby the old key means nothing; drop it so it cannot be
  // drawn over the next board before the new one arrives.
  setSpies: (game) =>
    set((s) =>
      s.room?.kind === 'spies'
        ? { room: { ...s.room, game }, ...(game.phase === 'lobby' ? { spiesKey: null } : {}) }
        : {},
    ),
  setSpiesKey: (spiesKey) => set({ spiesKey }),

  setBingo: (game) =>
    set((s) => (s.room?.kind === 'bingo' ? { room: { ...s.room, game } } : {})),
  setBingoCard: (bingoCard) => set({ bingoCard }),

  setCryptid: (game) =>
    set((s) => (s.room?.kind === 'cryptid' ? { room: { ...s.room, game } } : {})),
  setCryptidClue: (cryptidClue) => set({ cryptidClue }),

  setFlip7: (game) =>
    set((s) => (s.room?.kind === 'flip7' ? { room: { ...s.room, game } } : {})),

  setMaze: (game) =>
    set((s) => (s.room?.kind === 'maze' ? { room: { ...s.room, game } } : {})),

  setTourney: (game) =>
    set((s) => (s.room?.kind === 'tourney' ? { room: { ...s.room, game } } : {})),

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
  setReplaced: (replaced) => set({ replaced }),

  reset: () =>
    set({ ...noGamePrivate(), me: null, room: null, messages: [], notice: null, kickedBy: null, replaced: false }),
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

export const selectSpies = (s: GameStore): SpiesRoomState | null =>
  s.room && s.room.kind === 'spies' ? s.room : null;

export const selectBingo = (s: GameStore): BingoRoomState | null =>
  s.room && s.room.kind === 'bingo' ? s.room : null;

export const selectCryptid = (s: GameStore): CryptidRoomState | null =>
  s.room && s.room.kind === 'cryptid' ? s.room : null;

export const selectFlip7 = (s: GameStore): Flip7RoomState | null =>
  s.room && s.room.kind === 'flip7' ? s.room : null;

export const selectMaze = (s: GameStore): MazeRoomState | null =>
  s.room && s.room.kind === 'maze' ? s.room : null;

export const selectTourney = (s: GameStore): TourneyRoomState | null =>
  s.room && s.room.kind === 'tourney' ? s.room : null;

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
