export const SUGGEST_MIN_LEN = 3;
export const SUGGEST_MAX_LEN = 20;

export type SuggestReject = 'too-short' | 'too-long' | 'charset' | 'duplicate';

export type SuggestResult =
  | { ok: true; text: string }
  | { ok: false; reason: SuggestReject; message: string };

const MESSAGES: Record<SuggestReject, string> = {
  'too-short': `At least ${SUGGEST_MIN_LEN} letters, please.`,
  'too-long': `Keep it under ${SUGGEST_MAX_LEN} letters.`,
  charset: 'Letters, spaces and hyphens only.',
  duplicate: 'Someone already suggested that one.',
};

/** Trims and collapses runs of whitespace; does not alter casing. */
export function tidySuggestion(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Validates a player-supplied word.
 *
 * The charset restriction is not only about taste: `maskOf` and
 * `pickHintPositions` treat anything that is not a space or hyphen as a letter
 * to hide and reveal, and `judge` normalizes away everything outside
 * `[a-z0-9]`. Digits and punctuation would therefore produce masks and hints
 * that do not line up with what a guess can ever match.
 *
 * `taken` holds the words already suggested this turn, normalized by
 * `suggestionKey`. Duplicates are refused because two identical candidates make
 * the drawer's pick ambiguous and waste a slot.
 */
export function validateSuggestion(raw: unknown, taken: ReadonlySet<string> = new Set()): SuggestResult {
  if (typeof raw !== 'string') return fail('charset');
  const text = tidySuggestion(raw);

  if (!/^[\p{L} -]+$/u.test(text)) return fail('charset');

  const letters = [...text].filter((c) => c !== ' ' && c !== '-').length;
  if (letters < SUGGEST_MIN_LEN) return fail('too-short');
  if (letters > SUGGEST_MAX_LEN) return fail('too-long');

  if (taken.has(suggestionKey(text))) return fail('duplicate');

  return { ok: true, text };
}

/** Case- and spacing-insensitive identity, for duplicate detection. */
export function suggestionKey(text: string): string {
  return tidySuggestion(text).toLowerCase().replace(/[\s-]/g, '');
}

function fail(reason: SuggestReject): SuggestResult {
  return { ok: false, reason, message: MESSAGES[reason] };
}
