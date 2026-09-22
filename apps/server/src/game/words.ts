import { WORDS_EN } from '@pic-game/shared';

/** Offers `count` distinct words, preferring ones this room has not used yet so a
 *  long game does not start repeating itself. */
export function pickWords(count: number, used: Set<string>): string[] {
  let pool = WORDS_EN.filter((w) => !used.has(w));
  if (pool.length < count) {
    used.clear();
    pool = [...WORDS_EN];
  }
  const chosen: string[] = [];
  const copy = [...pool];
  for (let i = 0; i < count && copy.length > 0; i++) {
    const j = Math.floor(Math.random() * copy.length);
    chosen.push(copy.splice(j, 1)[0]!);
  }
  return chosen;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Deliberately omits 0/O and 1/I so a code survives being read aloud. */
export function makeRoomCode(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}
