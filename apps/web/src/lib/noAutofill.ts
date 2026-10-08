/**
 * For text boxes that are never a saved detail: a nickname, a room code, a
 * guess. Phones read "name" in a label as a contact's name and offer the
 * contact card, and password managers pop their own suggestions over any box
 * they don't recognise; iPhones ignore autocomplete="off" on its own. These
 * tell the browser and the common managers to leave the box alone, and keep
 * autocorrect from turning a guess into a different word.
 */
export const noAutofill = {
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;
