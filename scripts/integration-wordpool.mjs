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
  s.label = label; s.log = log;
  s.saw = (ev) => log.filter(e => e.ev === ev);
  return s;
}
const ready = (s) => new Promise(r => s.on('connect', r));
const emitAck = (s, ev, p) => new Promise(r => s.emit(ev, p, r));
const last = (s, ev) => s.saw(ev).at(-1)?.args[0];

/** The dev server restarts on file changes, and a suite launched into that
 *  window dies on a dropped first connection. Wait for a settled server. */
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
  console.log('\x1b[31mServer never became ready at ' + URL + '\x1b[0m');
  process.exit(1);
}
await waitForServer();

const A = mk('A'), B = mk('B');
await Promise.all([ready(A), ready(B)]);

const ca = await emitAck(A, 'room:create', { name: 'Alice', avatar: {} });
const code = ca.state.code;
const cb = await emitAck(B, 'room:join', { code, name: 'Bob', avatar: {} });
const fresh = async () => (await emitAck(B, 'room:join', { code, name: 'Bob', avatar: {}, token: cb.token })).state.settings;

console.log('\n\x1b[1m1. Defaults\x1b[0m');
const s0 = ca.state.settings;
if (s0.wordSource === 'builtin' && Array.isArray(s0.customWords) && s0.customWords.length === 0) ok('new room uses the built-in list, no words of its own');
else bad('unexpected defaults', JSON.stringify(s0));

console.log('\n\x1b[1m2. Only the host can set words\x1b[0m');
B.emit('room:words', { text: 'sneaky, words, here' });
B.emit('room:settings', { wordSource: 'custom' });
await sleep(300);
let s = await fresh();
if (s.customWords.length === 0 && s.wordSource === 'builtin') ok('non-host words and source ignored');
else bad('non-host changed the pool', JSON.stringify(s));

console.log('\n\x1b[1m3. Host saves words\x1b[0m');
A.emit('room:words', { text: 'Pizza, taco\nno;pizza, r2d2' });
await sleep(300);
const seen = last(B, 'room:settings');
if (JSON.stringify(seen?.customWords) === JSON.stringify(['Pizza', 'taco'])) ok('broadcast to everyone, parsed and de-duplicated');
else bad('words not broadcast as parsed', JSON.stringify(seen?.customWords));
A.emit('room:settings', { customWords: ['smuggled'] });
await sleep(300);
s = await fresh();
if (!s.customWords.includes('smuggled')) ok('room:settings cannot patch the word list');
else bad('customWords slipped through room:settings');

console.log('\n\x1b[1m4. "Only mine" with too few words will not start\x1b[0m');
A.emit('room:settings', { wordSource: 'custom', wordChoices: 3 });
await sleep(200);
A.emit('game:start');
await sleep(500);
const err = last(A, 'error');
if (err?.code === 'FEW_WORDS') ok(`refused: "${err.message}"`);
else bad('expected FEW_WORDS', JSON.stringify(err));
if (A.saw('turn:choosing').length === 0) ok('no turn began');
else bad('a turn began anyway');

console.log('\n\x1b[1m5. "Only mine" with enough words\x1b[0m');
const mine = ['office chair', 'coffee mug', 'standup', 'deadline', 'printer', 'whiteboard',
  'laptop', 'stapler', 'water cooler', 'elevator', 'parking lot', 'lunchbox'];
A.emit('room:words', { text: mine.join('\n') });
await sleep(300);
A.emit('game:start');
await sleep(800);
const offer = [...A.saw('turn:choosing'), ...B.saw('turn:choosing')].map(e => e.args[0]).find(p => p.words);
if (!offer) bad('drawer never got options');
else if (offer.words.length === 3 && offer.words.every(w => mine.includes(w.text))) ok(`drawer offered only host words: ${offer.words.map(w => w.text).join(', ')}`);
else bad('options came from outside the host list', JSON.stringify(offer.words));

console.log('\n\x1b[1m6. Words are locked once playing\x1b[0m');
A.emit('room:words', { text: 'late, change, attempt' });
await sleep(300);
s = await fresh();
if (s.customWords.length === mine.length) ok('mid-game word change ignored');
else bad('word list changed mid-game', JSON.stringify(s.customWords));

A.close(); B.close();
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
