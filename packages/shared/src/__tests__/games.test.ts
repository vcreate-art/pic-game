import { describe, expect, it } from 'vitest';
import { CATEGORY_LABELS, GAME_CAPACITY, GAME_CATEGORY, GAME_KINDS } from '../index.js';

describe('per-game tables', () => {
  it('gives every game a category with a label', () => {
    for (const kind of GAME_KINDS) {
      expect(CATEGORY_LABELS[GAME_CATEGORY[kind]]).toBeTruthy();
    }
  });

  it('gives every game a capacity of at least two', () => {
    for (const kind of GAME_KINDS) expect(GAME_CAPACITY[kind]).toBeGreaterThanOrEqual(2);
  });
});
