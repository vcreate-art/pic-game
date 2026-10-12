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
/** The spring that pulls the blob after the pointer: it trails a little,
 *  seems to fly after it, and overshoots a touch before it settles. A
 *  damping ratio of about 0.75 (damping / 2√stiffness). */
const STIFFNESS = 450;
const DAMPING = 32;
/** How much of the way the blob's size moves to its goal in a 60th of a
 *  second, as it swells near a cover or shrinks away from one. */
const FOLLOW = 0.3;
/** How much of the way to filling a cover its ink spreads in a 60th of a
 *  second. */
const SPREAD = 0.14;
/** How much of the way back into the blob a cover's fill drains in a 60th of
 *  a second: quicker than the blob moves, so it catches up with it. */
const DRAIN = 0.4;
/** The pointer's speed, in px per ms, past which it is passing over a cover,
 *  not landing on it: the blob flies on through instead of the cover filling.
 *  Under half of it, a cover fills as soon as the pointer is in; between, the
 *  pointer has to stop first. */
const FAST = 1;
/** How long the pointer is still before it counts as stopped. */
const SETTLE_MS = 80;
/** The most the ink speeds up for a fast pointer: everything runs this many
 *  times quicker at (RUSH - 1) × FAST or more, so a quick sweep finishes as
 *  quickly. */
const RUSH = 6;
/** At full rush, the ink's size and a draining fill move straight at this
 *  many px per (sped-up) ms, to the end, instead of easing out. */
const LINEAR = 1;

/** A per-frame easing share, given for a 60th of a second, made good for a
 *  frame of `dt` ms, so it eases at the same pace on any screen's refresh
 *  rate. */
const ease = (share: number, dt: number) => 1 - (1 - share) ** (dt / (1000 / 60));

/**
 * One frame's step from `from` toward `to`: easing out when the pointer is
 * slow (a share of what's left, so it slows into the end), straight at
 * LINEAR px per ms when it's fast, and a mix of the two between, by `fast`
 * from 0 to 1.
 */
function toward(from: number, to: number, share: number, dt: number, fast: number) {
  const d = to - from;
  const curved = d * ease(share, dt);
  const straight = Math.sign(d) * Math.min(Math.abs(d), LINEAR * dt);
  return from + curved * (1 - fast) + straight * fast;
}

/** How far a point is outside a box, in px; 0 on or inside it. */
function gapTo(box: DOMRect, x: number, y: number) {
  return Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
}

/** From a point, the distance to a box's farthest corner: a circle that big
 *  there covers it all. */
function farCorner(box: DOMRect, x: number, y: number) {
  return Math.hypot(Math.max(x - box.left, box.right - x), Math.max(y - box.top, box.bottom - y));
}

const coverOf = (pick: HTMLElement) => pick.firstElementChild as HTMLElement;

/** A circle of ink, in screen px. */
interface Circle {
  x: number;
  y: number;
  r: number;
}

/**
 * Inks the covers with one blob of ink that follows the pointer on a spring,
 * trailing a little, and shows on whichever covers it overlaps: across the gap between
 * two, part of it on each, cut by their edges, the way metaballs meet. It
 * swells as the pointer closes in on a cover, from a third of the cover's
 * size out. The cover the pointer crosses slowly or comes to rest in fills,
 * spreading from where the blob is; swept across quickly, the blob flies on
 * through instead. Leaving a filled cover, its fill drains back into the
 * blob wherever the blob has got to. All of it is drawn here, frame by
 * frame, so every cover's ink keeps step with the one blob. Only a mouse
 * inks: on touch the blurb sits under the cover instead.
 */
