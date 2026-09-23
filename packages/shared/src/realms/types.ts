export type Faction = 'blob' | 'trade' | 'star' | 'machine' | 'neutral';
export type CardType = 'ship' | 'base' | 'outpost';

export const FACTION_LABEL: Record<Faction, string> = {
  blob: 'Blob',
  trade: 'Trade Federation',
  star: 'Star Empire',
  machine: 'Machine Cult',
  neutral: 'Unaligned',
};

/**
 * What an ability does. Everything here resolves immediately with no question
 * asked of the player — abilities that stop to ask something are the reason
 * a few cards are held back from this set.
 */
export interface Effect {
  trade?: number;
  combat?: number;
  authority?: number;
  draw?: number;
  /** Opponent discards this many at the start of their turn. */
  opponentDiscards?: number;
}

export interface CardDef {
  /** Stable key for the definition, distinct from a dealt card's instance id. */
  key: string;
  name: string;
  cost: number;
  faction: Faction;
  type: CardType;
  /** Bases and outposts only: damage needed to destroy it. */
  defense?: number;
  /** A ship's on-play ability. Bases are activated by their owner instead. */
  primary?: Effect;
  /** Bases with a choice offer several; the owner picks one per turn. */
  options?: Effect[];
  /** Triggers once a second card of the same faction is in play this turn. */
  ally?: Effect;
  /** Available by scrapping this card from play, permanently. */
  scrap?: Effect;
  /** How many copies sit in the trade deck. Absent for starters. */
  copies?: number;
}

/** A dealt card: which definition, plus an identity that survives shuffling. */
export interface CardInstance {
  id: string;
  key: string;
}

export type RealmsPhase = 'lobby' | 'playing' | 'ended';

export interface RealmsSettings {
  /** Starting authority. 50 is the standard game. */
  startingAuthority: number;
}

export const REALMS_DEFAULTS: RealmsSettings = { startingAuthority: 50 };

export const REALMS_BOUNDS = {
  startingAuthority: { min: 20, max: 100 },
} as const;

/** Both players hold a seat; anyone else in the room is watching. */
export type RealmsSide = 'a' | 'b';
export const REALMS_SIDES: readonly RealmsSide[] = ['a', 'b'];

/** What everyone may see about a player. Hand and deck order are absent by
 *  construction — the owner gets those through a separate, private message. */
export interface PlayerPublic {
  authority: number;
  deckCount: number;
  handCount: number;
  discardCount: number;
  /** The discard pile is face up in this game, so its top card is public. */
  discardTop: CardInstance | null;
  /** Ships played this turn, face up. */
  inPlay: CardInstance[];
  /** Bases and outposts, which persist between turns. */
  bases: Array<CardInstance & { used: boolean }>;
}

export interface RealmsPublic {
  phase: RealmsPhase;
  settings: RealmsSettings;
  seats: Partial<Record<RealmsSide, string | null>>;
  /** Whose turn it is. */
  turn: RealmsSide;
  /** Pools the current player has accumulated this turn. */
  trade: number;
  combat: number;
  players: Record<RealmsSide, PlayerPublic>;
  tradeRow: CardInstance[];
  tradeDeckCount: number;
  explorersLeft: number;
  scrapHeapCount: number;
  winner: RealmsSide | null;
}
