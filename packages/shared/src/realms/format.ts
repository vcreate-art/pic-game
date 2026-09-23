import type { CardDef, Effect } from './types.js';

/** One phrase per thing an ability does, in a fixed order so cards read alike. */
export function describeEffect(e: Effect): string[] {
  const out: string[] = [];
  if (e.trade) out.push(`${e.trade} trade`);
  if (e.combat) out.push(`${e.combat} combat`);
  if (e.authority) out.push(`${e.authority} authority`);
  if (e.draw) out.push(e.draw === 1 ? 'draw a card' : `draw ${e.draw} cards`);
  if (e.opponentDiscards) {
    out.push(
      e.opponentDiscards === 1
        ? 'opponent discards a card'
        : `opponent discards ${e.opponentDiscards}`,
    );
  }
  return out;
}

export interface CardLine {
  /** What triggers it: always, a choice, an ally bonus, or scrapping. */
  kind: 'primary' | 'option' | 'ally' | 'scrap';
  text: string;
}

/** Every line that should appear on a card's face. */
export function describeCard(d: CardDef): CardLine[] {
  const lines: CardLine[] = [];
  if (d.primary) lines.push({ kind: 'primary', text: describeEffect(d.primary).join(', ') });
  for (const o of d.options ?? []) {
    lines.push({ kind: 'option', text: describeEffect(o).join(', ') });
  }
  if (d.ally) lines.push({ kind: 'ally', text: describeEffect(d.ally).join(', ') });
  if (d.scrap) lines.push({ kind: 'scrap', text: describeEffect(d.scrap).join(', ') });
  return lines;
}
