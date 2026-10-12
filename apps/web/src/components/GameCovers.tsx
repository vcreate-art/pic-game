import { useEffect, useRef, type CSSProperties } from 'react';
import { GAME_LABELS, GAME_STAGE, PLAYABLE_KINDS, STAGE_LABELS, type GameKind } from '@pic-game/shared';
import posthog, { isPostHogEnabled } from '../lib/posthog.js';
import { CategoryLabel } from './CategoryLabel.js';
import { GAME_ICONS } from './gameIcons.js';

/** How close the pointer comes to a cover's edge, in px, before the ink
 *  starts to reach for it. */
const NEAR = 32;
/** How far the ink bulges in at the edge, in px, with the pointer touching it. */
const BULGE = 20;
/** How far into a cover, as a share of its width or height from the edge the
 *  pointer came in by, before the cover fills. */
const FILL_AT = 1 / 3;

/** Puts the ink's centre at a point on screen, as a share of the cover. */
function placeInk(cover: HTMLElement, x: number, y: number) {
  const box = cover.getBoundingClientRect();
  cover.style.setProperty('--ex', `${((x - box.left) / box.width) * 100}%`);
  cover.style.setProperty('--ey', `${((y - box.top) / box.height) * 100}%`);
}

const coverOf = (pick: HTMLElement) => pick.firstElementChild as HTMLElement;
const inkOf = (pick: HTMLElement) => coverOf(pick).firstElementChild as HTMLElement;

/** Applies a change to the ink's circle at once, with no transition, so it
 *  can then grow from where it was put instead of sliding there. */
function snapInk(pick: HTMLElement, change: () => void) {
  const ink = inkOf(pick);
  ink.style.transition = 'none';
  change();
  void getComputedStyle(ink).clipPath;
  ink.style.transition = '';
}

/** The pointer is a third of the way in: the ink fills the cover. */
function fill(pick: HTMLElement, x: number, y: number) {
  if (pick.classList.contains('is-inked')) return;
  // Out of a bead, the fill grows from the bead where it is. Arriving
  // straight inside (a quick move, or a scroll), it grows from the pointer.
  if (!pick.classList.contains('is-near')) snapInk(pick, () => placeInk(coverOf(pick), x, y));
  pick.classList.remove('is-near');
  pick.classList.add('is-inked');
}

/** A bead of ink bulging in from a point on the cover's edge, `reach` px
 *  across, the way two metaballs reach for each other before they meet. */
function bead(pick: HTMLElement, edgeX: number, edgeY: number, reach: number) {
  const cover = coverOf(pick);
  // From nothing, the bead starts at the edge point and swells from there;
  // after that it follows the pointer. Backing out through the edge, the
  // fill drains to a bead where the pointer left.
  if (!pick.classList.contains('is-near') && !pick.classList.contains('is-inked')) {
    snapInk(pick, () => placeInk(cover, edgeX, edgeY));
  }
  placeInk(cover, edgeX, edgeY);
  cover.style.setProperty('--er', `${reach}px`);
  pick.classList.remove('is-inked');
  pick.classList.add('is-near');
}

/**
 * Where the pointer is against a cover: outside it, how far; inside it, the
 * edge it is nearest (measured as a share of the cover, so a wide cover's
 * sides don't win over its top and bottom) and how far in it is from there.
 */
function against(box: DOMRect, x: number, y: number) {
  const out = Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
  if (out > 0) {
    return { out, edgeX: Math.min(Math.max(x, box.left), box.right), edgeY: Math.min(Math.max(y, box.top), box.bottom), depth: 0, share: 0 };
  }
  const sides = [
    { depth: x - box.left, share: (x - box.left) / box.width, edgeX: box.left, edgeY: y },
    { depth: box.right - x, share: (box.right - x) / box.width, edgeX: box.right, edgeY: y },
    { depth: y - box.top, share: (y - box.top) / box.height, edgeX: x, edgeY: box.top },
    { depth: box.bottom - y, share: (box.bottom - y) / box.height, edgeX: x, edgeY: box.bottom },
  ];
  const side = sides.reduce((a, b) => (b.share < a.share ? b : a));
  return { out: 0, ...side };
}

