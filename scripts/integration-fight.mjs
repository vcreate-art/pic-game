import { io } from 'socket.io-client';

const URL = process.env.PIC_GAME_URL ?? 'http://localhost:3001';
const pass = [], fail = [];
const ok = (m) => { pass.push(m); console.log(`  \x1b[32mPASS\x1b[0m ${m}`); };
const bad = (m, d = '') => { fail.push(m); console.log(`  \x1b[31mFAIL\x1b[0m ${m}${d ? ` — ${d}` : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Same bits as BTN in packages/shared/src/fight/types.ts.
const LEFT = 4, RIGHT = 8, FP = 16;

function mk(label) {
  const s = io(URL, { transports: ['websocket'] });
  const log = [];
  s.onAny((ev, ...args) => log.push({ ev, args, at: Date.now() }));
  s.label = label;
  s.saw = (ev) => log.filter(e => e.ev === ev);
  s.last = (ev) => s.saw(ev).at(-1)?.args[0];
  s.since = (ev, t) => log.filter(e => e.ev === ev && e.at >= t);
  s.seq = 0;
  s.send = (held, pressed = 0) => s.emit('fight:input', { seq: ++s.seq, held, pressed });
  return s;
}
const ready = (s) => new Promise(r => s.on('connect', r));
const emitAck = (s, ev, p) => new Promise(r => s.emit(ev, p, r));
const waitFor = (s, ev, pred, ms = 9000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`${s.label} never got a matching ${ev}`)), ms);
  const on = (a) => { if (pred(a)) { clearTimeout(t); s.off(ev, on); res(a); } };
  s.on(ev, on);
});

async function waitForServer(ms = 30000) {
  const until = Date.now() + ms;
  let streak = 0;
  while (Date.now() < until) {
    try {
      const r = await fetch(URL.replace(/\/$/, '') + '/health');
      if (r.ok) { if (++streak >= 2) return; } else streak = 0;
    } catch { streak = 0; }
    await sleep(400);
  }
  console.log('\x1b[31mServer never became ready\x1b[0m');
  process.exit(1);
}
await waitForServer();

const A = mk('A'), B = mk('B'), S = mk('Spec');
await Promise.all([ready(A), ready(B), ready(S)]);

console.log('\n\x1b[1m1. A Stick Kombat room\x1b[0m');
const ca = await emitAck(A, 'room:create', { name: 'Ana', avatar: {}, game: 'fight' });
if (ca.ok && ca.state.kind === 'fight') ok(`room created (${ca.state.code})`);
else { bad('not a fight room', JSON.stringify(ca.ok && ca.state.kind)); process.exit(1); }
const code = ca.state.code;
const cb = await emitAck(B, 'room:join', { code, name: 'Ben', avatar: {} });
await emitAck(S, 'room:join', { code, name: 'Sam', avatar: {} });
if (ca.state.game.phase === 'lobby' && ca.state.frame === null) ok('starts in the lobby with no match');
else bad('unexpected initial state');

console.log('\n\x1b[1m2. Seats, picks and settings\x1b[0m');
A.emit('fight:seat', { side: 'a' });
await sleep(200);
B.emit('fight:seat', { side: 'a' });
await sleep(250);
if (B.saw('error').some(e => e.args[0].code === 'SEAT_TAKEN')) ok('a taken seat cannot be stolen');
else bad('seat was stolen');
B.emit('fight:seat', { side: 'b' });
S.emit('fight:pick', { fighter: 'volt' });
await sleep(250);
if (S.saw('error').some(e => e.args[0].code === 'NOT_SEATED')) ok('a spectator cannot pick a fighter');
else bad('spectator pick was not refused');

A.emit('game:start');
await sleep(250);
if (A.saw('error').some(e => e.args[0].code === 'NOT_READY')) ok('cannot start before both fighters are picked');
else bad('started without picks');

A.emit('fight:pick', { fighter: 'goro' });
await sleep(200);
if (A.saw('error').some(e => e.args[0].code === 'BAD_PICK')) ok('an unknown fighter is refused');
else bad('unknown fighter accepted');

A.emit('fight:pick', { fighter: 'ember' });
B.emit('fight:pick', { fighter: 'rime' });
B.emit('fight:settings', { roundSeconds: 30 });
A.emit('fight:settings', { roundSeconds: 45, blood: false, roundsToWin: 99 });
await sleep(300);
let st = S.last('fight:state');
if (st.picks.a === 'ember' && st.picks.b === 'rime') ok('both picks are visible to everyone');
else bad('picks wrong', JSON.stringify(st.picks));
if (st.settings.roundSeconds === 45 && st.settings.blood === false) ok('the host changed the settings; a guest could not');
else bad('settings wrong', JSON.stringify(st.settings));
if (st.settings.roundsToWin === 3) ok('rounds to win is clamped');
else bad('rounds not clamped', st.settings.roundsToWin);

console.log('\n\x1b[1m3. The match runs at 60 Hz\x1b[0m');
B.emit('game:start');
await sleep(250);
if (S.last('fight:state').phase === 'lobby') ok('a non-host cannot start');
else bad('a non-host started the match');

const t0 = Date.now();
A.emit('game:start');
await waitFor(S, 'fight:state', (g) => g.phase === 'playing');
ok('the host started the match');
await sleep(1000);
const frames = S.since('fight:frame', t0).map(e => e.args[0]);
if (frames.length >= 45 && frames.length <= 70) ok(`${frames.length} frames in about a second`);
else bad('frame rate off', `${frames.length} frames`);
const ticks = frames.map(f => f.t);
if (ticks.every((t, i) => i === 0 || t > ticks[i - 1])) ok('frames arrive in tick order');
else bad('frames out of order');
const size = JSON.stringify(frames.at(-1)).length;
if (size < 500) ok(`a frame is small (${size} bytes)`);
else bad('frames are large', `${size} bytes`);
if (S.saw('fight:events').some(e => e.args[0].some(x => x.t === 'announce' && x.what === 'round'))) ok('the round is announced');
else bad('no round announcement');

await waitFor(S, 'fight:frame', (f) => f.p === 'fighting', 5000);
ok('the intro gives way to the fight');

console.log('\n\x1b[1m4. Controls\x1b[0m');
let f0 = S.last('fight:frame');
S.emit('fight:input', { seq: 1, held: RIGHT, pressed: 0 });
await sleep(300);
let f1 = S.last('fight:frame');
if (f1.a.x === f0.a.x && f1.b.x === f0.b.x) ok('a spectator has no controller');
else bad('spectator moved a fighter');

A.send(RIGHT);
B.send(LEFT);
await sleep(1200);
A.send(0);
B.send(0);
await sleep(100);
f1 = S.last('fight:frame');
if (f1.b.x - f1.a.x < 90) ok(`the fighters walked together (${Math.round(f1.b.x - f1.a.x)} apart)`);
else bad('fighters did not close in', `${f1.a.x} / ${f1.b.x}`);

const before = Date.now();
A.send(0, FP);
A.send(0);
const hit = await waitFor(S, 'fight:events', (evs) => evs.some(e => e.t === 'hit'), 2000).catch(() => null);
if (hit) ok('a tap shorter than a tick still lands a jab');
else bad('the jab never landed');
await sleep(150);
if (S.last('fight:frame').b.h < 1000) ok(`the hit shows in the frames (${S.last('fight:frame').b.h} health)`);
else bad('health unchanged');
if (A.since('fight:events', before).some(e => e.args[0].some(x => x.t === 'hit'))) ok('the attacker got the hit event too');
else bad('attacker missed the event');

A.send(0);
const aSeq = A.seq;
A.emit('fight:input', { seq: aSeq - 5, held: LEFT, pressed: 0 });
f0 = S.last('fight:frame');
await sleep(300);
f1 = S.last('fight:frame');
if (Math.abs(f1.a.x - f0.a.x) < 1) ok('a stale input is ignored');
else bad('stale input moved the fighter');

for (let i = 0; i < 400; i++) A.send(0);
A.send(LEFT);
f0 = S.last('fight:frame');
await sleep(300);
f1 = S.last('fight:frame');
if (Math.abs(f1.a.x - f0.a.x) < 1) ok('an input flood is rate-limited');
else bad('flood not limited');
await sleep(1500); // let the bucket refill
A.send(0);

console.log('\n\x1b[1m5. Dropping out\x1b[0m');
B.disconnect();
const paused = await waitFor(S, 'fight:state', (g) => !!g.paused, 3000).catch(() => null);
if (paused?.paused.side === 'b' && !paused.paused.resuming) ok('a dropped fighter pauses the match');
else bad('no pause', JSON.stringify(paused?.paused));
await sleep(200);
const frozenAt = S.last('fight:frame').t;
await sleep(500);
if (S.last('fight:frame').t === frozenAt) ok('no ticks run while paused');
else bad('the sim kept running');

const B2 = mk('B2');
await ready(B2);
const rb = await emitAck(B2, 'room:join', { code, name: 'Ben', avatar: {}, token: cb.token });
if (rb.ok && rb.playerId === cb.playerId && rb.state.frame) ok('the fighter reclaims the seat and gets the current frame');
else bad('reclaim failed', JSON.stringify(rb));
// Broadcast during the reclaim itself, so it can land before the ack does.
await sleep(100);
const resuming = S.saw('fight:state').some(e => e.args[0].paused?.resuming);
if (resuming) ok('a countdown runs before play resumes');
else bad('no resume countdown');
await waitFor(S, 'fight:state', (g) => g.paused === null, 5000);
const resumedAt = S.last('fight:frame').t;
await sleep(400);
if (S.last('fight:frame').t > resumedAt) ok('the match resumes');
else bad('the match stayed frozen');

B2.emit('room:leave');
const ended = await waitFor(S, 'fight:state', (g) => g.phase === 'ended', 3000).catch(() => null);
if (ended?.winner === 'a' && ended.reason === 'forfeit') ok('leaving mid-match forfeits');
else bad('no forfeit', JSON.stringify(ended));
await sleep(200);
const lastTick = S.last('fight:frame').t;
await sleep(400);
if (S.last('fight:frame').t === lastTick) ok('the loop stops once the match is over');
else bad('frames still flowing');

A.emit('fight:rematch');
const back = await waitFor(S, 'fight:state', (g) => g.phase === 'lobby', 2000).catch(() => null);
if (back) ok('a rematch with an empty seat goes back to the lobby');
else bad('rematch did not return to the lobby');

console.log(`\n\x1b[1m${pass.length} passed, ${fail.length} failed\x1b[0m`);
for (const s of [A, B2, S]) s.close();
process.exit(fail.length ? 1 : 0);
