# pic-game

A [skribbl.io](https://skribbl.io/)-style multiplayer drawing and guessing game.
One player draws a secret word; everyone else races to guess it in chat. Points
scale with how fast you guess.

## Running it

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- Server: http://localhost:3001 (Vite proxies `/api`, `/health` and `/socket.io` to it)

Open a second browser window (or an incognito one) to play against yourself —
a seat is per-tab, so two tabs are two players.

### Playing over your Wi-Fi

Vite binds every interface, so it prints a Network address on startup:

```
➜  Network: http://<your-lan-ip>:5173/
```

Share that with anyone on the same Wi-Fi. In development the server accepts
localhost and the RFC1918 private ranges (10.x, 192.168.x, 172.16–31.x), so no
configuration is needed. The in-game invite link is built from the address you
opened, so it already points at the right host.

In production nothing is inferred — set `CLIENT_ORIGIN` (comma-separated) to the
origins you want to allow, or only same-origin requests get through.

## Stack

| Layer | Choice |
|---|---|
| Transport | Socket.IO, typed both ends from one shared event map |
| Server | Node + TypeScript + Express (Express only serves `/health` and two JSON routes) |
| Game state | In-memory `Map<code, Room>` — no database |
| Frontend | React + Vite, TanStack Router, Zustand, TanStack Query for the two real fetches |
| Monorepo | npm workspaces |

```
packages/shared   protocol: event map, types, scoring, guess matching, word list
apps/server       rooms, turn state machine, authorization, rate limiting
apps/web          canvas engine, UI, socket bindings
scripts/          headless multi-client integration suite
```

`packages/shared` is the keystone: the Socket.IO generics are instantiated from it
on both sides, so a protocol change is a compile error rather than a runtime mystery.

## Word modes

**Built-in** (default) — the server picks each turn's candidates from the shipped list.

**Players suggest** — each turn the non-drawing players propose a word and the drawer
picks from what arrives. The list is topped up with built-in words so the drawer always
has a real choice, and the padding is indistinguishable from the suggestions.

The `choosing` phase runs in two stages. First everyone writes: the drawer sees only a
tally, never the words, so nobody's suggestion can be beaten to the punch by a faster
typist. The moment the last connected player sends theirs, collecting closes and the
drawer gets a fresh clock to pick. Players who drop out stop being waited on, and a
backstop timer covers anyone who stays connected but silent.

That mode has one structural hazard: whoever suggested the chosen word knows the answer.
Three rules keep it from wrecking the game:

- **Authorship stays hidden until the turn ends**, so a drawer cannot deliberately hand
  a turn to a friend.
- **The author cannot score on their own word.** Typing it is swallowed rather than
  rejected — letting it fall through to ordinary chat would print the answer to everyone
  still guessing. They are excluded from the guesser count too, or the "everybody
  guessed" early end could never fire.
- **The author earns more the fewer people solve it, and nothing at all when nobody
  does.** That zero is load-bearing. On a purely decreasing curve the best possible
  submission is gibberish: the author banks maximum precisely when the turn is ruined for
  everyone else, which makes griefing the dominant strategy. Anchoring zero guesses at
  zero points makes "hard but gettable" the winning play instead.

Because the bonus also collapses when *everyone* gets it, the author has no reason to
blurt the answer — the incentives police the leak, so no chat restriction is needed.
The mode wants 4+ players: with three, there is a single eligible guesser and the curve
collapses to all-or-nothing.

## Removing players

The host can remove anyone from the lobby tiles or the in-game scoreboard. It takes two
clicks, since it is irreversible from the other person's side. Removal runs through the
same path as a disconnect, so a removed drawer ends the turn and a removed host hands
over.

Be clear about what a kick is here: with no accounts, it is a **soft block**. It stops
the client reconnecting and stops them returning through the invite link on the same
seat, which covers ordinary nuisance. Someone determined can clear their session and
come back as a new player. Keying the block on IP would be stronger but would eject
everyone behind the same router — which is exactly how people play this over home Wi-Fi.

## How the secret stays secret

The whole game hinges on hiding the word from the people trying to guess it, which
is why the server is authoritative and the client is only a renderer:

- `word:secret` is emitted to the **drawer's socket alone** and never broadcast.
  `TurnPublic` — the shape every other player receives — has no field that could
  carry the word, so the type system enforces the invariant.
- A correct guess is **never echoed as chat text**. It broadcasts `guess:correct`
  with a player id, because printing the winning guess would hand the word to
  everyone still guessing.
- The **server owns the clock**. Clients render a countdown against a server
  timestamp; a client that lies about time changes nothing.
- Drawing authorization is re-checked **per event**, not per connection, so a
  client that keeps emitting after its turn ends is ignored.
- Colours and brush sizes are validated against the palette rather than accepted
  as free strings, keeping arbitrary CSS out of other players' canvases.

### `Player.id` is not `socket.id`

Socket.IO issues a **new** `socket.id` on every reconnect. Keying players by it
silently clones people and drops their scores, so each player gets a stable id plus
a bearer token (held in `sessionStorage`) that reclaims the same seat within 60s.

## Drawing

Strokes travel as geometry, never pixels:

- Coordinates are normalized to a fixed 800×600 logical canvas and quantized to
  12-bit ints, so a stroke drawn on a phone lands in the same place on a desktop.
- Pointer input is captured with `getCoalescedEvents()` for full input rate, then
  **batched into 50ms frames** (~20 msgs/sec instead of ~120).
- The drawer paints locally first and never waits for the round trip.
- All painting happens on a fixed offscreen canvas that is blitted scaled to the
  visible one. Resizing is a re-blit, and **flood fill operates on an identical
  pixel grid on every client** — which is why only the seed point travels, not a
  region of pixels.
- Stroke events go **straight to the canvas engine and never touch React state**,
  so a fast drawer produces zero re-renders.

## Stick Kombat

A two-player MK11-style fighter, and the one real-time game here. The server runs
the shared sim (`packages/shared/src/fight`) on a fixed 60 Hz step and is the only
authority on who hit whom; clients send controller changes and draw what comes back.

- **Frames are volatile, events are not.** A snapshot that arrives late is useless,
  so a congested client skips it rather than queueing. Hits, KOs and announcer calls
  travel on a separate reliable channel, so none is ever lost.
- **Inputs carry edges.** Each update has the held buttons plus the ones pressed
  since the last send, so a tap shorter than a tick still lands.
- **No client prediction yet.** On home Wi-Fi the round trip is well under a frame.
  The sim is pure and shared, so prediction can be added without restructuring.
- A fighter who drops mid-match freezes it for ten seconds before forfeiting.

Controls: WASD to move, U I J K for 1–4, L or Space to block, H to throw, O for
Fatal Blow. F2 toggles a hitbox overlay.

## Meat Race

A Super Meat Boy style race for up to eight, with Hollow Knight / Silksong movement:
instant control, a jump that rises while held, wall cling and wall-jump climbing, a
dash that turns into a sprint when held, a double jump shown as wings on your back, and
a glide once the double jump is spent. Run it through a cup of levels while saws, lasers, cannons and a chasing wall (the
grinder) try to stop you. Dying sends you back to your last flag; the grinder ends your
level. Points go 10, 8, 6, 5, 4, 3, 2, 1 by place.

It is networked the opposite way to Stick Kombat, on purpose:

- **Each client runs its own runner.** Racers are ghosts to each other, so there is
  nothing for a server to arbitrate, and any lag on your own jumps would ruin a
  platformer. Positions go up a dozen times a second; the server relays them at 15 Hz
  and others are drawn a little in the past, blended between updates.
- **Hazards are functions of the clock.** Every saw, laser, cannon shot and the grinder
  is computed from milliseconds since GO, so every screen agrees and none of it is sent.
- **Claims are checked.** The server refuses moves faster than the physics allows, a
  start anywhere but the start, and checkpoints or finishes claimed from elsewhere.

Levels climb and drop as well as run: a thirty-tile wall-jump shaft, a tower of
zigzag ledges, and the Drop, a spike-lined pipe with cannons firing across it that is
taken at a glide. The grinder follows each level's route rather than just its x axis,
so it comes down a pipe from above and up a shaft from below, easing off on legs that
have to be taken slowly.

Levels are built in code (`packages/shared/src/race/levels.ts`) with a small tile
builder, and the tests check each one: safe spawn and checkpoints, a finish on the
ground, and climbable shafts.

Both real-time games have a full screen button (or press F).

## Testing

```bash
npm test                      # unit tests for the pure logic in packages/shared
node scripts/integration.mjs  # 25 checks against a running server
node scripts/integration-fight.mjs  # the fighter: tick rate, inputs, pause and forfeit
node scripts/integration-race.mjs   # the race: relay, cheat checks, scoring, the cup
```

The integration suite connects three real socket clients and plays a turn, then
asserts the things that would actually break the game — including that the word
appears **nowhere** in any guesser's traffic, that a non-drawer's strokes and word
choices are rejected, that malformed stroke payloads are dropped, that a flood is
rate-limited, and that a reconnect reclaims the same seat and score without
leaving a ghost player. It needs `npm run dev` running.
