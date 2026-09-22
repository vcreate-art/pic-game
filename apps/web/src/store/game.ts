import { create } from 'zustand';
import type { ChatMessage, Player, RoomSettings, RoomState, WordOption } from '@pic-game/shared';

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
  beginDrawing: (turn: NonNullable<RoomState['turn']>) => void;
  reveal: (index: number, char: string) => void;
  markGuessed: (playerId: string) => void;
  endTurn: (r: TurnResult) => void;
  endGame: (players: Player[]) => void;
  pushMessage: (m: ChatMessage) => void;
  setNotice: (n: string | null) => void;
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

  setSettings: (settings) => set((s) => (s.room ? { room: { ...s.room, settings } } : {})),
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
      room: s.room
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
      room: s.room ? { ...s.room, phase: 'drawing', turn } : null,
    })),

  reveal: (index, char) =>
    set((s) =>
      s.room?.turn
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
      s.room?.turn && !s.room.turn.guessed.includes(playerId)
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
      room: s.room ? { ...s.room, phase: 'turnEnd', players: turnResult.players } : null,
    })),

  endGame: (final) =>
    set((s) => ({
      final,
      turnResult: null,
      room: s.room ? { ...s.room, phase: 'gameEnd', players: final } : null,
    })),

  pushMessage: (m) =>
    set((s) => ({ messages: [...s.messages, m].slice(-MAX_MESSAGES) })),

  setNotice: (notice) => set({ notice }),
  setKickedBy: (kickedBy) => set({ kickedBy }),

  reset: () =>
    set({
      me: null, room: null, secret: null, choices: null, chooseEndsAt: null,
      suggest: null, mySuggestion: null, suggestError: null,
      messages: [], turnResult: null, final: null, notice: null, kickedBy: null,
    }),
}));

// ---- selectors, kept here so components never reach into `ops` and re-render on strokes ----

export const selectIsDrawer = (s: GameStore): boolean =>
  !!s.me && s.room?.turn?.drawerId === s.me;

export const selectIsHost = (s: GameStore): boolean => !!s.me && s.room?.hostId === s.me;

export const selectDrawer = (s: GameStore): Player | null =>
  s.room?.players.find((p) => p.id === s.room?.turn?.drawerId) ?? null;

export const selectHaveGuessed = (s: GameStore): boolean =>
  !!s.me && !!s.room?.turn?.guessed.includes(s.me);
