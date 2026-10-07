import { CAT_EVENT, type CatEventDetail } from '../components/SleepingCat.js';
import posthog, { isPostHogEnabled } from './posthog.js';

/**
 * Sightings of the rare cat on the join card, so its recordings can be found
 * and watched: `cat_shown` when it appears (`forced` when `?cat` put it
 * there) and `cat_hovered` the first time it's pointed at, with how long
 * that took. Each at most once a page load, however often React mounts it.
 * A sighting is always recorded, whatever the project's replay sampling.
 */
let shownAt: number | null = null;
let hovered = false;

if (isPostHogEnabled) {
  window.addEventListener(CAT_EVENT, (e) => {
    const { what } = (e as CustomEvent<CatEventDetail>).detail;
    if (what === 'shown' && shownAt === null) {
      shownAt = performance.now();
      posthog.startSessionRecording(true);
      posthog.capture('cat_shown', { forced: new URLSearchParams(window.location.search).has('cat') });
    }
    if (what === 'hovered' && shownAt !== null && !hovered) {
      hovered = true;
      posthog.capture('cat_hovered', { seconds_after_shown: Math.round((performance.now() - shownAt) / 100) / 10 });
    }
  });
}
