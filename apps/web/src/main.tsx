import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { Route as rootRoute } from './routes/__root.js';
import { Route as backstageRoute } from './routes/backstage.js';
import { Route as indexRoute } from './routes/index.js';
import { Route as roomRoute } from './routes/room.$code.js';
import './lib/posthog.js';
import './lib/buttonInk.js';
import './styles.css';

const routeTree = rootRoute.addChildren([indexRoute, roomRoute, backstageRoute]);
const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

// Game state arrives pushed over the socket, so Query only ever holds the
// handful of real HTTP responses — hence the conservative defaults.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});

const el = document.getElementById('root');
if (!el) throw new Error('#root missing from index.html');

createRoot(el).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
