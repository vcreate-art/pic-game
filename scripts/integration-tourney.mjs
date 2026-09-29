import { io } from 'socket.io-client';

// Run against a server started with short lifetimes, so the keep-alive checks
// do not take minutes:
//   EMPTY_ROOM_TTL_MS=1500 RECONNECT_GRACE_MS=1000 PORT=3099 npx tsx apps/server/src/index.ts
const URL = process.env.PIC_GAME_URL ?? 'http://localhost:3001';
const SHORT = process.env.SHORT_TTLS === '1';
const pass = [], fail = [];
const ok = (m) => { pass.push(m); console.log(`  \x1b[32mPASS\x1b[0m ${m}`); };
const bad = (m, d = '') => { fail.push(m); console.log(`  \x1b[31mFAIL\x1b[0m ${m}${d ? ` — ${d}` : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Every tournament action spends from the chat bucket (6, then 1.5 a second).
const pace = () => sleep(700);

function mk(label) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const log = [];
  s.onAny((ev, ...args) => log.push({ ev, args }));
  s.label = label;
  s.saw = (ev) => log.filter(e => e.ev === ev);
  s.last = (ev) => s.saw(ev).at(-1)?.args[0];
  s.errors = () => s.saw('error').map(e => e.args[0].code);
  return s;
}
const ready = (s) => new Promise(r => s.on('connect', r));
const emitAck = (s, ev, p) => new Promise(r => s.emit(ev, p, r));
const act = async (s, ev, p) => { s.emit(ev, p); await pace(); };

const H = mk('Host'), P1 = mk('P1'), P2 = mk('P2');
await Promise.all([H, P1, P2].map(ready));

console.log('\n\x1b[1m1. Setting up\x1b[0m');
const c = await emitAck(H, 'room:create', { name: 'Hana', avatar: {}, game: 'tourney' });
if (c.ok && c.state.kind === 'tourney' && c.state.game.phase === 'setup') ok(`tournament room created (${c.state.code})`);
else { bad('not a tourney room', JSON.stringify(c)); process.exit(1); }
const code = c.state.code;
const hostToken = c.token;
await emitAck(P1, 'room:join', { code, name: 'Paul', avatar: {} });
await emitAck(P2, 'room:join', { code, name: 'Pia', avatar: {} });
const st = () => P1.last('tourney:state') ?? c.state.game;

await act(P1, 'tourney:settings', { startPoints: 5 });
await act(P1, 'tourney:add', { name: 'Sneaky', main: null });
if (st().entrants.length === 0 && st().settings.startPoints === 1000) ok('a non-host cannot change settings or add people');
else bad('non-host changed the setup');

await act(H, 'tourney:settings', { name: 'Friday Kombat', startPoints: 500, entryFee: 1e9, riseEvery: 0, bonuses: { fatality: 250, clean: -5 } });
let s = st();
if (s.settings.name === 'Friday Kombat' && s.settings.startPoints === 500 && s.settings.entryFee === 100000 && s.settings.bonuses.fatality === 250 && s.settings.bonuses.clean === 0) ok('the host sets it up; numbers clamp');
else bad('settings wrong', JSON.stringify(s.settings));
await act(H, 'tourney:settings', { entryFee: 100, bonuses: { clean: 50 } });

await act(P1, 'tourney:signUp');
const paul = st().entrants.find(e => e.name === 'Paul');
await act(P1, 'tourney:main', { id: paul.id, main: 'Scorpion' });
await act(P2, 'tourney:main', { id: paul.id, main: 'Goro' });
if (paul && st().entrants.find(e => e.id === paul.id).main === 'Scorpion') ok('a player signs up and picks their main');
else bad('sign up or main failed', JSON.stringify(st().entrants));

await act(H, 'tourney:add', { name: 'Dana', main: 'Kitana' });
await act(H, 'tourney:add', { name: 'dana', main: null });
if (H.errors().includes('NAME_TAKEN') && st().entrants.filter(e => e.name.toLowerCase() === 'dana').length === 1) ok('the host adds someone without the app; no doubles');
else bad('add or duplicate check failed');
await act(H, 'tourney:add', { name: 'Eve', main: 'Mileena' });
await act(H, 'tourney:add', { name: 'Pia', main: null });
await act(H, 'tourney:addRoom');
s = st();
const pia = s.entrants.filter(e => e.name === 'Pia');
if (s.entrants.length === 5 && pia.length === 1 && pia[0].playerId && s.entrants.some(e => e.name === 'Hana')) ok('"everyone in the room" adds the rest and links a typed-in name');
else bad('add room wrong', JSON.stringify(s.entrants.map(e => [e.name, !!e.playerId])));

console.log('\n\x1b[1m2. A lap of the circle\x1b[0m');
P1.emit('game:start');
await pace();
if (st().phase === 'setup') ok('only the host starts it');
await act(H, 'game:start');
s = st();
if (s.phase === 'ready' && s.lap === 1 && s.queue.length === 5 && s.entrants.every(e => e.points === 500)) ok('started: 5 players, a 5-match lap, 500 each');
else bad('start wrong', JSON.stringify({ phase: s.phase, lap: s.lap, q: s.queue.length }));
const counts = {};
for (const pair of s.queue) for (const id of pair) counts[id] = (counts[id] ?? 0) + 1;
if (Object.values(counts).length === 5 && Object.values(counts).every(n => n === 2)) ok('everyone is lined up for exactly two matches');
else bad('not twice each', JSON.stringify(counts));
const [n1, n2] = s.queue[0];
const circle = s.circle;
const adjacent = (a, b) => { const i = circle.indexOf(a), j = circle.indexOf(b); return (i + 1) % 5 === j || (j + 1) % 5 === i; };
if (s.queue.every(([a, b]) => adjacent(a, b))) ok('every match is between neighbours in the circle');

await act(P1, 'tourney:startMatch');
if (st().phase === 'ready') ok('a player cannot start a match');
await act(H, 'tourney:startMatch');
s = st();
if (s.phase === 'fighting' && s.current.pot === 200 && s.entrants.find(e => e.id === n1).points === 400) ok('starting the match takes the entry from both');
else bad('entries wrong', JSON.stringify(s.current));

const outsider = s.entrants.find(e => e.id !== n1 && e.id !== n2).id;
await act(H, 'tourney:report', { winner: outsider, score: '2-0', bonuses: [], chars: null });
await act(H, 'tourney:report', { winner: n1, score: '3-0', bonuses: [], chars: null });
await act(P2, 'tourney:report', { winner: n1, score: '2-0', bonuses: [], chars: null });
if (st().phase === 'fighting' && H.errors().includes('REFUSED')) ok('a winner not in the match, a 3-0, or a player reporting: all refused');
else bad('bad report got through', JSON.stringify({ phase: st().phase, errors: H.errors() }));

await act(H, 'tourney:report', { winner: n1, score: '2-0', bonuses: ['fatality', 'fatality', 'bogus'], chars: null });
if (st().phase === 'fighting') ok('an unknown bonus is dropped at the door');
await act(H, 'tourney:report', { winner: n1, score: '2-0', bonuses: ['fatality'], chars: { a: 'Scorpion', b: 'Goro' } });
s = st();
const rec = s.history[0];
// 400 left after paying in, plus the 200 pot, a clean 2-0 (50) and a Fatality (250).
if (s.entrants.find(e => e.id === n1).points === 900 && rec.bonuses.length === 2) ok('the winner takes the pot, a clean 2-0 and the Fatality');
else bad('payout wrong', JSON.stringify({ pts: s.entrants.find(e => e.id === n1).points, rec }));
if (rec.chars && rec.chars.a === 'Scorpion' && rec.chars.b === null) ok('characters are noted; a made-up one is dropped');
const chat = P2.saw('chat:message').map(e => e.args[0].text).join('\n');
if (/beat .* 2-0 with a clean 2-0, a Fatality: \+500/.test(chat)) ok('the result is announced in chat');
else bad('no announcement', chat.slice(-200));

await act(H, 'tourney:undo');
s = st();
if (s.phase === 'fighting' && s.history.length === 0 && s.entrants.find(e => e.id === n1).points === 400) ok('undo takes the result back and reopens the match');
else bad('undo wrong', JSON.stringify({ phase: s.phase, h: s.history.length }));
await act(H, 'tourney:cancel');
s = st();
if (s.phase === 'ready' && s.entrants.every(e => e.points === 500) && s.queue[0].join() === [n1, n2].join()) ok('cancel refunds both and keeps them up next');
else bad('cancel wrong');

const [q1, q2] = st().queue[0];
const sub = st().entrants.find(e => e.id !== q1 && e.id !== q2).id;
await act(H, 'tourney:swap', { side: 1, id: sub });
if (st().queue[0].join() === [q1, sub].join()) ok('the host can swap someone into the next match');
await act(H, 'tourney:swap', { side: 1, id: q2 });

for (let i = 0; i < 5; i++) {
  await act(H, 'tourney:startMatch');
  await act(H, 'tourney:report', { winner: st().current.a, score: '2-1', bonuses: [], chars: null });
}
s = st();
if (s.lap === 2 && s.history.length === 5 && s.queue.length === 5) ok('after 5 matches, a new circle and lap 2');
else bad('lap did not roll over', JSON.stringify({ lap: s.lap, h: s.history.length, q: s.queue.length }));
const played = {};
for (const h of s.history) for (const id of [h.a, h.b]) played[id] = (played[id] ?? 0) + 1;
if (Object.values(played).every(n => n === 2)) ok('lap 1 had everyone play twice');
if (s.canUndo) ok('the host can still undo after a lap');

console.log('\n\x1b[1m3. Saving and restoring\x1b[0m');
const saved = JSON.parse(JSON.stringify(H.last('tourney:state')));
const H2 = mk('Host2');
await ready(H2);
const c2 = await emitAck(H2, 'room:create', { name: 'Hana', avatar: {}, game: 'tourney' });
await act(H2, 'tourney:restore', { state: { ...saved, phase: 'nonsense' } });
if (H2.errors().includes('BAD_SAVE')) ok('a broken save is refused');
await act(H2, 'tourney:restore', { state: saved });
const back = H2.last('tourney:state');
const strip = (t) => ({ ...t, canUndo: null, entrants: t.entrants.map(e => ({ ...e, playerId: null })) });
if (JSON.stringify(strip(back)) === JSON.stringify(strip(saved))) ok('a saved tournament comes back exactly');
else bad('restore differs');
if (back.entrants.find(e => e.name === 'Hana').playerId === c2.playerId) ok('the host is matched back to their entry by name');
H2.close();

console.log('\n\x1b[1m4. The end\x1b[0m');
await act(H, 'tourney:startMatch');
await act(H, 'tourney:end');
s = st();
const top = Math.max(...s.entrants.map(e => e.points));
if (s.phase === 'ended' && s.winners.length >= 1 && s.winners.every(id => s.entrants.find(e => e.id === id).points === top)) ok('End now: the match on is refunded and the leader wins');
else bad('end wrong', JSON.stringify({ phase: s.phase, winners: s.winners }));
if (s.entrants.reduce((t, e) => t + e.points, 0) === 2500 + s.history.flatMap(h => h.bonuses).reduce((t, b) => t + b.points, 0)) ok('not a point lost: stacks add up to the start plus bonuses');
else bad('points leaked');
await act(H, 'tourney:toSetup');
s = st();
if (s.phase === 'setup' && s.entrants.length === 5 && s.entrants.every(e => e.points === 0 && e.wins === 0) && s.history.length === 0) ok('play again: same players, a clean slate');

if (SHORT) {
  console.log('\n\x1b[1m5. Kept alive\x1b[0m');
  const B = mk('Bingo');
  await ready(B);
  const bc = await emitAck(B, 'room:create', { name: 'Bee', avatar: {}, game: 'bingo' });
  B.close();
  [H, P1, P2].forEach(x => x.close());
  await sleep(3000);
  const peek = async (k) => (await fetch(`${URL}/api/rooms/${k}`)).status;
  if (await peek(bc.state.code) === 404) ok('an ordinary room is collected once empty');
  else bad('ordinary room not collected');
  if (await peek(code) === 200) ok('the tournament room is still there');
  else bad('tournament room collected');
  const R = mk('Back');
  await ready(R);
  const again = await emitAck(R, 'room:join', { code, name: 'Hana', avatar: {}, token: hostToken });
  if (again.ok && again.playerId === c.playerId && again.state.hostId === c.playerId) ok('the host reclaims their seat long after the usual grace');
  else bad('host could not come back', JSON.stringify(again));
  R.close();
} else {
  [H, P1, P2].forEach(x => x.close());
}

console.log(`\n\x1b[1m${pass.length} passed, ${fail.length} failed\x1b[0m`);
process.exit(fail.length ? 1 : 0);
