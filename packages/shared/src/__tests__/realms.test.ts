import { describe, expect, it } from 'vitest';
import {
  EXPLORER_SUPPLY, REALMS_DEFAULTS, TRADE_ROW_SIZE, attack, buyCard, cardDef,
  createGame, discardForced, drawCards, endTurn, playCard, scrapCard, shuffle,
  useCard, type CardInstance, type RealmsSide, type RealmsState,
} from '../index.js';

/** Deterministic, so a failing test fails the same way twice. */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
let n = 0;
const ids = () => `c${n++}`;
const game = (seed = 1) => createGame(REALMS_DEFAULTS, seeded(seed), ids);

/** Puts a known card straight into a hand, bypassing the shuffle. */
function give(state: RealmsState, side: RealmsSide, key: string): CardInstance {
  const card = { id: ids(), key };
  state.players[side].hand.push(card);
  return card;
}

describe('setup', () => {
  const s = game();

  it('deals ten cards to each player', () => {
    for (const side of ['a', 'b'] as RealmsSide[]) {
      const p = s.players[side];
      expect(p.deck.length + p.hand.length).toBe(10);
    }
  });

  it('gives the player going first a smaller hand', () => {
    // Three, not five: a full opening hand going first is a real advantage.
    expect(s.players.a.hand).toHaveLength(3);
    expect(s.players.b.hand).toHaveLength(5);
  });

  it('opens a full trade row and keeps Explorers separate', () => {
    expect(s.tradeRow).toHaveLength(TRADE_ROW_SIZE);
    expect(s.explorersLeft).toBe(EXPLORER_SUPPLY);
    expect(s.tradeRow.every((c) => cardDef(c.key).key !== 'explorer')).toBe(true);
  });

  it('starts both players on the settings authority', () => {
    expect(s.players.a.authority).toBe(REALMS_DEFAULTS.startingAuthority);
    expect(s.players.b.authority).toBe(REALMS_DEFAULTS.startingAuthority);
  });
});

describe('drawing', () => {
  it('reshuffles the discard pile when the deck runs out', () => {
    const s = game();
    const p = s.players.a;
    p.discard.push(...p.deck.splice(0));
    p.discard.push(...p.hand.splice(0));
    const total = p.discard.length;
    const drawn = drawCards(p, 5, seeded(7));
    expect(drawn).toHaveLength(5);
    expect(p.deck.length + p.hand.length).toBe(total);
    expect(p.discard).toHaveLength(0);
  });

  it('stops rather than looping when there is nothing left anywhere', () => {
    const s = game();
    const p = s.players.a;
    p.deck = []; p.hand = []; p.discard = [];
    expect(drawCards(p, 5, seeded())).toHaveLength(0);
  });
});

describe('playing cards', () => {
  it('a Scout adds trade, a Viper adds combat', () => {
    const s = game();
    const scout = give(s, 'a', 'scout');
    const viper = give(s, 'a', 'viper');
    playCard(s, 'a', scout.id, seeded());
    playCard(s, 'a', viper.id, seeded());
    expect(s.trade).toBe(1);
    expect(s.combat).toBe(1);
  });

  it('refuses a card that is not in hand, and the other player’s turn', () => {
    const s = game();
    expect(playCard(s, 'a', 'nope', seeded())).toMatchObject({ ok: false });
    const card = give(s, 'b', 'scout');
    expect(playCard(s, 'b', card.id, seeded())).toMatchObject({ ok: false, reason: 'Not your turn.' });
  });

  it('puts a base in play rather than the in-play row', () => {
    const s = game();
    const wheel = give(s, 'a', 'blob-wheel');
    playCard(s, 'a', wheel.id, seeded());
    expect(s.players.a.bases.map((b) => b.key)).toContain('blob-wheel');
    expect(s.players.a.inPlay).toHaveLength(0);
  });
});

