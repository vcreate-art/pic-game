/**
 * Load test for the drawing game: whole rooms of simulated players, playing
 * the way people do.
 *
 * One k6 VU is one ROOM, not one player. It opens a socket per player, so the
 * host can create the room and hand the code to the others the way a group
 * chat does, and so drawer and guessers share a clock for measuring fan-out.
 *
 * Each room has 4–8 players. The drawer streams strokes in 50ms batches like
 * the canvas does, guessers type wrong guesses every few seconds and most get
 * it right eventually, so turns end early as they do in practice.
 *
 * Run:  k6 run loadtest/game-night.js                          (local, load profile)
 *       k6 run -e PROFILE=smoke loadtest/game-night.js
 *       k6 run -e BASE_URL=https://your.domain -e PROFILE=stress loadtest/game-night.js
 *
 * See loadtest/README.md for the knobs and what the metrics mean.
 */
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';
import { setTimeout, clearTimeout, setInterval, clearInterval } from 'k6/timers';
import { SioClient } from './sio.js';

const BASE = (__ENV.BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const PROFILE = __ENV.PROFILE || 'load';
const ROOMS = Number(__ENV.ROOMS || 15);
const MIN_PLAYERS = Number(__ENV.MIN_PLAYERS || 4);
const MAX_PLAYERS = Number(__ENV.MAX_PLAYERS || 8);
/** Real games default to 3 rounds; 1 cycles rooms faster, so creation and
 *  joining get exercised too. */
const ROUNDS = Number(__ENV.ROUNDS || 1);
const DRAW_TIME = Number(__ENV.DRAW_TIME || (PROFILE === 'smoke' ? 30 : 80));
/** Share of guessers who get the word before time runs out. */
const GUESS_RATE = Number(__ENV.GUESS_RATE || 0.75);

// ------------------------------------------------------------------ profiles

/** How long the load profile holds its peak. */
const HOLD = __ENV.HOLD || '10m';
const ramp = (peak) => [
  { duration: '2m', target: peak },
  { duration: HOLD, target: peak },
  { duration: '1m', target: 0 },
];
const steps = (peak) => [
  { duration: '2m', target: Math.ceil(peak / 4) },
  { duration: '3m', target: Math.ceil(peak / 4) },
  { duration: '2m', target: Math.ceil(peak / 2) },
  { duration: '3m', target: Math.ceil(peak / 2) },
  { duration: '2m', target: peak },
  { duration: '5m', target: peak },
  { duration: '1m', target: 0 },
];
const PROFILES = {
  smoke: () => [{ duration: '10s', target: 1 }, { duration: '3m', target: 1 }, { duration: '10s', target: 0 }],
  load: () => ramp(ROOMS),
  /** Steps up to 4× the load peak, to find where it bends. */
  stress: () => steps(ROOMS * 4),
  /** Everyone arrives at once, as when a link goes out to a big group. */
  spike: () => [{ duration: '20s', target: ROOMS * 3 }, { duration: '3m', target: ROOMS * 3 }, { duration: '30s', target: 0 }],
  /** A long evening, to catch leaks and timers that never get cleared. */
  soak: () => [{ duration: '5m', target: ROOMS }, { duration: '60m', target: ROOMS }, { duration: '2m', target: 0 }],
};
if (!PROFILES[PROFILE]) throw new Error(`Unknown PROFILE "${PROFILE}": ${Object.keys(PROFILES).join(', ')}`);
const stages = PROFILES[PROFILE]();

export const options = {
  scenarios: {
    skribbl: {
      executor: 'ramping-vus', exec: 'skribblRoom', startVUs: 0, stages,
      // A room mid-game is let finish its turn rather than cut off at once.
      gracefulRampDown: '60s', gracefulStop: '90s',
    },
  },
  thresholds: {
    // Event-loop health: time:ping is answered straight from the handler.
    rtt_ms: ['p(95)<150', 'p(99)<400'],
    // Drawer's stroke to guessers' screens.
    stroke_fanout_ms: ['p(95)<200'],
    join_failed: ['rate<0.01'],
    connect_failed: ['rate<0.01'],
    socket_dropped: ['count<10'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ------------------------------------------------------------------- metrics

const connectMs = new Trend('ws_connect_ms', true);
const joinMs = new Trend('join_ack_ms', true);
const rttMs = new Trend('rtt_ms', true);
const fanoutMs = new Trend('stroke_fanout_ms', true);
const connectFailed = new Rate('connect_failed');
const joinFailed = new Rate('join_failed');
const dropped = new Counter('socket_dropped');
const serverErrors = new Counter('server_errors');
const gamesFinished = new Counter('games_finished');
const playersSeated = new Counter('players_seated');

// ------------------------------------------------------------------- helpers

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clampQ = (n) => Math.max(0, Math.min(4095, n));

const NAMES = ['Ann', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu', 'Max', 'Ned', 'Oz', 'Pip'];
const COLORS = ['#000000', '#ef4444', '#3b82f6', '#22c55e', '#eab308', '#8b5cf6', '#a16207'];
const SIZES = [4, 10, 20, 36];
const WRONG = ['cat', 'house', 'tree', 'is it a dog', 'car', 'lol', 'sun', 'boat', 'fish', 'what', 'apple', 'ghost', 'moon', 'hat'];
const CHAT = ['hi!', 'hey all', 'ready', 'lets go', 'gg', 'one more?', 'brb', 'haha'];

function avatar() {
  return { color: randInt(0, 7), face: randInt(0, 7) };
}

/** What the browser fetches before it opens a socket. */
async function loadPage(code) {
  const reqs = [http.asyncRequest('GET', `${BASE}/`, null, { tags: { name: 'page' } })];
  if (code) reqs.push(http.asyncRequest('GET', `${BASE}/api/rooms/${code}`, null, { tags: { name: 'room-lookup' } }));
  await Promise.all(reqs);
}

/** A player is a socket plus the timers its behaviour runs on, so one call can
 *  stop whatever they were doing when the turn changes. */
function makePlayer(name) {
  const p = { name, id: null, sock: null, timers: new Set(), leaving: false };
  p.later = (sec, fn) => {
    if (!Number.isFinite(sec)) return;
    const t = setTimeout(() => { p.timers.delete(t); fn(); }, sec * 1000);
    p.timers.add(t);
  };
  p.every = (ms, fn) => {
    const t = setInterval(fn, ms);
    p.timers.add(t);
    return () => { clearInterval(t); p.timers.delete(t); };
  };
  p.stop = () => {
    // Timeouts and intervals share an id space in k6; clearing both is harmless.
    for (const t of p.timers) { clearTimeout(t); clearInterval(t); }
    p.timers.clear();
  };
  return p;
}

async function connect(name) {
  const p = makePlayer(name);
  const t0 = Date.now();
  const sock = new SioClient(BASE);
  try {
    await Promise.race([sock.ready, sleep(15).then(() => { throw new Error('connect timeout'); })]);
  } catch (e) {
    connectFailed.add(1);
    sock.close();
    return null;
  }
  connectFailed.add(0);
  connectMs.add(Date.now() - t0);
  p.sock = sock;
  sock.on('disconnect', () => { if (!p.leaving) dropped.add(1); p.stop(); });
  sock.on('error', (e) => serverErrors.add(1, { code: String(e?.code ?? 'unknown') }));
  sock.on('kicked', () => { p.leaving = true; });
  // The real client syncs its clock on joining: five pings, a quarter second apart.
  syncClock(p, 5);
  return p;
}

function syncClock(p, n) {
  if (n <= 0 || !p.sock.connected) return;
  const t0 = Date.now();
  p.sock.request('time:ping', undefined, 3000)
    .then(() => rttMs.add(Date.now() - t0))
    .catch(() => {})
    .finally(() => p.later(0.25, () => syncClock(p, n - 1)));
}

async function createRoom() {
  await loadPage();
  const host = await connect(NAMES[0]);
  if (!host) return null;
  const t0 = Date.now();
  let ack;
  try {
    ack = await host.sock.request('room:create', { name: host.name, avatar: avatar(), game: 'skribbl' });
  } catch {
    ack = { ok: false };
  }
  joinFailed.add(!ack.ok);
  if (!ack.ok) { host.leaving = true; host.sock.close(); return null; }
  joinMs.add(Date.now() - t0, { op: 'create' });
  playersSeated.add(1);
  host.id = ack.playerId;
  return { host, code: ack.state.code, players: [host] };
}

/** Friends trickle in over the first half minute as the link gets around. */
async function fillRoom(room, size) {
  for (let i = 1; i < size; i++) {
    await sleep(rand(0.5, 4));
    await loadPage(room.code);
    const p = await connect(NAMES[i % NAMES.length]);
    if (!p) continue;
    const t0 = Date.now();
    let ack;
    try {
      ack = await p.sock.request('room:join', { code: room.code, name: p.name, avatar: avatar() });
    } catch {
      ack = { ok: false };
    }
    joinFailed.add(!ack.ok);
    if (!ack.ok) { p.leaving = true; p.sock.close(); continue; }
    joinMs.add(Date.now() - t0, { op: 'join' });
    playersSeated.add(1);
    p.id = ack.playerId;
    room.players.push(p);
    if (Math.random() < 0.4) p.later(rand(1, 5), () => p.sock.emit('chat:guess', { text: pick(CHAT) }));
  }
}

function leaveAll(room) {
  for (const p of room.players) {
    p.stop();
    p.leaving = true;
    p.sock.emit('room:leave');
    p.sock.close();
  }
}

// ----------------------------------------------------------- skribbl (drawing)

export async function skribblRoom() {
  const room = await createRoom();
  if (!room) return;
  room.host.sock.emit('room:settings', { rounds: ROUNDS, drawTime: DRAW_TIME });
  await fillRoom(room, randInt(MIN_PLAYERS, MAX_PLAYERS));
  if (room.players.length < 2) return leaveAll(room);

  let finish;
  const done = new Promise((r) => (finish = r));
  const turn = { drawerId: null, word: null };
  for (const p of room.players) wireSkribbl(p, turn, finish);

  await sleep(rand(3, 10)); // the host waits for stragglers
  room.host.sock.emit('game:start');

  // Every turn can run its full length, plus choosing and the scoreboard.
  const cap = ROUNDS * room.players.length * (DRAW_TIME + 25) + 60;
  const finished = await Promise.race([done.then(() => true), sleep(cap).then(() => false)]);
  if (finished) {
    gamesFinished.add(1);
    await sleep(rand(3, 10)); // a look at the podium
  }
  leaveAll(room);
}

function wireSkribbl(p, turn, finish) {
  const s = p.sock;
  s.on('turn:choosing', (t) => {
    p.stop();
    turn.drawerId = t.drawerId;
    turn.word = null;
    if (t.words?.length) p.later(rand(2, 6), () => s.emit('word:choose', { id: pick(t.words).id }));
  });
  s.on('word:secret', ({ word }) => { turn.word = word; });
  s.on('turn:drawing', () => {
    p.stop();
    if (turn.drawerId === p.id) draw(p);
    else guess(p, turn);
  });
  s.on('turn:end', () => p.stop());
  s.on('game:end', () => { p.stop(); finish(); });
  // Stroke ids carry the drawer's send time; drawer and guessers share this VU's clock.
  s.on('draw:start', (st) => {
    const sent = Number(String(st.id).split('-')[1]);
    if (sent) fanoutMs.add(Date.now() - sent);
  });
}

function draw(p) {
  let k = 0;
  const stroke = () => {
    const id = `v${__VU}s${k++}-${Date.now()}`;
    let x = randInt(400, 3700);
    let y = randInt(400, 3700);
    const pts = () => {
      const out = [];
      for (let n = randInt(2, 6); n > 0; n--) {
        x = clampQ(x + randInt(-70, 70));
        y = clampQ(y + randInt(-70, 70));
        out.push(x, y);
      }
      return out;
    };
    p.sock.emit('draw:start', { id, tool: 'pen', color: pick(COLORS), size: pick(SIZES), pts: pts() });
    let left = randInt(8, 50); // 0.4–2.5s of pen on canvas, at the canvas's 50ms flush
    const stop = p.every(50, () => {
      if (--left > 0) return p.sock.emit('draw:append', { id, pts: pts() });
      stop();
      p.sock.emit('draw:end', { id });
      p.later(rand(0.2, 1.5), next);
    });
  };
  const next = () => {
    const r = Math.random();
    if (r < 0.04) p.sock.emit('canvas:undo');
    else if (r < 0.08) p.sock.emit('draw:fill', { x: randInt(0, 4095), y: randInt(0, 4095), color: pick(COLORS) });
    stroke();
  };
  p.later(rand(0.5, 2), stroke);
}

function guess(p, turn) {
  let got = false;
  const wrong = () => {
    if (got) return;
    p.sock.emit('chat:guess', { text: pick(WRONG) });
    p.later(rand(3, 10), wrong);
  };
  p.later(rand(2, 6), wrong);
  if (Math.random() < GUESS_RATE) {
    p.later(rand(8, DRAW_TIME * 0.9), () => {
      if (!turn.word) return;
      got = true;
      p.sock.emit('chat:guess', { text: turn.word });
    });
  }
  if (Math.random() < 0.3) p.later(rand(10, DRAW_TIME), () => p.sock.emit('draw:react', { vote: Math.random() < 0.85 ? 'like' : 'dislike' }));
}

