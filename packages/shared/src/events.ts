import type {
  Avatar, CanvasOp, ChatMessage, Drawing, GameKind, PenTool, Player,
  RoomMeta, RoomSettings, RoomState, TurnPublic, Vote, WordOption,
} from './types.js';
import type { KungFuPublic, KungFuSettings, Piece, Side, Square } from './kungfu/types.js';
import type {
  CardInstance, RealmsPublic, RealmsSettings, RealmsSide,
} from './realms/types.js';
import type { AttackTarget } from './realms/engine.js';
import type {
  FightEvent, FightFrame, FightPublic, FightSettings, FightSide, FighterId,
} from './fight/types.js';
import type { DeathCause, Ghost, RaceEvent, RacePublic, RaceSettings } from './race/types.js';
import type { CardColor, SpiesPublic, SpiesSettings, SpyRole, SpyTeam } from './spies/types.js';
import type { BingoCard, BingoPublic, BingoSettings } from './bingo/types.js';
import type { CryptidClue, CryptidPublic, CryptidSettings } from './cryptid/types.js';
import type { Flip7Public, Flip7Settings } from './flip7/types.js';
import type { MazeEvent, MazeFrame, MazeInput, MazePublic, MazeSettings } from './maze/types.js';
import type {
  ManualBonus, MatchScore, TourneyBonuses, TourneyPublic, TourneySettings,
} from './tourney/types.js';