describe('ally abilities', () => {
  it('does not fire for a lone card of its faction', () => {
    const s = game();
    const f = give(s, 'a', 'blob-fighter');   // 3 combat, ally: draw
    playCard(s, 'a', f.id, seeded());
    expect(s.combat).toBe(3);
    expect(s.players.a.allied).toHaveLength(0);
  });

  it('fires for BOTH cards when the second of a faction lands', () => {
    const s = game();
    const a = give(s, 'a', 'blob-fighter');   // ally: draw 1
    const b = give(s, 'a', 'trade-pod');      // ally: 2 combat
    playCard(s, 'a', a.id, seeded());
    const handBefore = s.players.a.hand.length;
    playCard(s, 'a', b.id, seeded());
    // Trade Pod's own ally gives 2 combat; Blob Fighter's gives a card. The
    // first card's ally is the one an implementation usually forgets.
    expect(s.combat).toBe(3 + 2);
    expect(s.trade).toBe(3);
    expect(s.players.a.hand.length).toBe(handBefore - 1 + 1); // played one, drew one
    expect(s.players.a.allied).toHaveLength(2);
  });

  it('only fires once per card', () => {
    const s = game();
    const one = give(s, 'a', 'blob-fighter');
    const two = give(s, 'a', 'trade-pod');
    const three = give(s, 'a', 'battle-pod');
    playCard(s, 'a', one.id, seeded());
    playCard(s, 'a', two.id, seeded());
    const combatAfterTwo = s.combat;
    playCard(s, 'a', three.id, seeded());
    // Battle Pod: 4 combat + its own ally 2. Nothing re-fires.
    expect(s.combat).toBe(combatAfterTwo + 4 + 2);
    expect(s.players.a.allied).toHaveLength(3);
  });

  it('never allies on unaligned cards', () => {
    const s = game();
    const a = give(s, 'a', 'scout');
    const b = give(s, 'a', 'scout');
    playCard(s, 'a', a.id, seeded());
    playCard(s, 'a', b.id, seeded());
    expect(s.players.a.allied).toHaveLength(0);
  });

  it('counts a base toward the faction, not just ships', () => {
    const s = game();
    const hive = give(s, 'a', 'the-hive');        // blob base, ally: draw
    const fighter = give(s, 'a', 'blob-fighter'); // blob ship, ally: draw
    playCard(s, 'a', hive.id, seeded());
    playCard(s, 'a', fighter.id, seeded());
    expect(s.players.a.allied).toHaveLength(2);
  });
});

describe('buying', () => {
  it('spends trade and puts the card in the discard pile, not the hand', () => {
    const s = game();
    s.trade = 10;
    const card = s.tradeRow[0]!;
    const cost = cardDef(card.key).cost;
    expect(buyCard(s, 'a', card.id)).toEqual({ ok: true });
    expect(s.trade).toBe(10 - cost);
    expect(s.players.a.discard.map((c) => c.id)).toContain(card.id);
    expect(s.players.a.hand.map((c) => c.id)).not.toContain(card.id);
  });

  it('refills the trade row after a purchase', () => {
    const s = game();
    s.trade = 20;
    buyCard(s, 'a', s.tradeRow[0]!.id);
    expect(s.tradeRow).toHaveLength(TRADE_ROW_SIZE);
  });

  it('refuses when there is not enough trade', () => {
    const s = game();
    s.trade = 0;
    expect(buyCard(s, 'a', s.tradeRow[0]!.id)).toMatchObject({ ok: false });
  });

  it('sells Explorers from their own limited pile', () => {
    const s = game();
    s.trade = 2;
    expect(buyCard(s, 'a', 'explorer')).toEqual({ ok: true });
    expect(s.explorersLeft).toBe(EXPLORER_SUPPLY - 1);
    expect(s.trade).toBe(0);
    s.trade = 2;
    s.explorersLeft = 0;
    expect(buyCard(s, 'a', 'explorer')).toMatchObject({ ok: false });
  });
});

