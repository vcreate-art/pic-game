import { io } from 'socket.io-client';

const URL = process.env.PIC_GAME_URL ?? 'http://localhost:3001';
const pass = [], fail = [];
const ok = (m) => { pass.push(m); console.log(`  \x1b[32mPASS\x1b[0m ${m}`); };
const bad = (m, d = '') => { fail.push(m); console.log(`  \x1b[31mFAIL\x1b[0m ${m}${d ? ` — ${d}` : ''}`); };
const check = (cond, m, d) => (cond ? ok(m) : bad(m, d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = null;
function mk(label) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const log = [];
  s.onAny((ev, ...args) => log.push({ ev, args }));
  s.on('maze:state', (g) => (state = g));
  s.label = label;
  s.frames = () => log.filter((e) => e.ev === 'maze:frame').map((e) => e.args[0]);
  s.errors = () => log.filter((e) => e.ev === 'error').map((e) => e.args[0].message);
  return s;
}
const ready = (s) => new Promise((r) => (s.connected ? r() : s.on('connect', r)));
const ack = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));

for (let until = Date.now() + 30000; ; await sleep(400)) {
  try { if ((await fetch(URL + '/health')).ok) break; } catch {}
  if (Date.now() > until) { console.log('Server never became ready'); process.exit(1); }
}

const A = mk('A'), B = mk('B');
await Promise.all([A, B].map(ready));

console.log('\n\x1b[1m1. A Maze Wars room\x1b[0m');
const c = await ack(A, 'room:create', { name: 'Ann', avatar: {}, game: 'maze' });
if (!c.ok || c.state.kind !== 'maze') { bad('not a maze room', JSON.stringify(c)); process.exit(1); }
ok(`room created (${c.state.code})`);
const code = c.state.code;
A.emit('game:start');
await sleep(150);
check(A.errors().some((e) => /at least 2/.test(e)), 'needs two players');
const jb = await ack(B, 'room:join', { code, name: 'Bo', avatar: {} });

console.log('\n\x1b[1m2. Settings\x1b[0m');
B.emit('maze:settings', { minutes: 3 });
await sleep(120);
check(state === null || state.settings.minutes === 5, 'only the host changes settings');
A.emit('maze:settings', { minutes: 7, killLimit: 10, radar: 'firing' });
await sleep(120);
check(state.settings.minutes === 5 && state.settings.killLimit === 10 && state.settings.radar === 'firing', 'only offered values are taken');
check(state.settings.powerups === true, 'power-ups are on by default');
A.emit('maze:settings', { powerups: 'yes' });
await sleep(120);
check(state.settings.powerups === true, 'power-ups take only a true or false');
check(state.settings.theme === 'random' && state.settings.fog === false, 'a random look and no fog by default');
A.emit('maze:settings', { theme: 'lava', fog: 'on' });
await sleep(120);
check(state.settings.theme === 'random' && state.settings.fog === false, 'only real looks and a true or false for fog');
A.emit('maze:settings', { theme: 'temple', fog: true });
await sleep(120);
check(state.settings.theme === 'temple' && state.settings.fog === true, 'the host picks the temple, with fog');

console.log('\n\x1b[1m3. The match\x1b[0m');
A.emit('game:start');
await sleep(700);
check(state.phase === 'playing' && state.players.length === 2 && state.seed > 0, 'playing, with a seed for the maze');
check(state.theme === 'temple', `the match is in the look picked (${state.theme})`);
check(state.cols >= 12 && state.rows >= 8, `a maze sized for two (${state.cols}×${state.rows})`);
const n = A.frames().length;
check(n >= 15 && n <= 25, `frames stream at about 30 a second (${n} in 0.7s)`);
let f = A.frames().at(-1);
check(f.p.length === 2 && f.p.every((p) => p.length === 12 && (p[4] & 1)), 'both players alive in the frame, with stack, shield and run');
check(Array.isArray(f.u), 'frames carry the pickups');
const seatA = state.players.indexOf(c.playerId);
const seatB = state.players.indexOf(jb.playerId);
const [x0, y0] = f.p[seatA];

console.log('\n\x1b[1m4. Moving\x1b[0m');
// Walk in each direction a while; at least one way has to be open.
let seq = 0;
const moveFor = async (keys, ticks, fire = false, aim = 0) => {
  for (let i = 0; i < ticks; i++) {
    A.emit('maze:input', { seq: ++seq, keys, aim, fire });
    await sleep(33);
  }
};
for (const k of [8, 4, 2, 1]) await moveFor(k, 8);
await sleep(150);
f = A.frames().at(-1);
const [x1, y1] = f.p[seatA];
check(Math.hypot(x1 - x0, y1 - y0) > 5, `input moves you (${Math.round(Math.hypot(x1 - x0, y1 - y0))}px)`);
check(f.p[seatA][5] === seq, `the frame acknowledges the last input (${f.p[seatA][5]} of ${seq})`);
check(f.p[seatB][5] === -1, 'a player who sent nothing has nothing acknowledged');
A.emit('maze:input', { seq: 3, keys: 8, aim: 0, fire: false });
await sleep(100);
check(A.frames().at(-1).p[seatA][5] === seq, 'an old input is ignored');
// Run: pressed, it starts at once, and the next has to wait out a cooldown.
A.emit('maze:input', { seq: ++seq, keys: 0, aim: 0, fire: false, run: true });
await sleep(120);
let pr = A.frames().at(-1).p[seatA];
check(pr[10] > 0 && pr[11] > pr[10], `a run starts on a press (${pr[10]} ticks left, next in ${pr[11]})`);
for (let i = 0; i < 3; i++) {
  A.emit('maze:input', { seq: ++seq, keys: 0, aim: 0, fire: false, run: false });
  await sleep(33);
}
A.emit('maze:input', { seq: ++seq, keys: 0, aim: 0, fire: false, run: true });
await sleep(120);
const pr2 = A.frames().at(-1).p[seatA];
check(pr2[10] < pr[10] && pr2[11] < pr[11], 'pressed again straight after, it does not start another');
A.emit('maze:input', { seq: ++seq, keys: 0, aim: 0, fire: false, run: false });

