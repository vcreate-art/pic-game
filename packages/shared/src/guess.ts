/** Fold case, accents and punctuation so "Ice-Cream" matches "ice cream". */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Bounded Levenshtein: bails out as soon as the distance exceeds `max`,
 *  which is all we need for a "you're close" check. */
export function levenshtein(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

export type GuessVerdict = 'correct' | 'close' | 'wrong';

export function judge(guess: string, word: string): GuessVerdict {
  const g = normalize(guess);
  const w = normalize(word);
  if (!g) return 'wrong';
  if (g === w) return 'correct';
  // Someone who typed every letter in the right order knows the word; the space
  // in "ice cream" should not cost them the point.
  if (g.replace(/ /g, '') === w.replace(/ /g, '')) return 'correct';
  // Only long enough words get a near-miss hint; on a 3-letter word,
  // distance 1 covers too much of the answer space to be fair.
  if (w.length >= 4 && levenshtein(g, w, 1) <= 1) return 'close';
  return 'wrong';
}

/** Letters become '_'; spaces and hyphens stay visible so word shape is a real clue. */
export function maskOf(word: string): string {
  return word.replace(/[^\s-]/g, '_');
}

/** Which mask positions the hints will uncover, chosen up front so reveals are
 *  evenly spread rather than clustering by luck. Never uncovers more than
 *  half the letters minus one — the last letter always has to be earned. */
export function pickHintPositions(word: string, hints: number, rand: () => number): number[] {
  const letterIdx: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (!/[\s-]/.test(word[i]!)) letterIdx.push(i);
  }
  const cap = Math.max(0, Math.floor(letterIdx.length / 2) - 1);
  const n = Math.min(hints, cap);
  // Fisher-Yates over a copy, take the first n.
  for (let i = letterIdx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [letterIdx[i], letterIdx[j]] = [letterIdx[j]!, letterIdx[i]!];
  }
  return letterIdx.slice(0, n).sort((a, b) => a - b);
}
