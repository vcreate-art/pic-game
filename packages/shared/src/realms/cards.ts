import type { CardDef, Faction } from './types.js';

/**
 * A curated subset of the base set: every faction, both card types, and all of
 * ally, scrap and outpost mechanics.
 *
 * Cards left out for now are the ones that stop mid-turn to ask a question —
 * "scrap a card from your hand or discard", "acquire a ship for free",
 * "put the next ship you acquire on top of your deck". Those need a pending-
 * decision protocol on both the server and the client, which is its own piece
 * of work. Bases that offer a choice are here, because choosing which ability
 * to use is an action their owner takes rather than an interruption.
 */
const def = (c: CardDef): CardDef => c;

// ------------------------------------------------------------------ starters

export const SCOUT = def({
  key: 'scout', name: 'Scout', cost: 0, faction: 'neutral', type: 'ship',
  primary: { trade: 1 },
});
export const VIPER = def({
  key: 'viper', name: 'Viper', cost: 0, faction: 'neutral', type: 'ship',
  primary: { combat: 1 },
});
export const EXPLORER = def({
  key: 'explorer', name: 'Explorer', cost: 2, faction: 'neutral', type: 'ship',
  primary: { trade: 2 },
  scrap: { combat: 2 },
});

// ---------------------------------------------------------------------- blob

const BLOB: CardDef[] = [
  def({ key: 'blob-fighter', name: 'Blob Fighter', cost: 1, faction: 'blob', type: 'ship',
    primary: { combat: 3 }, ally: { draw: 1 }, copies: 3 }),
  def({ key: 'trade-pod', name: 'Trade Pod', cost: 2, faction: 'blob', type: 'ship',
    primary: { trade: 3 }, ally: { combat: 2 }, copies: 3 }),
  def({ key: 'battle-pod', name: 'Battle Pod', cost: 2, faction: 'blob', type: 'ship',
    primary: { combat: 4 }, ally: { combat: 2 }, copies: 2 }),
  def({ key: 'ram', name: 'Ram', cost: 3, faction: 'blob', type: 'ship',
    primary: { combat: 5 }, ally: { combat: 2 }, scrap: { trade: 3 }, copies: 2 }),
  def({ key: 'blob-wheel', name: 'Blob Wheel', cost: 3, faction: 'blob', type: 'base',
    defense: 5, primary: { combat: 1 }, scrap: { trade: 3 }, copies: 3 }),
  def({ key: 'the-hive', name: 'The Hive', cost: 5, faction: 'blob', type: 'base',
    defense: 5, primary: { combat: 3 }, ally: { draw: 1 }, copies: 1 }),
  def({ key: 'battle-blob', name: 'Battle Blob', cost: 6, faction: 'blob', type: 'ship',
    primary: { combat: 8 }, ally: { draw: 1 }, scrap: { combat: 4 }, copies: 1 }),
  def({ key: 'blob-mothership', name: 'Mothership', cost: 7, faction: 'blob', type: 'ship',
    primary: { combat: 6, draw: 1 }, ally: { draw: 1 }, copies: 1 }),
];

// ---------------------------------------------------------- trade federation

const TRADE: CardDef[] = [
  def({ key: 'federation-shuttle', name: 'Federation Shuttle', cost: 1, faction: 'trade', type: 'ship',
    primary: { trade: 2 }, ally: { authority: 4 }, copies: 3 }),
  def({ key: 'cutter', name: 'Cutter', cost: 2, faction: 'trade', type: 'ship',
    primary: { authority: 4, trade: 2 }, ally: { combat: 4 }, copies: 3 }),
  def({ key: 'trading-post', name: 'Trading Post', cost: 3, faction: 'trade', type: 'outpost',
    defense: 4, options: [{ authority: 1 }, { trade: 1 }], scrap: { combat: 3 }, copies: 2 }),
  def({ key: 'barter-world', name: 'Barter World', cost: 4, faction: 'trade', type: 'base',
    defense: 4, options: [{ authority: 2 }, { trade: 2 }], scrap: { combat: 5 }, copies: 2 }),
  def({ key: 'defense-center', name: 'Defense Center', cost: 5, faction: 'trade', type: 'outpost',
    defense: 5, options: [{ authority: 3 }, { combat: 2 }], ally: { combat: 2 }, copies: 2 }),
  def({ key: 'trade-escort', name: 'Trade Escort', cost: 5, faction: 'trade', type: 'ship',
    primary: { authority: 4, combat: 4 }, ally: { draw: 1 }, copies: 1 }),
  def({ key: 'flagship', name: 'Flagship', cost: 6, faction: 'trade', type: 'ship',
    primary: { combat: 5, draw: 1 }, ally: { authority: 5 }, copies: 1 }),
];

