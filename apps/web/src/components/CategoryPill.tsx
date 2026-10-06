import { CATEGORY_LABELS, GAME_CATEGORY, type GameKind } from '@pic-game/shared';

/** What kind of game this is, in the game's colour (from the `--game`
 *  variable on an ancestor). */
export function CategoryPill({ kind, className = '' }: { kind: GameKind; className?: string }) {
  return <span className={`catpill ${className}`}>{CATEGORY_LABELS[GAME_CATEGORY[kind]]}</span>;
}
