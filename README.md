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

## Testing

```bash
npm test                      # unit tests for the pure logic in packages/shared
node scripts/integration.mjs  # 25 checks against a running server
```

The integration suite connects three real socket clients and plays a turn, then
asserts the things that would actually break the game — including that the word
appears **nowhere** in any guesser's traffic, that a non-drawer's strokes and word
choices are rejected, that malformed stroke payloads are dropped, that a flood is
rate-limited, and that a reconnect reclaims the same seat and score without
leaving a ghost player. It needs `npm run dev` running.
