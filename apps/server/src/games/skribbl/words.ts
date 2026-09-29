import { WORDS_EN } from '@pic-game/shared';

/** Offers `count` distinct words from `source`, preferring ones this room has
 *  not used yet so a long game does not start repeating itself. */
export function pickWords(count: number, used: Set<string>, source: readonly string[] = WORDS_EN): string[] {
  let pool = source.filter((w) => !used.has(w));
  if (pool.length < count) {
    used.clear();
    pool = [...source];
  }
  const chosen: string[] = [];
  const copy = [...pool];
  for (let i = 0; i < count && copy.length > 0; i++) {
    const j = Math.floor(Math.random() * copy.length);
    chosen.push(copy.splice(j, 1)[0]!);
  }
  return chosen;
}
