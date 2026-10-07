import posthog from 'posthog-js';
import { loadProfile, PROFILE_EVENT, type Profile } from '../net/socket.js';

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;

// Only the live site reports: a dev server's clicks would muddy the numbers
// and count toward the plan. VITE_POSTHOG_DEV=true opts a dev server in, for
// trying out tracking or a survey before it ships.
const reports = import.meta.env.PROD || import.meta.env.VITE_POSTHOG_DEV === 'true';
export const isPostHogEnabled = Boolean(reports && posthogKey && posthogHost);

if (isPostHogEnabled) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    defaults: '2026-05-30',
    // Nobody signs in, so 'identified_only' (the default) would leave every
    // player personless. This keeps them anonymous but gives each browser a
    // person, so one player's sessions, replays and games line up across visits.
    person_profiles: 'always',
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    // Replays show the page as each player saw it, at their screen size.
    // Whether sessions get recorded at all is the project's replay setting.
    session_recording: {
      // Chat is between friends; inputs are already masked by default.
      maskTextSelector: '.msg__text',
      // The games draw on canvas, which replays blank without this. A few
      // frames a second shows the layout without weighing on play.
      captureCanvas: { recordCanvas: true, canvasFps: 2, canvasQuality: '0.4' },
    },
    enable_heatmaps: true,
    logs: {
      serviceName: 'pic-game-web',
      environment: import.meta.env.PROD ? 'production' : 'development',
    },
  });
  // PostHog already puts screen and viewport size on every event; these are
  // the rest of what decides how the page lays out and how covers open.
  posthog.register({
    device_pixel_ratio: window.devicePixelRatio,
    primary_input: window.matchMedia('(hover: hover)').matches ? 'mouse' : 'touch',
  });
  // The player's chosen name, as a note on their person. Not 'name': PostHog
  // labels people by that, and names change on a whim, so the anonymous id
  // stays the label and this just follows whatever they last went by.
  const notePlayerName = (p: Profile | null) => {
    if (p?.name) posthog.setPersonProperties({ player_name: p.name });
  };
  notePlayerName(loadProfile());
  window.addEventListener(PROFILE_EVENT, (e) => notePlayerName((e as CustomEvent<Profile>).detail));
}

export default posthog;