export interface JoinOk {
  ok: true;
  playerId: string;
  /** Presented on reconnect to reclaim the same seat and score. */
  token: string;
  state: RoomState;
}
export interface JoinErr {
  ok: false;
  code: 'NOT_FOUND' | 'FULL' | 'BAD_NAME' | 'IN_PROGRESS' | 'RATE_LIMITED' | 'KICKED' | 'HANDOFF';
  message: string;
}
export type JoinAck = JoinOk | JoinErr;
/** A seat picked up by QR code, with the achievements the other device sent. */
export type PickupAck = (JoinOk & { stats: string | null }) | JoinErr;

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
  /** A one-time code to move this seat to another device, for its QR link. */
  /** `ms` is how long it works for: a duration, since the two clocks may differ. */
  'seat:handoff': (
    /** The player's achievements, carried to the other device with the seat. */
    p: { stats?: string },
    cb: (r: { ok: true; token: string; ms: number } | { ok: false }) => void,
  ) => void;
  /** On the other device: takes the seat a code was made for, in whichever
   *  room it is. The seat brings its name and avatar. */
  'seat:pickup': (p: { token: string }, cb: (r: PickupAck) => void) => void;
  /** Host only, outside the lobby: the same game again from the start. A
   *  game in progress is abandoned with no result. */
  'game:restart': () => void;
  /** Host only, mid-game, in games that support it: everything stops until
   *  the host resumes. */
  'room:pause': () => void;
  'room:resume': () => void;
  /** Host only, outside the lobby: back to the lobby, abandoning a game in
   *  progress with no result. */
  'game:toLobby': () => void;
  /** Host only, between games: the room plays a different game next, with
   *  the same code, seats and session. */
  'room:switch': (p: { kind: GameKind }, cb?: (r: { ok: boolean; message?: string }) => void) => void;
  /** Change your own name or avatar mid-room; everyone sees it at once. */
  'player:rename': (p: { name: string; avatar: Avatar }) => void;
  /** Host only. Removes a player and blocks that seat from coming back. */
  'player:kick': (p: { playerId: string }) => void;
  'room:settings': (p: Partial<Omit<RoomSettings, 'customWords'>>) => void;
  /** Host only, in the lobby. Replaces the room's own words with whatever
   *  parses out of `text`. */
  'room:words': (p: { text: string }) => void;
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
  /** Thumbs up or down on the drawing in front of everyone; null takes it back. */
  'draw:react': (p: { vote: Vote | null }) => void;

  // ---- Kung Fu Chess ----
  /** Claim or release a side. The host starts the game once both are taken. */
  'chess:seat': (p: { side: Side | null }) => void;
  'chess:move': (p: { pieceId: string; to: Square }) => void;
  'chess:settings': (p: Partial<KungFuSettings>) => void;
  'chess:rematch': () => void;

  // ---- Star Realms ----
  'realms:seat': (p: { side: RealmsSide | null }) => void;
  'realms:settings': (p: Partial<RealmsSettings>) => void;
  'realms:play': (p: { cardId: string }) => void;
  /** Uses a base, or picks between a card's options. */
  'realms:use': (p: { cardId: string; option: number }) => void;
  'realms:scrap': (p: { cardId: string }) => void;
  'realms:buy': (p: { cardId: string }) => void;
  'realms:attack': (p: { target: AttackTarget }) => void;
  /** Pays down a forced discard owed at the start of your turn. */
  'realms:discard': (p: { cardId: string }) => void;
  'realms:end': () => void;
  'realms:rematch': () => void;

  // ---- Stick Kombat ----
  'fight:seat': (p: { side: FightSide | null }) => void;
  'fight:pick': (p: { fighter: FighterId }) => void;
  'fight:settings': (p: Partial<FightSettings>) => void;
  /**
   * Sent whenever the controls change, not every frame. `held` is the full
   * state; `pressed` carries the buttons that went down since the last send,
   * so a tap shorter than a tick is not lost.
   */
  'fight:input': (p: { seq: number; held: number; pressed: number }) => void;
  'fight:rematch': () => void;
  /** Host only, after a match: back to the lobby to pick again. */
  'fight:toSelect': () => void;

  // ---- Meat Race ----
  'race:settings': (p: Partial<RaceSettings>) => void;
  /** Where our runner is. A dozen a second; only racers are listened to. */
  'race:pos': (p: { seq: number; g: Ghost }) => void;
  'race:checkpoint': (p: { n: number }) => void;
  'race:died': (p: { cause: DeathCause }) => void;
  /** Claimed on touching the flag; the server checks it was plausible. */
  'race:finish': () => void;
  'race:caught': () => void;
  /** Host only, from the podium: back to the lobby. */
  'race:again': () => void;

  // ---- Word Spies ----
  /** Join a team in a role, or `team: null` to watch. */
  'spies:join': (p: { team: SpyTeam | null; role: SpyRole }) => void;
  /** Host only: deal everyone into two teams at random. */
  'spies:shuffle': () => void;
  'spies:settings': (p: Partial<Omit<SpiesSettings, 'customWords'>>) => void;
  /** Host only: their own words, pasted as text. */
  'spies:words': (p: { text: string }) => void;
  /** The spymaster's clue. `word` is null when clues are spoken aloud. */
  'spies:clue': (p: { word: string | null; count: number }) => void;
  /** Point at a card for your team, or stop pointing at it. */
  'spies:mark': (p: { index: number }) => void;
  'spies:reveal': (p: { index: number }) => void;
  /** Stop guessing and hand the turn over. */
  'spies:pass': () => void;
  /** Spoken games only: send the key to this device, for a spymaster at the
   *  table. Typed games give it to the seated spymasters and nobody else. */
  'spies:peek': () => void;
  'spies:rematch': () => void;
  'spies:toLobby': () => void;

  // ---- Bingo ----
  'bingo:settings': (p: Partial<BingoSettings>) => void;
  /** Turns: your filled-in grid, 1 to 25 in your order. Null to go back to
   *  editing it. */
  'bingo:ready': (p: { card: number[] | null }) => void;
  /** Host only: stop waiting for grids; anyone unfinished gets a random one. */
  'bingo:begin': () => void;
  /** Turns: the number you call on your go. */
  'bingo:call': (p: { n: number }) => void;
  /** Caller: daub, or un-daub, a square on your own card. */
  'bingo:daub': (p: { index: number }) => void;
  'bingo:claim': () => void;
  /** Caller, host only: draw the next ball by hand, or hold and resume the draw. */
  'bingo:next': () => void;
  'bingo:pause': () => void;
  'bingo:rematch': () => void;
  'bingo:toLobby': () => void;

  // ---- Cryptid ----
  'cryptid:settings': (p: Partial<CryptidSettings>) => void;
  /** A cube from your own supply: in setup, or the one you owe after a no. */
  'cryptid:cube': (p: { hex: number }) => void;
  /** Ask another player whether the creature could be on a space. */
  'cryptid:question': (p: { target: string; hex: number }) => void;
  'cryptid:search': (p: { hex: number }) => void;
  'cryptid:rematch': () => void;
  'cryptid:toLobby': () => void;

  // ---- Flip 7 ----
  'flip7:settings': (p: Partial<Flip7Settings>) => void;
  'flip7:hit': () => void;
  'flip7:stay': () => void;
  /** Who the action card you drew goes to. */
  'flip7:choose': (p: { target: string }) => void;
  /** Host: deal the next round once the scores are in. */
  'flip7:next': () => void;
  'flip7:rematch': () => void;
  'flip7:toLobby': () => void;

  // ---- Maze Wars ----
  'maze:settings': (p: Partial<MazeSettings>) => void;
  /** One tick of controls. Sent every tick, volatile: a lost one is replaced
   *  by the next a thirtieth of a second later. */
  'maze:input': (p: MazeInput) => void;
  'maze:rematch': () => void;
  'maze:toLobby': () => void;

  // ---- MK11 Tournament: the host runs it, everyone else watches ----
  'tourney:settings': (p: Partial<Omit<TourneySettings, 'bonuses'>> & { bonuses?: Partial<TourneyBonuses> }) => void;
  /** Host: someone without the app, by name. */
  'tourney:add': (p: { name: string; main: string | null }) => void;
  /** Host: everyone in the room who is not entered yet. */
  'tourney:addRoom': () => void;
  'tourney:remove': (p: { id: string }) => void;
  /** Host for anyone; a player for their own entry. */
  'tourney:main': (p: { id: string; main: string | null }) => void;
  'tourney:signUp': () => void;
  'tourney:withdraw': () => void;
  /** Host: put someone else into the match up next. */
  'tourney:swap': (p: { side: 0 | 1; id: string }) => void;
  'tourney:startMatch': () => void;
  'tourney:cancel': () => void;
  'tourney:report': (p: {
    winner: string;
    score: MatchScore;
    bonuses: ManualBonus[];
    chars: { a: string | null; b: string | null } | null;
  }) => void;
  'tourney:undo': () => void;
  'tourney:end': () => void;
  'tourney:toSetup': () => void;
  /** Host: a tournament saved in their browser, after a server restart. */
  'tourney:restore': (p: { state: unknown }) => void;

  /** Round-trip probe used to estimate clock offset against the server. */
  'time:ping': (cb: (serverNow: number) => void) => void;
}

