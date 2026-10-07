import { useEffect, useRef, type CSSProperties } from 'react';
import { GAME_LABELS, GAME_STAGE, PLAYABLE_KINDS, STAGE_LABELS, type GameKind } from '@pic-game/shared';
import posthog, { isPostHogEnabled } from '../lib/posthog.js';
import { CategoryLabel } from './CategoryLabel.js';
import { GAME_ICONS } from './gameIcons.js';

/** Where the pointer crossed a cover's edge, so the ink spreads from the
 *  point it came in and drains toward the point it left. Sliding from one
 *  cover to the next, it reads as one stroke passing between them. */
function inkFrom(e: React.PointerEvent<HTMLButtonElement>) {
  const pick = e.currentTarget;
  const cover = pick.firstElementChild as HTMLElement;
  const box = pick.getBoundingClientRect();
  const place = () => {
    cover.style.setProperty('--ex', `${((e.clientX - box.left) / cover.offsetWidth) * 100}%`);
    cover.style.setProperty('--ey', `${((e.clientY - box.top) / cover.offsetHeight) * 100}%`);
  };
  const ink = cover.firstElementChild as HTMLElement;
  if (e.type === 'pointerleave') {
    // Shrinking while it moves is what drains it toward where it left. Ink
    // that has barely spread, from a pointer only passing over, shrinks where
    // it is: dragged across the cover it would show as a stray dot.
    const grown = parseFloat(/circle\(([\d.]+)%/.exec(getComputedStyle(ink).clipPath)?.[1] ?? '0');
    if (grown > 20) place();
    pick.classList.remove('is-inked');
    return;
  }
  // Only a mouse inks: on touch the blurb sits under the cover instead.
  if (e.pointerType !== 'mouse') return;
  // The circle's centre and size animate together, so moving the centre as
  // it grows would slide the ink in from wherever it last left. Move it while
  // it's still empty, with no transition, then let it grow from there.
  ink.style.transition = 'none';
  place();
  void getComputedStyle(ink).clipPath;
  ink.style.transition = '';
  pick.classList.add('is-inked');
}

/** How many columns the grid is laying covers out in right now. */
function columnsOf(grid: HTMLElement): number {
  return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
}

/** Reports the grid's shape when it first shows and whenever a resize or
 *  rotation changes its column count, so layouts can be weighed by use. */
function useGridReport(surface: CoverSurface) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = ref.current;
    if (!isPostHogEnabled || !grid) return;
    let reported = 0;
    const report = () => {
      const columns = columnsOf(grid);
      if (!columns || columns === reported) return;
      reported = columns;
      const cover = grid.firstElementChild as HTMLElement | null;
      posthog.capture('game_grid_viewed', {
        surface,
        columns,
        rows: Math.ceil(PLAYABLE_KINDS.length / columns),
        cover_count: PLAYABLE_KINDS.length,
        cover_width: cover ? Math.round(cover.offsetWidth) : null,
        // Covers below the fold need a scroll to be seen at all.
        covers_above_fold: [...grid.children].filter(
          (c) => c.getBoundingClientRect().bottom <= window.innerHeight,
        ).length,
      });
    };
    report();
    const watch = new ResizeObserver(report);
    watch.observe(grid);
    return () => watch.disconnect();
  }, [surface]);
  return ref;
}

/** Where the covers are being shown: the front page, or a lobby's switcher. */
type CoverSurface = 'landing' | 'switcher';

/**
 * Every game as a box cover, for picking one: on the front page to start a
 * room, and in a room's lobby to switch to another. `note` puts a reason on
 * a cover that can't be picked right now.
 */
export function GameCovers({
  onPick,
  active,
  note,
  surface,
  className = '',
}: {
  onPick: (kind: GameKind) => void;
  active?: GameKind | null;
  note?: (kind: GameKind) => string | null;
  surface: CoverSurface;
  className?: string;
}) {
  const ref = useGridReport(surface);
  const pick = (kind: GameKind, index: number) => {
    if (isPostHogEnabled && ref.current) {
      const columns = columnsOf(ref.current);
      posthog.capture('game_cover_clicked', {
        surface,
        game_kind: kind,
        position: index + 1,
        row: Math.floor(index / columns) + 1,
        column: (index % columns) + 1,
        columns,
      });
    }
    onPick(kind);
  };
  return (
    <div ref={ref} className={`picker ${className}`}>
      {PLAYABLE_KINDS.map((k, i) => {
        const { icon: Icon, color } = GAME_ICONS[k];
        const why = note?.(k) ?? null;
        const stage = STAGE_LABELS[GAME_STAGE[k]];
        return (
          <button
            key={k}
            type="button"
            className={`pick ${active === k ? 'is-active' : ''}`}
            disabled={!!why}
            title={why ?? undefined}
            onClick={() => pick(k, i)}
            onPointerEnter={inkFrom}
            onPointerLeave={inkFrom}
            style={{ '--game': color } as CSSProperties}
          >
            <span className="pick__cover">
              <span className="pick__ink" aria-hidden="true" />
              <Icon className="pick__art" strokeWidth={1.75} aria-hidden="true" />
              {stage && <span className="pick__stage">{stage}</span>}
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
