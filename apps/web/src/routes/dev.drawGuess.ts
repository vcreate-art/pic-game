import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as rootRoute } from './__root.js';

/** /dev/draw-guess: Draw & Guess with a made-up room, to work on its screens
 *  without playing. Added to the router in development only, and loaded on
 *  demand, so it isn't part of a production build. */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/draw-guess',
  component: lazyRouteComponent(() => import('./dev.drawGuessView.js')),
});
