import { useEffect, useRef, type CSSProperties } from 'react';
import { GAME_LABELS, GAME_STAGE, PLAYABLE_KINDS, STAGE_LABELS, type GameKind } from '@pic-game/shared';
import posthog, { isPostHogEnabled } from '../lib/posthog.js';
import { CategoryLabel } from './CategoryLabel.js';
import { GAME_ICONS } from './gameIcons.js';

/** How far out from a cover the blob starts to show, as a share of the
 *  cover's width (approaching a side) or height (the top or bottom). */
const REACH = 1 / 3;
/** The blob's full size, across, as a share of the nearest cover's shorter
 *  side. It grows to that as the pointer closes in on a cover. */
const BLOB = 0.6;
/** How much of the way to the pointer the blob moves each frame. Under 1,
 *  so it trails the pointer and seems to fly after it. */
const FOLLOW = 0.3;
/** Faster than this, in px per ms, the pointer is passing over a cover, not
 *  landing on it: the blob flies on through instead of the cover filling. */
const FAST = 1;
/** How long the pointer is still before the cover under it fills. */
const SETTLE_MS = 80;
/** How long a cover takes to drain back into the blob as the pointer leaves. */
const DRAIN_MS = 450;

/** Puts the ink's centre at a point on screen, as a share of the cover. */
function placeInk(cover: HTMLElement, x: number, y: number) {
  const box = cover.getBoundingClientRect();
  cover.style.setProperty('--ex', `${((x - box.left) / box.width) * 100}%`);
  cover.style.setProperty('--ey', `${((y - box.top) / box.height) * 100}%`);
}

const coverOf = (pick: HTMLElement) => pick.firstElementChild as HTMLElement;
const inkOf = (pick: HTMLElement) => coverOf(pick).firstElementChild as HTMLElement;

/** Applies a change to the ink's circle at once, with no transition. */
function snapInk(pick: HTMLElement, change: () => void) {
  const ink = inkOf(pick);
  ink.style.transition = 'none';
  change();
  void getComputedStyle(ink).clipPath;
  ink.style.transition = '';
}

/** How far a point is outside a box, in px; 0 on or inside it. */
function gapTo(box: DOMRect, x: number, y: number) {
  return Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
}

/**
 * Inks the covers with one blob of ink that follows the pointer, trailing a
 * little, and shows on whichever covers it overlaps: across the gap between
 * two, part of it on each, cut by their edges, the way metaballs meet. It
 * swells as the pointer closes in on a cover, from a third of the cover's
 * size out. The cover the pointer comes to rest in (or crosses slowly)
 * fills from the blob; swept across quickly, the blob flies on through
 * instead, and leaving a filled cover drains it back into the blob. Only a
 * mouse inks: on touch the blurb sits under the cover instead.
 */