export interface ServerToClientEvents {
  'state:sync': (s: RoomState) => void;
  'player:joined': (p: Player) => void;
  'player:left': (p: { id: string }) => void;
  'player:updated': (p: Player) => void;
  'room:settings': (s: RoomSettings) => void;
  /** Session wins and host permissions, sent when they change. */
  'room:meta': (m: RoomMeta) => void;
  'host:changed': (p: { hostId: string }) => void;
  /** Sent to the removed player's socket alone, just before they are dropped. */
  'kicked': (p: { by: string }) => void;
  /** This tab's seat was taken over: by a newer tab of the same browser, or
   *  by another device it was handed to. */
  'room:replaced': (p: { to: 'tab' | 'device' }) => void;

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
  /** The turn's new deadline, after a pause pushed it back. */
  'turn:clock': (p: { endsAt: number }) => void;
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
  'game:end': (p: { players: Player[]; gallery: Drawing[] }) => void;
  /** The current drawing's reactions, whenever they change. */
  'draw:reactions': (p: { likes: string[]; dislikes: string[] }) => void;

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
  /** Someone is out; the game may still be running for the others. */
  'chess:eliminated': (p: { side: Side; by: Side | null }) => void;
  'chess:over': (p: { winner: Side | null; reason: KungFuPublic['reason'] }) => void;

  // ---- Star Realms ----
  'realms:state': (p: RealmsPublic) => void;
  /**
   * Your own hand, and what you still owe. Sent to one socket only — the
   * public state has no field that could carry a hand.
   */
  'realms:hand': (p: { hand: CardInstance[]; owedDiscards: number }) => void;
  'realms:rejected': (p: { reason: string }) => void;
  'realms:over': (p: { winner: RealmsSide | null }) => void;

  // ---- Stick Kombat ----
  /** Seats, picks, settings and the match result. Sent on change only. */
  'fight:state': (p: FightPublic) => void;
  /** One tick of the match. Sent volatile: a late frame is useless, so a
   *  congested client skips it rather than queueing behind it. */
  'fight:frame': (p: FightFrame) => void;
  /** What happened on those ticks. Reliable, unlike the frames, so no hit,
   *  KO or announcer call is ever skipped. */
  'fight:events': (p: FightEvent[]) => void;

  // ---- Meat Race ----
  'race:state': (p: RacePublic) => void;
  /** Every other racer's latest position. Volatile: a stale one is useless. */
  'race:ghosts': (p: Record<string, Ghost>) => void;
  /** Finishes, deaths and checkpoints, for the feed. Reliable. */
  'race:events': (p: RaceEvent[]) => void;

  // ---- Word Spies ----
  'spies:state': (p: SpiesPublic) => void;
  /** The secret key. Sent to the two spymasters' sockets and nobody else. */
  'spies:key': (p: { key: CardColor[] }) => void;

  // ---- Bingo ----
  'bingo:state': (p: BingoPublic) => void;
  /** Your own card. Sent to your socket alone; null when you have none. */
  'bingo:card': (p: BingoCard | null) => void;

  // ---- Cryptid ----
  'cryptid:state': (p: CryptidPublic) => void;
  /** Your own clue. Sent to your socket alone; null when you have none. */
  'cryptid:clue': (p: { clue: CryptidClue | null }) => void;

  // ---- Flip 7: everything is face up, so the state is the whole story ----
  'flip7:state': (p: Flip7Public) => void;

  // ---- Maze Wars ----
  'maze:state': (p: MazePublic) => void;
  /** One tick of the match. Volatile: a late frame is useless. */
  'maze:frame': (p: MazeFrame) => void;
  /** Hits, kills and spawns. Reliable, so the feed never misses a kill. */
  'maze:events': (p: MazeEvent[]) => void;

  // ---- MK11 Tournament ----
  'tourney:state': (p: TourneyPublic) => void;

  'error': (p: { code: string; message: string }) => void;
}
