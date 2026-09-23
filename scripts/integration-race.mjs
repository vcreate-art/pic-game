import { io } from 'socket.io-client';

const URL = process.env.PIC_GAME_URL ?? 'http://localhost:3001';
const pass = [], fail = [];
const ok = (m) => { pass.push(m); console.log(`  \x1b[32mPASS\x1b[0m ${m}`); };
const bad = (m, d = '') => { fail.push(m); console.log(`  \x1b[31mFAIL\x1b[0m ${m}${d ? ` — ${d}` : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mk(label) {
  const s = io(URL, { transports: ['websocket'] });
  const log = [];
  s.onAny((ev, ...args) => log.push({ ev, args, at: Date.now() }));
  s.label = label;
  s.saw = (ev) => log.filter(e => e.ev === ev);
  s.last = (ev) => s.saw(ev).at(-1)?.args[0];
  s.seq = 0;
  s.pos = (x, y) => s.emit('race:pos', { seq: ++s.seq, g: [x, y, 0, 0, 2] });
  return s;
}
const ready = (s) => new Promise(r => s.on('connect', r));
const emitAck = (s, ev, p) => new Promise(r => s.emit(ev, p, r));
const waitFor = (s, ev, pred, ms = 20000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(`${s.label} never got a matching ${ev}`)), ms);
  const on = (a) => { if (pred(a)) { clearTimeout(t); s.off(ev, on); res(a); } };
  s.on(ev, on);
});
const events = (s, t) => s.saw('race:events').flatMap(e => e.args[0]).filter(e => e.t === t);

async function waitForServer(ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(URL + '/health')).ok) return; } catch {}
    await sleep(400);
  }
  console.log('\x1b[31mServer never became ready\x1b[0m');
  process.exit(1);
}
await waitForServer();

// Level 1's layout, from packages/shared/src/race/levels.ts.
const TILE = 32, RH = 26;
const spawn = { x: 3 * TILE + 6, y: 16 * TILE - RH };
const finish = { x: 145 * TILE + 6, y: 16 * TILE - RH };

const A = mk('A'), B = mk('B'), S = mk('Late');
await Promise.all([ready(A), ready(B), ready(S)]);

console.log('\n\x1b[1m1. A Meat Race room\x1b[0m');
const ca = await emitAck(A, 'room:create', { name: 'Ana', avatar: {}, game: 'race' });
if (ca.ok && ca.state.kind === 'race' && ca.state.game.phase === 'lobby') ok(`room created (${ca.state.code})`);
else { bad('not a race room'); process.exit(1); }
const code = ca.state.code;
const cb = await emitAck(B, 'room:join', { code, name: 'Ben', avatar: {} });

B.emit('race:settings', { levels: 3 });
A.emit('race:settings', { levels: 99, chaser: 'fast' });
A.emit('race:settings', { chaser: 'ludicrous' });
await sleep(300);
let st = B.last('race:state');
if (st.settings.levels === 3 && st.settings.chaser === 'fast') ok('the host sets the cup; levels clamp; bad values ignored');
else bad('settings wrong', JSON.stringify(st.settings));
A.emit('race:settings', { levels: 1, chaser: 'normal' });

console.log('\n\x1b[1m2. Countdown\x1b[0m');
B.emit('game:start');
await sleep(250);
if (B.last('race:state').phase === 'lobby') ok('a guest cannot start');
else bad('guest started');
A.emit('game:start');
st = await waitFor(B, 'race:state', (g) => g.phase === 'countdown');
if (st.racers.length === 2 && st.startAt > Date.now() + 2000) ok('both racers counted in, GO is a few seconds away');
else bad('countdown wrong', JSON.stringify(st));
const cs = await emitAck(S, 'room:join', { code, name: 'Sam', avatar: {} });
A.pos(spawn.x, spawn.y);
await sleep(300);
if (B.saw('race:ghosts').length === 0) ok('nothing moves before GO');
else bad('ghosts before GO');

await waitFor(B, 'race:state', (g) => g.phase === 'racing', 6000);
ok('GO');
if (cs.ok && !B.last('race:state').racers.includes(cs.playerId)) ok('a late joiner watches this level');
else bad('late joiner was counted in');

console.log('\n\x1b[1m3. Claims\x1b[0m');
A.pos(spawn.x, spawn.y);
B.pos(spawn.x, spawn.y);
S.pos(spawn.x, spawn.y);
await sleep(300);
let gh = B.last('race:ghosts');
if (gh && gh[ca.playerId]) ok('racers see each other');
else bad('no ghost for A', JSON.stringify(gh));
if (gh && Object.keys(gh).length === 2) ok("a spectator's position is ignored");
else bad('spectator relayed', JSON.stringify(Object.keys(gh ?? {})));

A.pos(finish.x, finish.y);
A.emit('race:finish');
await sleep(300);
gh = B.last('race:ghosts');
if (Math.abs(gh[ca.playerId][0] - spawn.x) < 1) ok('a teleport to the finish is refused');
else bad('teleport accepted', JSON.stringify(gh[ca.playerId]));
if (events(B, 'finish').length === 0) ok('and so is the finish claimed from there');
else bad('cheat finish accepted');

A.emit('race:checkpoint', { n: 2 });
B.emit('race:died', { cause: 'saw' });
B.emit('race:died', { cause: 'lava' });
await sleep(300);
if (events(B, 'checkpoint').length === 0) ok('a checkpoint claimed from afar is refused');
else bad('far checkpoint accepted');
if (events(B, 'died').length === 1) ok('deaths are reported, with unknown causes dropped');
else bad('death events wrong', JSON.stringify(events(B, 'died')));

console.log('\n\x1b[1m4. Racing to the flag\x1b[0m');
// Walk A to the finish in plausible steps: 60px every 150ms is slower than
// a real runner, and no faster than the server allows.
let x = spawn.x;
while (x < finish.x) {
  x = Math.min(finish.x, x + 60);
  A.pos(x, spawn.y);
  B.pos(spawn.x, spawn.y);
  await sleep(150);
}
A.emit('race:finish');
const fin = await waitFor(B, 'race:events', (evs) => evs.some(e => e.t === 'finish'), 3000).catch(() => null);
const f = fin?.find(e => e.t === 'finish');
if (f && f.id === ca.playerId && f.place === 1) ok(`first across the line in ${(f.time / 1000).toFixed(1)}s`);
else bad('no finish', JSON.stringify(fin));
A.pos(x + 10, spawn.y);

B.emit('race:caught');
st = await waitFor(B, 'race:state', (g) => g.phase === 'results', 3000).catch(() => null);
if (st) ok('the level ends once everyone is done');
else bad('level did not end');
if (st?.results[ca.playerId]?.points === 10 && st?.results[cb.playerId]?.points === 0 && st.results[cb.playerId].caught) {
  ok('10 points for the win, none for being caught');
} else bad('points wrong', JSON.stringify(st?.results));
if (st?.results[cb.playerId]?.deaths === 1) ok('deaths are tallied');
else bad('deaths wrong');

console.log('\n\x1b[1m5. The cup\x1b[0m');
st = await waitFor(B, 'race:state', (g) => g.phase === 'podium', 10000).catch(() => null);
if (st && st.points[ca.playerId] === 10) ok('a one-level cup goes to the podium');
else bad('no podium', JSON.stringify(st));
B.emit('race:again');
A.emit('race:again');
st = await waitFor(B, 'race:state', (g) => g.phase === 'lobby', 3000).catch(() => null);
if (st) ok('the host takes everyone back to the lobby');
else bad('no return to lobby');

console.log(`\n\x1b[1m${pass.length} passed, ${fail.length} failed\x1b[0m`);
for (const s of [A, B, S]) s.close();
process.exit(fail.length ? 1 : 0);