// -------------------------------------------------------------- star empire

const STAR: CardDef[] = [
  def({ key: 'imperial-fighter', name: 'Imperial Fighter', cost: 1, faction: 'star', type: 'ship',
    primary: { combat: 2, opponentDiscards: 1 }, ally: { combat: 2 }, copies: 3 }),
  def({ key: 'corvette', name: 'Corvette', cost: 2, faction: 'star', type: 'ship',
    primary: { combat: 1, draw: 1 }, ally: { combat: 2 }, copies: 2 }),
  def({ key: 'imperial-frigate', name: 'Imperial Frigate', cost: 4, faction: 'star', type: 'ship',
    primary: { combat: 4, opponentDiscards: 1 }, ally: { combat: 2 }, scrap: { draw: 1 }, copies: 3 }),
  def({ key: 'survey-ship', name: 'Survey Ship', cost: 3, faction: 'star', type: 'ship',
    primary: { trade: 1, draw: 1 }, copies: 3 }),
  def({ key: 'space-station', name: 'Space Station', cost: 4, faction: 'star', type: 'outpost',
    defense: 4, primary: { combat: 2 }, ally: { combat: 2 }, scrap: { trade: 4 }, copies: 2 }),
  def({ key: 'battlecruiser', name: 'Battlecruiser', cost: 6, faction: 'star', type: 'ship',
    primary: { combat: 5, draw: 1 }, ally: { opponentDiscards: 1 }, copies: 1 }),
  def({ key: 'dreadnaught', name: 'Dreadnaught', cost: 7, faction: 'star', type: 'ship',
    primary: { combat: 7, draw: 1 }, scrap: { combat: 5 }, copies: 1 }),
];

// -------------------------------------------------------------- machine cult

const MACHINE: CardDef[] = [
  def({ key: 'missile-mech', name: 'Missile Mech', cost: 6, faction: 'machine', type: 'ship',
    primary: { combat: 6, draw: 1 }, ally: { draw: 1 }, copies: 1 }),
  def({ key: 'supply-bot', name: 'Supply Bot', cost: 3, faction: 'machine', type: 'ship',
    primary: { trade: 2 }, ally: { combat: 2 }, copies: 3 }),
  def({ key: 'patrol-mech', name: 'Patrol Mech', cost: 4, faction: 'machine', type: 'ship',
    options: [{ trade: 3 }, { combat: 5 }], ally: { draw: 1 }, copies: 2 }),
  def({ key: 'battle-mech', name: 'Battle Mech', cost: 5, faction: 'machine', type: 'ship',
    primary: { combat: 4 }, ally: { draw: 1 }, copies: 1 }),
  def({ key: 'battle-station', name: 'Battle Station', cost: 3, faction: 'machine', type: 'outpost',
    defense: 5, scrap: { combat: 5 }, copies: 2 }),
  def({ key: 'mech-world', name: 'Mech World', cost: 5, faction: 'machine', type: 'outpost',
    defense: 6, primary: { combat: 1 }, copies: 1 }),
  def({ key: 'junkyard', name: 'Junkyard', cost: 6, faction: 'machine', type: 'base',
    defense: 5, primary: { trade: 1, combat: 1 }, copies: 1 }),
  def({ key: 'stealth-needle', name: 'Stealth Needle', cost: 4, faction: 'machine', type: 'ship',
    primary: { combat: 4 }, ally: { combat: 2 }, copies: 1 }),
];

export const TRADE_DECK_DEFS: CardDef[] = [...BLOB, ...TRADE, ...STAR, ...MACHINE];

export const ALL_DEFS: CardDef[] = [SCOUT, VIPER, EXPLORER, ...TRADE_DECK_DEFS];

const BY_KEY = new Map(ALL_DEFS.map((c) => [c.key, c]));

export function cardDef(key: string): CardDef {
  const c = BY_KEY.get(key);
  if (!c) throw new Error(`Unknown card: ${key}`);
  return c;
}

/** The ten cards everyone begins with: eight Scouts and two Vipers. */
export const STARTING_DECK: string[] = [
  ...Array.from({ length: 8 }, () => SCOUT.key),
  ...Array.from({ length: 2 }, () => VIPER.key),
];

/** Explorers are always purchasable and sit outside the trade deck. */
export const EXPLORER_SUPPLY = 10;
export const TRADE_ROW_SIZE = 5;

export function factionOf(key: string): Faction {
  return cardDef(key).faction;
}