function useNearInk(ref: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    // Where the pointer is, and whether it's still on the page.
    let to: { x: number; y: number } | null = null;
    let away = true;
    // The blob, sprung toward the pointer, and its speed in px per second.
    const blob: Circle = { x: 0, y: 0, r: 0 };
    const pull = { x: 0, y: 0 };
    let drawnAt = 0;
    // Each cover's own circle: the blob itself, or its fill, spreading out
    // or draining back. A cover in the map is filled or still draining.
    const fills = new Map<HTMLElement, Circle>();
    // The pointer's speed, from its last move and smoothed over the last few,
    // and when it last moved: still for a moment, it counts as stopped.
    let speed = 0;
    let lastSpeed = 0;
    let movedAt = 0;
    // How much the ink is sped up just now, from the pointer's speed: it
    // follows the speed up at once and lets go of it over a moment, so a
    // cover landed on after a sweep still fills quickly.
    let rush = 1;
    let frame = 0;
    let settle = 0;

    const picks = () => [...grid.children].filter((c): c is HTMLButtonElement => c instanceof HTMLButtonElement);

    /** Shows a circle on a cover, as much of it as overlaps the cover. */
    const show = (pick: HTMLElement, box: DOMRect, c: Circle) => {
      const cover = coverOf(pick);
      if (c.r > 0.5 && gapTo(box, c.x, c.y) < c.r) {
        cover.style.setProperty('--ex', `${((c.x - box.left) / box.width) * 100}%`);
        cover.style.setProperty('--ey', `${((c.y - box.top) / box.height) * 100}%`);
        cover.style.setProperty('--er', `${c.r}px`);
        pick.classList.add('is-near');
      } else {
        pick.classList.remove('is-near');
      }
    };

    const tick = () => {
      frame = 0;
      if (!to) return;
      const now = performance.now();
      // Time since the last frame drawn, capped so a frame after a pause (or
      // the first) doesn't fling the spring.
      const real = Math.min(drawnAt ? now - drawnAt : 1000 / 60, 50);
      drawnAt = now;
      const pace = now - movedAt >= SETTLE_MS ? 0 : Math.max(speed, lastSpeed);
      rush = Math.max(1 + Math.min(pace / FAST, RUSH - 1), rush * 0.9 ** (real / (1000 / 60)));
      // Sped up, every animation below runs on in this much time, and the
      // faster the pointer, the straighter it runs rather than easing out.
      const dt = real * rush;
      const fast = (rush - 1) / (RUSH - 1);
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
        pull.x = pull.y = 0;
      }
      // In steps of at most a 60th of a second, so a sped-up frame doesn't
      // throw the spring.
      const steps = Math.ceil(dt / (1000 / 60));
      const sec = dt / steps / 1000;
      for (let n = 0; n < steps; n++) {
        pull.x += (STIFFNESS * (to.x - blob.x) - DAMPING * pull.x) * sec;
        pull.y += (STIFFNESS * (to.y - blob.y) - DAMPING * pull.y) * sec;
        blob.x += pull.x * sec;
        blob.y += pull.y * sec;
      }
      blob.r = toward(blob.r, goal, FOLLOW, dt, fast);

      const still = now - movedAt >= SETTLE_MS;
      let busy =
        Math.abs(to.x - blob.x) + Math.abs(to.y - blob.y) + Math.abs(goal - blob.r) > 0.5 ||
        Math.abs(pull.x) + Math.abs(pull.y) > 5 ||
        rush > 1.01;
      let flying = false;

      all.forEach((pick, i) => {
        const box = boxes[i]!;
        if (pick.disabled) {
          fills.delete(pick);
          pick.classList.remove('is-near', 'is-inked');
          return;
        }
        const inside = !away && gapTo(box, to!.x, to!.y) === 0;
        // Landed: in, and slow enough or stopped. Passing over: in, but fast.
        const landed = inside && (pace < FAST / 2 || still);
        if (inside && !landed) flying = true;
        const opened = pick.classList.contains('is-inked');
        if (landed && !opened) {
          pick.classList.add('is-inked');
          // It spreads from wherever the blob is on it, or its fill is.
          if (!fills.has(pick)) fills.set(pick, { ...blob });
        } else if (!inside && opened) {
          pick.classList.remove('is-inked');
        }

        const fill = fills.get(pick);
        if (!fill) {
          show(pick, box, blob);
          return;
        }
        if (pick.classList.contains('is-inked')) {
          // Spreading from where it started until it covers the cover.
          const full = farCorner(box, fill.x, fill.y) + 2;
          fill.r = toward(fill.r, full, SPREAD, dt, fast);
          if (full - fill.r > 0.5) busy = true;
        } else {
          // Draining into the blob, wherever it has got to.
          // Its centre moves as one, along the line to the blob's.
          const dx = blob.x - fill.x;
          const dy = blob.y - fill.y;
          const far = Math.hypot(dx, dy);
          const k = ease(DRAIN, dt) * (1 - fast) + (far ? Math.min(1, (LINEAR * dt) / far) : 1) * fast;
          fill.x += dx * k;
          fill.y += dy * k;
          fill.r = toward(fill.r, blob.r, DRAIN, dt, fast);
          if (Math.abs(blob.x - fill.x) + Math.abs(blob.y - fill.y) + Math.abs(blob.r - fill.r) < 0.5) {
            fills.delete(pick);
          } else {
            busy = true;
          }
        }
        show(pick, box, fills.get(pick) ?? blob);
      });

      // Keep drawing until everything has caught up; and a blob flying over
      // a cover lands once the pointer stops, which no move will come to
      // say, so look again then.
      if (busy) soon();
      // Stopped: the next frame starts the clock afresh.
      else drawnAt = 0;
      clearTimeout(settle);
      if (flying) settle = window.setTimeout(soon, SETTLE_MS);
      if (away && !busy) to = null;
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const dt = e.timeStamp - movedAt;
      lastSpeed = to && !away && dt > 0 && dt < SETTLE_MS ? Math.hypot(e.clientX - to.x, e.clientY - to.y) / dt : 0;
      speed = 0.6 * lastSpeed + 0.4 * speed;
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
