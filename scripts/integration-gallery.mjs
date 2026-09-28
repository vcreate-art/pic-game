import { io } from 'socket.io-client';

const URL = process.env.PIC_GAME_URL ?? 'http://localhost:3001';
const pass = [], fail = [];
const ok = (m) => { pass.push(m); console.log(`  \x1b[32mPASS\x1b[0m ${m}`); };
const bad = (m, d = '') => { fail.push(m); console.log(`  \x1b[31mFAIL\x1b[0m ${m}${d ? ` — ${d}` : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function mk(label) {
  const s = io(URL, { transports: ['websocket'] });
  const log = [];
  s.onAny((ev, ...args) => log.push({ ev, args }));
  s.label = label;
  s.saw = (ev) => log.filter(e => e.ev === ev);
  s.last = (ev) => s.saw(ev).at(-1)?.args[0];
  return s;
}
const ready = (s) => new Promise(r => s.on('connect', r));
const emitAck = (s, ev, p) => new Promise(r => s.emit(ev, p, r));
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(50); }
  return null;
}

const A = mk('A'), B = mk('B');
await Promise.all([A, B].map(ready));

console.log('\n\x1b[1m1. Setup\x1b[0m');
const c = await emitAck(A, 'room:create', { name: 'Ann', avatar: {} });
const code = c.state.code;
const ids = { A: c.playerId, B: (await emitAck(B, 'room:join', { code, name: 'Bo', avatar: {} })).playerId };
A.emit('room:settings', { rounds: 1 });
await sleep(150);
A.emit('game:start');
const sock = { [ids.A]: A, [ids.B]: B };

/** Plays one turn: the drawer picks, maybe draws, and the other guesses it. */
const picks = () => [A, B].flatMap(s => s.saw('turn:choosing').filter(e => e.args[0].words).map(e => e.args[0]));
async function turn(n, draw) {
  // The drawer alone is sent the words; turn n is the n-th turn to get a list.
  const choosing = await until(() => [...new Map(picks().map(p => [`${p.drawerId}:${p.round}`, p])).values()][n - 1]);
  const drawer = sock[choosing.drawerId];
  const guesser = drawer === A ? B : A;
  drawer.emit('word:choose', { id: choosing.words[0].id });
  await until(() => drawer.saw('word:secret').length >= n);
  const word = drawer.last('word:secret').word;
  if (draw) {
    drawer.emit('draw:start', { id: `s${n}`, tool: 'pen', color: '#ef4444', size: 10, pts: [100, 100, 900, 900, 1800, 400] });
    drawer.emit('draw:end', { id: `s${n}` });
    await sleep(150);
  }
  return { drawer, guesser, word };
}

console.log('\n\x1b[1m2. Reacting to a drawing\x1b[0m');
const t1 = await turn(1, true);
const turnState = await until(() => t1.guesser.last('turn:drawing'));
if (Array.isArray(turnState.likes) && turnState.likes.length === 0) ok('a new drawing starts with no reactions');
else bad('turn carries no reactions', JSON.stringify(turnState));

t1.drawer.emit('draw:react', { vote: 'like' });
await sleep(200);
if (!t1.guesser.saw('draw:reactions').length) ok('the drawer cannot like their own drawing');
else bad('drawer voted on their own drawing');

t1.guesser.emit('draw:react', { vote: 'like' });
let r = await until(() => t1.drawer.last('draw:reactions'));
if (r?.likes.join() === ids[t1.guesser === A ? 'A' : 'B'] && r.dislikes.length === 0) ok('a like reaches everyone');
else bad('like wrong', JSON.stringify(r));

t1.guesser.emit('draw:react', { vote: 'dislike' });
await sleep(200);
r = t1.drawer.last('draw:reactions');
if (r.likes.length === 0 && r.dislikes.length === 1) ok('one vote each: a dislike replaces the like');
else bad('votes stacked', JSON.stringify(r));
// Tapping the lit thumb again sends null, which takes the vote back.
t1.guesser.emit('draw:react', { vote: null });
await sleep(200);
r = t1.drawer.last('draw:reactions');
if (r.dislikes.length === 0 && r.likes.length === 0) ok('a vote can be taken back');
else bad('vote not taken back', JSON.stringify(r));
t1.guesser.emit('draw:react', { vote: 'nonsense' });
await sleep(150);
if (t1.drawer.saw('draw:reactions').length === 3) ok('a malformed vote is dropped');

t1.guesser.emit('chat:guess', { text: t1.word });
await until(() => t1.guesser.saw('turn:end').length >= 1);
t1.guesser.emit('draw:react', { vote: 'like' });
await sleep(200);
if (t1.drawer.last('draw:reactions').likes.length === 1) ok('people can still react while the word is shown');
else bad('reaction refused after the turn');

console.log('\n\x1b[1m3. The gallery\x1b[0m');
// The second turn draws nothing, so it should not make the gallery.
const t2 = await turn(2, false);
const fresh = await until(() => t2.guesser.saw('turn:drawing').at(-1)?.args[0]);
if (fresh.likes.length === 0) ok("the next drawing does not inherit the last one's likes");
t2.guesser.emit('chat:guess', { text: t2.word });

const end = await until(() => A.last('game:end'), 20000);
if (end?.gallery?.length === 1) ok('game end brings the gallery; a blank turn is left out');
else bad('gallery wrong', JSON.stringify(end?.gallery?.map(d => d.word)));
const d = end.gallery[0];
if (d.word === t1.word && d.drawerId === (t1.drawer === A ? ids.A : ids.B)) ok(`it is the right drawing ("${d.word}")`);
if (d.likes.length === 1 && d.ops.length === 1 && d.ops[0].pts.length === 6 && d.drawerName) ok('it keeps its strokes, its reactions and who drew it');
else bad('drawing incomplete', JSON.stringify({ likes: d.likes, ops: d.ops.length }));

const C = mk('C');
await ready(C);
const late = await emitAck(C, 'room:join', { code, name: 'Cy', avatar: {} });
if (late.state.phase === 'gameEnd' && late.state.gallery.length === 1) ok('someone arriving at the podium gets the gallery too');
else bad('late arrival has no gallery', JSON.stringify({ phase: late.state.phase, n: late.state.gallery?.length }));
C.close();

console.log(`\n\x1b[1m${pass.length} passed, ${fail.length} failed\x1b[0m`);
[A, B].forEach(s => s.close());
process.exit(fail.length ? 1 : 0);
