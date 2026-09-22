import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@pic-game/shared';
import { IS_PROD, PORT, isAllowedOrigin } from './config.js';
import { RoomManager } from './core/RoomManager.js';
import { makeRoutes } from './http/routes.js';
import { attachSocket } from './socket/index.js';

const app = express();
const corsOrigin = (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) =>
  isAllowedOrigin(origin) ? cb(null, true) : cb(new Error(`Origin not allowed: ${origin}`));

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '32kb' }));

const http = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
  cors: { origin: corsOrigin, credentials: true },
  // Strokes are small and frequent; a short interval keeps a dropped drawer
  // from freezing the canvas for everyone else for long.
  pingInterval: 10_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 64_000,
});

const rooms = new RoomManager(io);
app.use(makeRoutes(rooms));
attachSocket(io, rooms);

http.listen(PORT, () => {
  console.log(`[pic-game] server listening on http://localhost:${PORT}`);
  console.log(
    IS_PROD
      ? '[pic-game] production: only CLIENT_ORIGIN is accepted'
      : '[pic-game] dev: accepting localhost and private-network origins',
  );
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n[pic-game] ${sig} — shutting down`);
    io.close();
    http.close(() => process.exit(0));
  });
}
