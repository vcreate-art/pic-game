// Run against a server started with a short away timer:
//   FLIP7_AWAY_MS=1500 npx tsx apps/server/src/index.ts
import { io } from 'socket.io-client';

const URL = process.env.PIC_GAME_URL ?? 'http://localhost:3001';
const pass = [], fail = [];
const ok = (m) => { pass.push(m); console.log(`  \x1b[32mPASS\x1b[0m ${m}`); };
const bad = (m, d = '') => { fail.push(m); console.log(`  \x1b[31mFAIL\x1b[0m ${m}${d ? ` — ${d}` : ''}`); };
const check = (cond, m, d) => (cond ? ok(m) : bad(m, d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The latest table, from whichever socket got it last. */
let latest = null;
function mk(label) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const log = [];
  s.onAny((ev, ...args) => log.push({ ev, args }));
  s.on('flip7:state', (g) => (latest = g));
  s.label = label;
  s.saw = (ev) => log.filter((e) => e.ev === ev).map((e) => e.args[0]);
  s.errors = () => s.saw('error').map((e) => e.message);
  return s;
}
const ready = (s) => new Promise((r) => (s.connected ? r() : s.on('connect', r)));
const ack = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));

for (let until = Date.now() + 30000; ; await sleep(400)) {
  try { if ((await fetch(URL + '/health')).ok) break; } catch {}
  if (Date.now() > until) { console.log('Server never became ready'); process.exit(1); }
}

const A = mk('A'), B = mk('B'), C = mk('C');
await Promise.all([A, B, C].map(ready));

console.log('\n\x1b[1m1. A Flip 7 room\x1b[0m');
const c = await ack(A, 'room:create', { name: 'Ann', avatar: {}, game: 'flip7' });
if (!c.ok || c.state.kind !== 'flip7') { bad('not a flip7 room', JSON.stringify(c)); process.exit(1); }
ok(`room created (${c.state.code})`);
const code = c.state.code;
A.emit('game:start');
await sleep(150);
check(A.errors().some((e) => /at least 2/.test(e)), 'needs two players');
const ids = { A: c.playerId };
const tokens = { A: c.token };
for (const [s, n] of [[B, 'Bo'], [C, 'Cy']]) {
  const r = await ack(s, 'room:join', { code, name: n, avatar: {} });
  ids[s.label] = r.playerId;
  tokens[s.label] = r.token;
}
const sock = Object.fromEntries([A, B, C].map((s) => [ids[s.label], s]));

console.log('\n\x1b[1m2. Settings\x1b[0m');
B.emit('flip7:settings', { target: 100 });
await sleep(120);
check(latest?.settings.target === 200 || latest === null, 'only the host changes the target');
A.emit('flip7:settings', { target: 123 });
await sleep(120);
check((latest?.settings.target ?? 200) === 200, 'only the offered targets are taken');
A.emit('flip7:settings', { target: 100 });
await sleep(120);
check(latest.settings.target === 100, 'the host plays to 100');

console.log('\n\x1b[1m3. The deal\x1b[0m');
A.emit('game:start');
await sleep(250);
let g = latest;
check(g.round === 1 && g.players.length === 3, 'three players, round one');
const dealt = g.players.filter((id) => g.hands[id].numbers.length + g.hands[id].modifiers.length + (g.hands[id].second ? 1 : 0) > 0).length;
check(dealt >= 1, 'opening cards are on the table');
check(!('deck' in g) && typeof g.deckCount === 'number', 'the deck order never leaves the server');
const counted = Object.values(g.remaining).reduce((a, b) => a + b, 0);
check(counted === g.deckCount, 'what is left adds up to the deck', `${counted} vs ${g.deckCount}`);

console.log('\n\x1b[1m4. Turns\x1b[0m');
// Settle any action card from the deal first.
for (let i = 0; i < 5 && latest.phase === 'target'; i++) {
  sock[latest.pending.by].emit('flip7:choose', { target: latest.pending.options[0] });
  await sleep(120);
}
g = latest;
const turn = g.turn;
const other = g.players.find((id) => id !== turn);
sock[other].emit('flip7:hit');
await sleep(120);
check(sock[other].errors().some((e) => /not your turn/.test(e)), 'only the player to move may hit');
sock[turn].emit('flip7:stay');
await sleep(150);
check(latest.hands[turn].status === 'stayed' && latest.turn !== turn, 'a stay banks and passes the turn');
check(latest.events.some((e) => e.kind === 'stay' && e.by === turn), 'the move is in the events');

console.log('\n\x1b[1m5. Away\x1b[0m');
g = latest;
if (g.phase === 'turn') {
  const away = g.turn;
  const label = sock[away].label;
  sock[away].disconnect();
  await sleep(2200);
  check(latest.hands[away].status !== 'active' || latest.turn !== away, 'a player who is away has their go made for them');
  const back = mk(label);
  await ready(back);
  const r = await ack(back, 'room:join', { code, name: 'back', avatar: {}, token: tokens[label] });
  check(r.ok && r.playerId === away, 'and they can come back to their seat');
  sock[away] = back;
} else {
  ok('(round already over; away check skipped)');
}

console.log('\n\x1b[1m6. Playing it out\x1b[0m');
// Play at random until someone wins.
let rounds = 0;
for (let steps = 0; steps < 800 && latest.phase !== 'ended'; steps++) {
  g = latest;
  if (g.phase === 'roundEnd') {
    rounds++;
    const anyone = g.players.find((id) => sock[id]?.connected && id !== ids.A) ?? ids.A;
    sock[anyone].emit('flip7:next');
  } else if (g.phase === 'target') {
    sock[g.pending.by]?.emit('flip7:choose', { target: g.pending.options[Math.floor(Math.random() * g.pending.options.length)] });
  } else if (g.turn) {
    sock[g.turn]?.emit(Math.random() < 0.6 ? 'flip7:hit' : 'flip7:stay');
  }
  await sleep(40);
  if (latest === g) await sleep(1800); // waiting on someone away
}
g = latest;
check(g.phase === 'ended' && g.winners.length === 1, 'someone wins', `${g.phase} ${JSON.stringify(g.winners)}`);
check(g.totals[g.winners[0]] >= 100, 'at or past the target');
check(rounds >= 1, `any player could deal the next round (${rounds} dealt)`);

console.log('\n\x1b[1m7. Again\x1b[0m');
sock[ids.B].emit('flip7:rematch');
await sleep(150);
check(latest.phase === 'ended', 'only the host starts another');
sock[ids.A].emit('flip7:rematch');
await sleep(250);
check(latest.round === 1 && latest.phase !== 'ended' && Object.values(latest.totals).every((t) => t === 0), 'a rematch starts from zero');

for (const s of [A, B, C, ...Object.values(sock)]) s.disconnect();
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
