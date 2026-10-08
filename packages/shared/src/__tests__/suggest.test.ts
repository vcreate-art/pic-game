import { describe, expect, it } from 'vitest';
import {
  suggestionKey, tidySuggestion, validateSuggestion,
  CUSTOM_WORDS, maskOf, judge, parseDrawWords, WORDS_EN,
} from '../index.js';

describe('tidySuggestion', () => {
  it('trims and collapses whitespace without touching case', () => {
    expect(tidySuggestion('  Ice   Cream  ')).toBe('Ice Cream');
  });
});

describe('validateSuggestion', () => {
  it('accepts ordinary words', () => {
    expect(validateSuggestion('lighthouse')).toEqual({ ok: true, text: 'lighthouse' });
    expect(validateSuggestion('  ice cream ')).toEqual({ ok: true, text: 'ice cream' });
    expect(validateSuggestion('yo-yo')).toEqual({ ok: true, text: 'yo-yo' });
  });

  it('enforces length on letters, not punctuation', () => {
    expect(validateSuggestion('ab')).toMatchObject({ ok: false, reason: 'too-short' });
    // '- - -' has no letters at all
    expect(validateSuggestion('- - -')).toMatchObject({ ok: false, reason: 'too-short' });
    expect(validateSuggestion('a'.repeat(21))).toMatchObject({ ok: false, reason: 'too-long' });
  });

  it('rejects characters the mask and matcher cannot represent', () => {
    // judge() normalizes away everything outside [a-z0-9], and maskOf treats
    // every non-space/hyphen as a hideable letter, so digits and punctuation
    // produce masks that no guess can ever line up with.
    expect(validateSuggestion('h3llo')).toMatchObject({ ok: false, reason: 'charset' });
    expect(validateSuggestion('what?!')).toMatchObject({ ok: false, reason: 'charset' });
    expect(validateSuggestion('<script>')).toMatchObject({ ok: false, reason: 'charset' });
    expect(validateSuggestion(42)).toMatchObject({ ok: false, reason: 'charset' });
    expect(validateSuggestion('')).toMatchObject({ ok: false });
  });

  it('refuses a word already suggested, ignoring case and spacing', () => {
    const taken = new Set([suggestionKey('Ice Cream')]);
    expect(validateSuggestion('ice cream', taken)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(validateSuggestion('icecream', taken)).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(validateSuggestion('lighthouse', taken)).toMatchObject({ ok: true });
  });

  it('produces words the rest of the game can actually handle', () => {
    const r = validateSuggestion('  Light-House ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(maskOf(r.text)).toBe('_____-_____');
    expect(judge(r.text, r.text)).toBe('correct');
  });
});

describe('the built-in word list', () => {
  it('has no word twice, ignoring case and spacing', () => {
    expect(new Set(WORDS_EN.map(suggestionKey)).size).toBe(WORDS_EN.length);
  });

  it('holds only words a player could have suggested and can guess', () => {
    for (const word of WORDS_EN) {
      expect(validateSuggestion(word), word).toMatchObject({ ok: true, text: word });
      expect(judge(word, word), word).toBe('correct');
    }
  });
});

describe('parseDrawWords', () => {
  it('splits on commas, semicolons and new lines, and tidies each word', () => {
    expect(parseDrawWords('  pizza ,taco\nhot   dog;\n\nice-cream ')).toEqual(['pizza', 'taco', 'hot dog', 'ice-cream']);
  });

  it('keeps the first spelling of a repeat', () => {
    expect(parseDrawWords('Hot Dog, hot dog, hotdog, HOT-DOG')).toEqual(['Hot Dog']);
  });

  it('drops what a suggestion would refuse, since both land on the same pick list', () => {
    expect(parseDrawWords('ok, no, r2d2, <b>, a word far too long to ever draw, café')).toEqual(['café']);
  });

  it('stops at the cap', () => {
    const many = Array.from({ length: CUSTOM_WORDS.max + 50 }, (_, i) => `word ${'x'.repeat(i % 10 + 1)}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26) % 26)}`);
    expect(parseDrawWords(many.join('\n'))).toHaveLength(CUSTOM_WORDS.max);
  });

  it('gives nothing for nothing', () => {
    expect(parseDrawWords('')).toEqual([]);
    expect(parseDrawWords(' , ;\n')).toEqual([]);
  });
});
