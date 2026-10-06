import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors, { type CorsOptionsDelegate } from 'cors';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@pic-game/shared';
import { IS_PROD, PORT, isAllowedOrigin } from './config.js';
import { RoomManager } from './core/RoomManager.js';
import { makeRoutes } from './http/routes.js';
import { attachSocket } from './socket/index.js';
import { logServerLifecycle, shutdownPostHogLogs } from './posthogLogs.js';

const app = express();
// A delegate rather than a plain origin check, so it can see the Host header and
// let the page this server serves talk back to it.
const corsFor: CorsOptionsDelegate = (req, cb) => {
  const { origin, host } = req.headers;
  if (isAllowedOrigin(origin, host)) cb(null, { origin: true, credentials: true });
  else cb(new Error(`Origin not allowed: ${origin}`));
};

app.use(cors(corsFor));
app.use(express.json({ limit: '32kb' }));

const http = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
  cors: corsFor,
  // Strokes are small and frequent; a short interval keeps a dropped drawer
  // from freezing the canvas for everyone else for long.
  pingInterval: 10_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 64_000,
});

const rooms = new RoomManager(io);
app.use(makeRoutes(rooms));
attachSocket(io, rooms);

// Serve the built client when there is one, so `npm start` is the whole app on
// one port. Same depth from src/ and dist/, so this resolves from either.
const WEB_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (existsSync(WEB_DIST)) {
  // Vite content-hashes everything under assets/, so it can be cached forever.
  app.use('/assets', express.static(`${WEB_DIST}assets`, { immutable: true, maxAge: '1y' }));
  app.use(express.static(WEB_DIST));
  // Client-side routes (/room/ABCD) all load the same page; unknown /api paths still 404.
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(`${WEB_DIST}index.html`));
}

http.listen(PORT, () => {
  logServerLifecycle('server_started');
  console.log(`[pic-game] server listening on http://localhost:${PORT}`);
  console.log(
    IS_PROD
      ? '[pic-game] production: accepting same-origin and CLIENT_ORIGIN only'
      : '[pic-game] dev: accepting localhost and private-network origins',
  );
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n[pic-game] ${sig} — shutting down`);
    logServerLifecycle('server_stopping');
    io.close();
    http.close(() => {
      void shutdownPostHogLogs().finally(() => process.exit(0));
    });
  });
}
