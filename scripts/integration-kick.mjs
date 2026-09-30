// Removing a player works the same in every game: only the host can do it,
// the removed player is told and dropped, and their seat cannot come back.
import { io } from 'socket.io-client';

const URL = process.env.PIC_GAME_URL ?? 'http://localhost:3001';
const KINDS = ['skribbl', 'kungfu', 'realms', 'fight', 'race', 'spies', 'bingo', 'cryptid', 'flip7', 'maze', 'tourney'];
const pass = [], fail = [];
const ok = (m) => { pass.push(m); console.log(`  \x1b[32mPASS\x1b[0m ${m}`); };
const bad = (m, d = '') => { fail.push(m); console.log(`  \x1b[31mFAIL\x1b[0m ${m}${d ? ` — ${d}` : ''}`); };
const check = (cond, m, d) => (cond ? ok(m) : bad(m, d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mk() {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const log = [];
  s.onAny((ev, ...args) => log.push({ ev, args }));
  s.saw = (ev) => log.filter((e) => e.ev === ev).map((e) => e.args[0]);
  return s;
}
const ready = (s) => new Promise((r) => (s.connected ? r() : s.on('connect', r)));
const ack = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));

for (let until = Date.now() + 30000; ; await sleep(400)) {
  try { if ((await fetch(URL + '/health')).ok) break; } catch {}
  if (Date.now() > until) { console.log('Server never became ready'); process.exit(1); }
}

for (const kind of KINDS) {
  console.log(`\n\x1b[1m${kind}\x1b[0m`);
  const [host, a, b] = [mk(), mk(), mk()];
  await Promise.all([host, a, b].map(ready));
  const c = await ack(host, 'room:create', { name: 'Host', avatar: {}, game: kind });
  if (!c.ok || c.state.kind !== kind) { bad(`${kind}: room created`, JSON.stringify(c)); continue; }
  const code = c.state.code;
  const ja = await ack(a, 'room:join', { code, name: 'Ann', avatar: {} });
  const jb = await ack(b, 'room:join', { code, name: 'Bob', avatar: {} });
  await sleep(100);

  b.emit('player:kick', { playerId: ja.playerId });
  await sleep(150);
  check(!host.saw('player:left').some((p) => p.id === ja.playerId), `${kind}: a non-host cannot remove anyone`);

  host.emit('player:kick', { playerId: c.playerId });
  await sleep(100);
  check(!host.saw('kicked').length, `${kind}: the host cannot remove themselves`);

  host.emit('player:kick', { playerId: ja.playerId });
  await sleep(200);
  check(a.saw('kicked').length === 1, `${kind}: the removed player is told`);
  check(host.saw('player:left').some((p) => p.id === ja.playerId), `${kind}: and everyone sees them go`);
  const back = mk();
  const r = await ack(back, 'room:join', { code, name: 'Ann again', avatar: {}, token: ja.token });
  check(!r.ok && r.code === 'KICKED', `${kind}: they cannot rejoin on the same seat`, JSON.stringify(r));
  check(b.connected && !b.saw('kicked').length && jb.ok, `${kind}: everyone else is still in`);
  for (const s of [host, a, b, back]) s.disconnect();
}

console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
