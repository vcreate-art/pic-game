/** Guesser points decay with the clock: fast guesses are worth far more than
 *  scraping in at the buzzer, which is what keeps rounds tense. */
export const MAX_GUESS_POINTS = 250;
export const BASE_GUESS_POINTS = 50;
export const FIRST_GUESS_BONUS = 25;

export function guessPoints(msLeft: number, drawTimeSec: number, placement: number): number {
  const frac = Math.max(0, Math.min(1, msLeft / (drawTimeSec * 1000)));
  const base = BASE_GUESS_POINTS + Math.round(MAX_GUESS_POINTS * frac);
  return base + (placement === 0 ? FIRST_GUESS_BONUS : 0);
}

/** The drawer is paid on how many people understood the drawing, so a deliberately
 *  unguessable scribble earns nothing. */
export function drawerPoints(guessedCount: number, totalGuessers: number): number {
  if (totalGuessers <= 0 || guessedCount <= 0) return 0;
  const ratio = guessedCount / totalGuessers;
  return Math.round(BASE_GUESS_POINTS + MAX_GUESS_POINTS * ratio * 0.6);
}

export const AUTHOR_FLOOR = 60;
export const AUTHOR_RANGE = 180;

/**
 * Credit for suggesting a word, in the player-suggested mode.
 *
 * Rises as fewer people crack it — but pays nothing when nobody does. That zero
 * is the whole point: on a purely decreasing curve the best possible submission
 * is gibberish, since the author banks maximum precisely when the turn is ruined
 * for everyone else. Anchoring it at zero makes "hard but gettable" the winning
 * play, and overshooting into impossible costs the author everything.
 *
 * @param solved  guessers who got it, the author excluded
 * @param eligible total guessers, the author excluded
 */
export function authorPoints(solved: number, eligible: number): number {
  if (eligible <= 0 || solved <= 0) return 0;
  const rarity = (eligible - Math.min(solved, eligible)) / eligible;
  return Math.round(AUTHOR_FLOOR + AUTHOR_RANGE * rarity);
}