function useNearInk(ref: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    // Where the pointer is, and whether it's still on the page.
    let to: { x: number; y: number } | null = null;
    let away = true;
    // The blob, in screen px: it eases toward the pointer each frame.
    const blob = { x: 0, y: 0, r: 0 };
    // The pointer's speed, smoothed over the last few moves, and when it last
    // moved: still for a moment, it counts as stopped whatever it was.
    let speed = 0;
    let movedAt = 0;
    let frame = 0;
    let settle = 0;
    const drains = new Set<number>();

    const picks = () => [...grid.children].filter((c): c is HTMLButtonElement => c instanceof HTMLButtonElement);

    const fill = (pick: HTMLElement, x: number, y: number) => {
      // Out of the blob, the fill grows from the blob where it is.
      if (!pick.classList.contains('is-near')) snapInk(pick, () => placeInk(coverOf(pick), x, y));
      pick.classList.remove('is-near', 'is-draining');
      pick.classList.add('is-inked');
    };
    const drain = (pick: HTMLElement) => {
      pick.classList.remove('is-inked');
      pick.classList.add('is-near', 'is-draining');
      const t = window.setTimeout(() => {
        pick.classList.remove('is-draining');
        drains.delete(t);
      }, DRAIN_MS);
      drains.add(t);
    };
    /** Shows the part of the blob that overlaps a cover, or none of it. */
    const draw = (pick: HTMLElement, box: DOMRect) => {
      const cover = coverOf(pick);
      // Draining, the fill shrinks toward the blob wherever it has gone.
      if ((blob.r > 0.5 && gapTo(box, blob.x, blob.y) < blob.r) || pick.classList.contains('is-draining')) {
        placeInk(cover, blob.x, blob.y);
        cover.style.setProperty('--er', `${blob.r}px`);
        pick.classList.add('is-near');
      } else if (pick.classList.contains('is-near') && !pick.classList.contains('is-draining')) {
        // Nothing of it on this cover: put the circle away unseen.
        snapInk(pick, () => pick.classList.remove('is-near'));
      }
    };

    const tick = () => {
      frame = 0;
      if (!to) return;
      const now = performance.now();
      const all = picks();
      const boxes = all.map((p) => coverOf(p).getBoundingClientRect());

      // The blob's size: full on a cover, smaller further out, gone past a
      // third of the nearest cover's size.
      let goal = 0;
      if (!away) {
        all.forEach((pick, i) => {
          if (pick.disabled) return;
          const box = boxes[i]!;
          const dx = Math.max(box.left - to!.x, 0, to!.x - box.right) / (box.width * REACH);
          const dy = Math.max(box.top - to!.y, 0, to!.y - box.bottom) / (box.height * REACH);
          const near = Math.max(0, 1 - Math.hypot(dx, dy));
          goal = Math.max(goal, near * Math.min(box.width, box.height) * BLOB * 0.5);
        });
      }
      // Grown from nothing, it starts where the pointer is, not where it
      // last faded out.
      if (blob.r < 0.5) {
        blob.x = to.x;
        blob.y = to.y;
      }
      blob.x += (to.x - blob.x) * FOLLOW;
      blob.y += (to.y - blob.y) * FOLLOW;
      blob.r += (goal - blob.r) * FOLLOW;

      const passing = speed > FAST && now - movedAt < SETTLE_MS;
      let flying = false;
      all.forEach((pick, i) => {
        const box = boxes[i]!;
        const inside = !away && gapTo(box, to!.x, to!.y) === 0;
        if (pick.disabled) {
          if (pick.classList.contains('is-near') || pick.classList.contains('is-inked')) {
            snapInk(pick, () => pick.classList.remove('is-near', 'is-inked', 'is-draining'));
          }
          return;
        }
        if (pick.classList.contains('is-inked')) {
          if (inside) return;
          drain(pick);
        } else if (inside && !passing) {
          fill(pick, blob.x, blob.y);
          return;
        }
        if (inside) flying = true;
        draw(pick, box);
      });

      // Keep easing until the blob has caught up with the pointer; and a
      // blob flying over a cover lands once the pointer stops, which no move
      // will come to say, so look again then.
      const moving = Math.abs(to.x - blob.x) + Math.abs(to.y - blob.y) + Math.abs(goal - blob.r) > 0.5;
      if (moving) soon();
      clearTimeout(settle);
      if (flying) settle = window.setTimeout(soon, SETTLE_MS);
      if (away && !moving) to = null;
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const dt = e.timeStamp - movedAt;
      speed = to && !away && dt > 0 && dt < SETTLE_MS
        ? 0.6 * (Math.hypot(e.clientX - to.x, e.clientY - to.y) / dt) + 0.4 * speed
        : 0;
      movedAt = e.timeStamp;
      to = { x: e.clientX, y: e.clientY };
      away = false;
      soon();
    };
    // Off the window altogether: the blob shrinks away where it is.
    const out = (e: PointerEvent) => {
      if (e.relatedTarget || !to) return;
      away = true;
      soon();
    };

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerout', out);
    // Scrolling moves the covers under a still pointer.
    window.addEventListener('scroll', soon, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      drains.forEach((t) => clearTimeout(t));
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