describe('combat', () => {
  it('takes authority off the defender and wins at zero', () => {
    const s = game();
    s.combat = 60;
    expect(attack(s, 'a', { kind: 'player' })).toEqual({ ok: true });
    expect(s.players.b.authority).toBe(0);
    expect(s.phase).toBe('ended');
    expect(s.winner).toBe('a');
  });

  it('spends all combat on the player, not just what was needed', () => {
    const s = game();
    s.combat = 7;
    attack(s, 'a', { kind: 'player' });
    expect(s.players.b.authority).toBe(REALMS_DEFAULTS.startingAuthority - 7);
    expect(s.combat).toBe(0);
  });

  it('cannot reach the player past an outpost', () => {
    const s = game();
    const post = give(s, 'b', 'trading-post'); // outpost, defense 4
    s.players.b.bases.push({ ...post, used: false });
    s.combat = 50;
    expect(attack(s, 'a', { kind: 'player' })).toMatchObject({ ok: false });
    expect(s.players.b.authority).toBe(REALMS_DEFAULTS.startingAuthority);
  });

  it('destroys a base for exactly its defense, leaving the rest', () => {
    const s = game();
    const wheel = give(s, 'b', 'blob-wheel'); // base, defense 5
    s.players.b.bases.push({ ...wheel, used: false });
    s.combat = 8;
    expect(attack(s, 'a', { kind: 'base', cardId: wheel.id })).toEqual({ ok: true });
    expect(s.combat).toBe(3);
    expect(s.players.b.bases).toHaveLength(0);
    expect(s.players.b.discard.map((c) => c.id)).toContain(wheel.id);
  });

  it('refuses a base it cannot afford to destroy', () => {
    const s = game();
    const wheel = give(s, 'b', 'blob-wheel');
    s.players.b.bases.push({ ...wheel, used: false });
    s.combat = 4;
    expect(attack(s, 'a', { kind: 'base', cardId: wheel.id })).toMatchObject({ ok: false });
    expect(s.players.b.bases).toHaveLength(1);
  });

  it('makes outposts die before ordinary bases', () => {
    const s = game();
    const post = give(s, 'b', 'trading-post'); // outpost 4
    const wheel = give(s, 'b', 'blob-wheel');  // base 5
    s.players.b.bases.push({ ...post, used: false }, { ...wheel, used: false });
    s.combat = 20;
    expect(attack(s, 'a', { kind: 'base', cardId: wheel.id })).toMatchObject({ ok: false });
    expect(attack(s, 'a', { kind: 'base', cardId: post.id })).toEqual({ ok: true });
    expect(attack(s, 'a', { kind: 'base', cardId: wheel.id })).toEqual({ ok: true });
  });
});

describe('bases and options', () => {
  it('uses a base once per turn', () => {
    const s = game();
    const wheel = give(s, 'a', 'blob-wheel'); // 1 combat
    playCard(s, 'a', wheel.id, seeded());
    expect(useCard(s, 'a', wheel.id, 0, seeded())).toEqual({ ok: true });
    expect(s.combat).toBe(1);
    expect(useCard(s, 'a', wheel.id, 0, seeded())).toMatchObject({ ok: false });
  });

  it('lets the owner pick between a card’s options', () => {
    const s = game();
    const post = give(s, 'a', 'trading-post'); // 1 authority OR 1 trade
    playCard(s, 'a', post.id, seeded());
    useCard(s, 'a', post.id, 1, seeded());     // take the trade
    expect(s.trade).toBe(1);
    expect(s.players.a.authority).toBe(REALMS_DEFAULTS.startingAuthority);
  });

  it('frees every base again at the start of the next turn', () => {
    const s = game();
    const wheel = give(s, 'a', 'blob-wheel');
    playCard(s, 'a', wheel.id, seeded());
    useCard(s, 'a', wheel.id, 0, seeded());
    endTurn(s, seeded());
    endTurn(s, seeded());
    expect(s.turn).toBe('a');
    expect(s.players.a.bases.every((b) => !b.used)).toBe(true);
  });
});