/** The pointer has moved off: the ink drains toward where it went. */
function clear(pick: HTMLElement, x: number, y: number) {
  if (pick.classList.contains('is-inked')) {
    // Shrinking while it moves is what drains it toward where it left. Ink
    // that has barely spread, from a pointer only passing over, shrinks
    // where it is: dragged across the cover it would show as a stray dot.
    const grown = parseFloat(/circle\(([\d.]+)%/.exec(getComputedStyle(inkOf(pick)).clipPath)?.[1] ?? '0');
    if (grown > 20) placeInk(coverOf(pick), x, y);
  }
  pick.classList.remove('is-inked', 'is-near');
}

/**
 * Inks the covers like metaballs: within NEAR px of a cover, a bead of ink
 * bulges in from its edge toward the pointer, and keeps reaching for it
 * once it's inside. A third of the way in, the cover fills; back out past
 * that, it drains to a bead again. One cover at a time, the nearest, so
 * crossing the gap between two hands the bead from one to the next. Only a
 * mouse inks: on touch the blurb sits under the cover instead.
 */
function useNearInk(ref: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    let current: HTMLElement | null = null;
    let at: { x: number; y: number } | null = null;
    let frame = 0;

    const nearest = (x: number, y: number) => {
      let best: { pick: HTMLElement; at: ReturnType<typeof against> } | null = null;
      for (const pick of grid.children) {
        if (!(pick instanceof HTMLButtonElement) || pick.disabled) continue;
        const at = against(coverOf(pick).getBoundingClientRect(), x, y);
        if (at.out <= NEAR && (!best || at.out < best.at.out)) best = { pick, at };
      }
      return best;
    };
    const update = () => {
      frame = 0;
      if (!at) return;
      const hit = nearest(at.x, at.y);
      if (current && current !== hit?.pick) clear(current, at.x, at.y);
      if (hit) {
        const { pick, at: where } = hit;
        if (where.out > 0) {
          // Outside: the bead grows as the pointer closes in.
          bead(pick, where.edgeX, where.edgeY, (1 - where.out / NEAR) ** 2 * BULGE);
        } else if (where.share >= FILL_AT) {
          fill(pick, at.x, at.y);
        } else {
          // Inside but short of a third: the bead reaches on past the
          // pointer. Back out from the middle, the fill drains to it again.
          bead(pick, where.edgeX, where.edgeY, BULGE + where.depth);
        }
      }
      current = hit?.pick ?? null;
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      at = { x: e.clientX, y: e.clientY };
      soon();
    };
    // Off the window altogether, nothing is near.
    const out = (e: PointerEvent) => {
      if (e.relatedTarget || !at) return;
      if (current) clear(current, at.x, at.y);
      current = null;
      at = null;
    };

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerout', out);
    // Scrolling moves the covers under a still pointer.
    window.addEventListener('scroll', soon, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', out);
      window.removeEventListener('scroll', soon, { capture: true });
    };
  }, [ref]);
}

/** Past this many characters a blurb won't fit an open cover at the usual
 *  size, so the cover sets it smaller (Flip 7's and Maze Wars' today). */
const LONG_BLURB = 78;

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
  useNearInk(ref);
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
            className={`pick ${active === k ? 'is-active' : ''} ${GAME_LABELS[k].blurb.length > LONG_BLURB ? 'is-long' : ''}`}
            disabled={!!why}
            title={why ?? undefined}
            onClick={() => pick(k, i)}
            style={{ '--game': color } as CSSProperties}
          >
            <span className="pick__cover">
              {/* The icon twice: in the game's colour under the ink, and in
                  white inside it, so the ink's own shape cuts between them. */}
              <Icon className="pick__art" strokeWidth={1.75} aria-hidden="true" />
              <span className="pick__ink" aria-hidden="true">
                <Icon className="pick__art pick__art--inked" strokeWidth={1.75} />
              </span>
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
