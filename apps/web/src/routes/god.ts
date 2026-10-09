import { createRoute, lazyRouteComponent } from '@tanstack/react-router';
import { Route as rootRoute } from './__root.js';

/** /god: every live room's full state, secrets included, and controls over
 *  it, its clock among them. The server lets in only the GOD_KEY. Loaded on
 *  demand, so players never download it. */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/god',
  component: lazyRouteComponent(() => import('./godView.js')),
});