// Walk, then go quiet, as a tab in the background would: the player stops.
const walkable = [8, 4, 2, 1];
let moved = false;
for (const k of walkable) {
  const a = A.frames().at(-1).p[seatA];
  await moveFor(k, 4);
  await sleep(250);
  const b1 = A.frames().at(-1).p[seatA];
  await sleep(400);
  const b2 = A.frames().at(-1).p[seatA];
  if (Math.hypot(b1[0] - a[0], b1[1] - a[1]) > 3) {
    moved = true;
    check(b1[0] === b2[0] && b1[1] === b2[1], 'with no input coming in, a player stops rather than walking on');
    break;
  }
}
if (!moved) bad('could not find a way to walk to test stopping');

console.log('\n\x1b[1m5. Shooting\x1b[0m');
const before = A.frames().at(-1).b.length;
await moveFor(0, 12, true, 1024);
// The secondary with nothing on the stack fires nothing.
const bulletsBefore = A.frames().at(-1).b.filter((b) => b[3] === seatA).length;
for (let i = 0; i < 6; i++) {
  A.emit('maze:input', { seq: ++seq, keys: 0, aim: 1024, fire: false, alt: true });
  await sleep(33);
}
await sleep(100);
check(A.frames().at(-1).b.filter((b) => b[3] === seatA).length <= bulletsBefore, 'the secondary with an empty stack fires nothing');
const shots = new Set(A.frames().slice(-15).flatMap((fr) => fr.b.filter((b) => b[3] === seatA).map((b) => b[0])));
check(shots.size >= 1, `holding fire shoots (${shots.size} bullets seen)`);
check(shots.size <= 3, 'at the fire rate, not every tick');
A.emit('maze:input', { seq: ++seq, keys: 0, aim: 0, fire: false });
await sleep(1300);
check(A.frames().at(-1).b.length <= before, 'bullets die at walls or the end of their range');

console.log('\n\x1b[1m5b. Pickups\x1b[0m');
// The first pickup appears once the match is a few ticks old, away from players.
let pickups = [];
for (let i = 0; i < 20 && !pickups.length; i++) {
  await sleep(200);
  pickups = A.frames().at(-1).u;
}
check(pickups.length >= 1 && pickups.every((u) => u[1] >= 1 && u[1] <= 4), `pickups appear in the maze (${pickups.length})`);

console.log('\n\x1b[1m6. Away\x1b[0m');
// B plays a while first, so its seat has seen inputs numbered well past 1.
for (let i = 1; i <= 60; i++) {
  B.emit('maze:input', { seq: i, keys: 0, aim: 0, fire: false });
  await sleep(10);
}
await sleep(200);
B.disconnect();
await sleep(300);
check(A.frames().at(-1).p[seatB][4] & 8, 'a disconnected player is out of the maze');
const B2 = mk('B2');
await ready(B2);
const back = await ack(B2, 'room:join', { code, name: 'Bo', avatar: {}, token: jb.token });
await sleep(300);
const pb = A.frames().at(-1).p[seatB];
check(back.ok && !(pb[4] & 8) && (pb[4] & 2), 'back in on return, with spawn protection');
// A refreshed page counts its inputs from 1 again. The seat must take them,
// not throw them away as older than the ones sent before the refresh.
let seqB = 0;
const beforeB = A.frames().at(-1).p[seatB];
for (const k of [8, 4, 2, 1]) {
  for (let i = 0; i < 6; i++) {
    B2.emit('maze:input', { seq: ++seqB, keys: k, aim: 0, fire: false });
    await sleep(33);
  }
}
await sleep(200);
const afterB = A.frames().at(-1).p[seatB];
check(afterB[5] === seqB, `after a refresh, inputs from 1 are taken again (ack ${afterB[5]}, sent ${seqB})`);
check(Math.hypot(afterB[0] - beforeB[0], afterB[1] - beforeB[1]) > 5 || afterB[5] === seqB, 'and the player moves');

console.log('\n\x1b[1m7. Leaving ends a two-player match\x1b[0m');
B2.emit('room:leave');
await sleep(300);
check(state.phase === 'ended', 'with one player left, the match is over');
A.emit('maze:rematch');
await sleep(300);
check(state.phase === 'ended', 'a rematch needs two again');
const C = mk('C');
await ready(C);
await ack(C, 'room:join', { code, name: 'Cy', avatar: {} });
const oldSeed = state.seed;
A.emit('maze:rematch');
await sleep(300);
check(state.phase === 'playing' && state.seed !== oldSeed, 'a rematch is a new maze');

for (const s of [A, B, B2, C]) s.disconnect();
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
