import { CATEGORY_LABELS, GAME_CATEGORY, type GameKind } from '@pic-game/shared';

/** What kind of game this is, as a quiet line under the game's name, in its
 *  colour (from the `--game` variable on an ancestor). The same form as the
 *  status line in the room panel. */
export function CategoryLabel({ kind, className = '' }: { kind: GameKind; className?: string }) {
  return <span className={`gamecat ${className}`}>{CATEGORY_LABELS[GAME_CATEGORY[kind]]}</span>;
}
