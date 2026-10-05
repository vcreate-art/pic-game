# Load test

k6, driving whole rooms of simulated players over Socket.IO. `brew install k6`.

```bash
# drawing game only, against a local server (npm run build -w @pic-game/web first,
# so / serves the real page)
k6 run -e MAZE_ROOMS=0 loadtest/game-night.js

# both games, against the live box
k6 run -e BASE_URL=https://your.domain -e PROFILE=stress loadtest/game-night.js
```

One VU is one room. `sio.js` is a minimal Socket.IO client, since k6 has none.

| env | default | |
|---|---|---|
| `BASE_URL` | `http://localhost:3001` | |
| `PROFILE` | `load` | `smoke`, `load`, `stress` (steps to 4×), `spike` (3× at once), `soak` (1h) |
| `ROOMS` | 15 | peak drawing rooms |
| `MAZE_ROOMS` | ROOMS/3 | peak Maze Wars rooms; 0 turns it off |
| `HOLD` | `10m` | how long `load` holds its peak |
| `MIN_PLAYERS` / `MAX_PLAYERS` | 4 / 8 | per room |
| `ROUNDS` / `DRAW_TIME` | 1 / 80 | drawing game settings |
| `GUESS_RATE` | 0.75 | share of guessers who get the word |
| `MAZE_MINUTES` | 3 | |

A drawing game with 6 players takes about 8 minutes, so a short run cuts most
rooms off at ramp-down and `games_finished` stays low. That is expected.

What to watch:

- `rtt_ms`: `time:ping` round trip. The server's event-loop lag, more or less.
- `stroke_fanout_ms`: drawer's stroke to the guessers' sockets.
- `maze_frame_gap_ms`: time between 30Hz frames as one player sees them.
- `socket_dropped`, `join_failed`, `server_errors{code:RATE_LIMITED}`.

Keep the machine running k6 well under full CPU. A busy runner inflates every
latency here, because the senders and receivers share one JS event loop per room.