describe('scrapping', () => {
  it('removes the card from the game and pays out', () => {
    const s = game();
    const ram = give(s, 'a', 'ram'); // 5 combat, scrap: 3 trade
    playCard(s, 'a', ram.id, seeded());
    expect(scrapCard(s, 'a', ram.id, seeded())).toEqual({ ok: true });
    expect(s.trade).toBe(3);
    expect(s.scrapHeap.map((c) => c.id)).toContain(ram.id);
    expect(s.players.a.inPlay).toHaveLength(0);
  });

  it('does not return a scrapped card to the discard pile', () => {
    const s = game();
    const ram = give(s, 'a', 'ram');
    playCard(s, 'a', ram.id, seeded());
    scrapCard(s, 'a', ram.id, seeded());
    endTurn(s, seeded());
    expect(s.players.a.discard.map((c) => c.id)).not.toContain(ram.id);
  });

  it('refuses a card with no scrap ability', () => {
    const s = game();
    const scout = give(s, 'a', 'scout');
    playCard(s, 'a', scout.id, seeded());
    expect(scrapCard(s, 'a', scout.id, seeded())).toMatchObject({ ok: false });
  });
});

describe('forced discards', () => {
  it('blocks everything until they are paid', () => {
    const s = game();
    const fighter = give(s, 'a', 'imperial-fighter'); // opponent discards 1
    playCard(s, 'a', fighter.id, seeded());
    expect(s.players.b.owedDiscards).toBe(1);

    endTurn(s, seeded());
    expect(s.turn).toBe('b');
    const card = s.players.b.hand[0]!;
    expect(buyCard(s, 'b', s.tradeRow[0]!.id)).toMatchObject({ ok: false });
    expect(playCard(s, 'b', card.id, seeded())).toMatchObject({ ok: false });
    expect(endTurn(s, seeded())).toMatchObject({ ok: false });

    expect(discardForced(s, 'b', card.id)).toEqual({ ok: true });
    expect(s.players.b.owedDiscards).toBe(0);
    expect(s.players.b.discard.map((c) => c.id)).toContain(card.id);
    expect(endTurn(s, seeded())).toEqual({ ok: true });
  });
});

describe('ending a turn', () => {
  it('sweeps hand and played ships away, keeps bases, and deals five', () => {
    const s = game();
    const scout = give(s, 'a', 'scout');
    const wheel = give(s, 'a', 'blob-wheel');
    playCard(s, 'a', scout.id, seeded());
    playCard(s, 'a', wheel.id, seeded());
    endTurn(s, seeded());

    expect(s.players.a.inPlay).toHaveLength(0);
    expect(s.players.a.bases.map((b) => b.key)).toContain('blob-wheel');
    expect(s.players.a.discard.map((c) => c.id)).toContain(scout.id);
    expect(s.turn).toBe('b');
  });

  it('draws the finishing player a new hand, and leaves the other alone', () => {
    // The incoming player already holds a hand. Drawing for them here is how
    // you end up with ten cards on the second turn of every game.
    const s = game();
    const beforeB = s.players.b.hand.length;
    endTurn(s, seeded());
    expect(s.players.a.hand).toHaveLength(5);
    expect(s.players.b.hand).toHaveLength(beforeB);
  });

  it('keeps hands at five across several turns', () => {
    const s = game();
    for (let i = 0; i < 6; i++) endTurn(s, seeded(i + 2));
    expect(s.players.a.hand).toHaveLength(5);
    expect(s.players.b.hand).toHaveLength(5);
  });

  it('clears the pools so nothing carries over', () => {
    const s = game();
    s.trade = 9; s.combat = 9;
    endTurn(s, seeded());
    expect(s.trade).toBe(0);
    expect(s.combat).toBe(0);
  });

  it('forgets which allies fired', () => {
    const s = game();
    const a = give(s, 'a', 'blob-fighter');
    const b = give(s, 'a', 'trade-pod');
    playCard(s, 'a', a.id, seeded());
    playCard(s, 'a', b.id, seeded());
    expect(s.players.a.allied.length).toBeGreaterThan(0);
    endTurn(s, seeded());
    expect(s.players.a.allied).toHaveLength(0);
  });
});

describe('shuffle', () => {
  it('keeps every card', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const out = shuffle(items, seeded(3));
    expect(out).toHaveLength(20);
    expect(new Set(out).size).toBe(20);
  });

  it('does not modify the array it was given', () => {
    const items = [1, 2, 3, 4, 5];
    shuffle(items, seeded(5));
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});
