import posthog from 'posthog-js';

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;

export const isPostHogEnabled = Boolean(posthogKey && posthogHost);

if (posthogKey && posthogHost) {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    defaults: '2026-05-30',
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
} else if (import.meta.env.DEV) {
  const missingVariable = posthogKey ? 'VITE_POSTHOG_HOST' : 'VITE_POSTHOG_KEY';
  throw new Error(
    `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
  );
}

export default posthog;
