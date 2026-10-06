import type { CSSProperties } from 'react';
import { GAME_LABELS, PLAYABLE_KINDS, type GameKind } from '@pic-game/shared';
import { CategoryLabel } from './CategoryLabel.js';
import { GAME_ICONS } from './gameIcons.js';

/** Where the pointer crossed a cover's edge, so the ink spreads from the
 *  point it came in and drains toward the point it left. Sliding from one
 *  cover to the next, it reads as one stroke passing between them. */
function inkFrom(e: React.PointerEvent<HTMLButtonElement>) {
  const cover = e.currentTarget.firstElementChild as HTMLElement;
  const box = e.currentTarget.getBoundingClientRect();
  cover.style.setProperty('--ex', `${((e.clientX - box.left) / cover.offsetWidth) * 100}%`);
  cover.style.setProperty('--ey', `${((e.clientY - box.top) / cover.offsetHeight) * 100}%`);
}

/**
 * Every game as a box cover, for picking one: on the front page to start a
 * room, and in a room's lobby to switch to another. `note` puts a reason on
 * a cover that can't be picked right now.
 */
export function GameCovers({
  onPick,
  active,
  note,
  className = '',
}: {
  onPick: (kind: GameKind) => void;
  active?: GameKind | null;
  note?: (kind: GameKind) => string | null;
  className?: string;
}) {
  return (
    <div className={`picker ${className}`}>
      {PLAYABLE_KINDS.map((k) => {
        const { icon: Icon, color } = GAME_ICONS[k];
        const why = note?.(k) ?? null;
        return (
          <button
            key={k}
            type="button"
            className={`pick ${active === k ? 'is-active' : ''}`}
            disabled={!!why}
            title={why ?? undefined}
            onClick={() => onPick(k)}
            onPointerEnter={inkFrom}
            onPointerLeave={inkFrom}
            style={{ '--game': color } as CSSProperties}
          >
            <span className="pick__cover">
              <span className="pick__ink" aria-hidden="true" />
              <Icon className="pick__art" strokeWidth={1.75} aria-hidden="true" />
              <span className="pick__text">
                <strong className="pick__name">{GAME_LABELS[k].name}</strong>
                {why ? (
                  <span className="gamecat pick__cat">{why}</span>
                ) : (
                  <CategoryLabel kind={k} className="pick__cat" />
                )}
                <span className="pick__more">
                  <span>{GAME_LABELS[k].blurb}</span>
                </span>
              </span>
            </span>
            {/* Where there's no hover to open the cover, the blurb sits
                under it instead. The one inside already reads it out. */}
            <span className="pick__blurb" aria-hidden="true">{GAME_LABELS[k].blurb}</span>
          </button>
        );
      })}
    </div>
  );
}
