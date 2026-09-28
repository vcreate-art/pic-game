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
  s.errors = () => s.saw('error').map(e => e.args[0].code);
  s.raw = () => JSON.stringify(log);
  return s;
}
const ready = (s) => new Promise(r => s.on('connect', r));
const emitAck = (s, ev, p) => new Promise(r => s.emit(ev, p, r));

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

const A = mk('A'), B = mk('B'), C = mk('C');
const all = [A, B, C];
await Promise.all(all.map(ready));

console.log('\n\x1b[1m1. A Bingo room\x1b[0m');
const c = await emitAck(A, 'room:create', { name: 'Ann', avatar: {}, game: 'bingo' });
if (c.ok && c.state.kind === 'bingo' && c.state.game.phase === 'lobby') ok(`room created (${c.state.code})`);
else { bad('not a bingo room', JSON.stringify(c)); process.exit(1); }
const code = c.state.code;
const ids = { A: c.playerId };

A.emit('game:start');
await sleep(200);
if (A.errors().includes('NOT_READY')) ok('a turns game needs two players');
else bad('turns game started alone');

ids.B = (await emitAck(B, 'room:join', { code, name: 'Bo', avatar: {} })).playerId;

console.log('\n\x1b[1m2. Settings\x1b[0m');
B.emit('bingo:settings', { mode: 'caller' });
A.emit('bingo:settings', { turnSeconds: 9999, callSeconds: -4 });
await sleep(200);
let st = B.last('bingo:state');
if (st.settings.mode === 'turns' && st.settings.turnSeconds === 120 && st.settings.callSeconds === 0) ok('only the host changes settings; times clamp');
else bad('settings wrong', JSON.stringify(st.settings));
A.emit('bingo:settings', { turnSeconds: 0 });

console.log('\n\x1b[1m3. Filling in grids\x1b[0m');
A.emit('game:start');
await sleep(250);
st = B.last('bingo:state');
if (st.phase === 'arrange' && st.players.length === 2) ok('the host hands out grids');
else bad('not arranging', JSON.stringify(st));

ids.C = (await emitAck(C, 'room:join', { code, name: 'Cy', avatar: {} })).playerId;
await sleep(100);
if (!C.last('bingo:state') || !A.last('bingo:state').players.includes(ids.C)) ok('a late arrival watches this game');

const plain = Array.from({ length: 25 }, (_, i) => i + 1);
// B writes its numbers so that each of its rows is one of A's columns.
const transposed = plain.map((_, i) => plain[(i % 5) * 5 + Math.floor(i / 5)]);
A.emit('bingo:ready', { card: [...plain.slice(1), 2] });
await sleep(150);
if (A.errors().includes('BAD_CARD')) ok('a grid must use 1 to 25 once each');
else bad('bad grid accepted');

A.emit('bingo:ready', { card: plain });
await sleep(150);
st = B.last('bingo:state');
if (st.phase === 'arrange' && st.ready.includes(ids.A)) ok('one grid in, still waiting for the other');
else bad('ready not recorded', JSON.stringify(st));
if (A.last('bingo:card')?.numbers.join() === plain.join()) ok('your grid comes back to you');
C.emit('bingo:ready', { card: plain });
await sleep(100);
if (!B.last('bingo:state').ready.includes(ids.C)) ok('a watcher cannot send a grid');

B.emit('bingo:ready', { card: transposed });
await sleep(250);
st = B.last('bingo:state');
if (st.phase === 'play' && st.turn) ok(`everyone is in, so play starts (${st.turn === ids.A ? 'Ann' : 'Bo'} first)`);
else bad('play did not start', JSON.stringify(st));

const cardsSeen = (s, other) => s.saw('bingo:card').some(e => e.args[0]?.numbers.join() === other.join());
if (!cardsSeen(A, transposed) && !cardsSeen(B, plain) && !C.saw('bingo:card').some(e => e.args[0])) ok("nobody is sent another player's grid");
else bad('a grid leaked');
if (st.cards === null) ok('the public state carries no cards during play');

console.log('\n\x1b[1m4. Taking turns\x1b[0m');
const sockOf = { [ids.A]: A, [ids.B]: B };
const turnSock = () => sockOf[B.last('bingo:state').turn];
const notTurn = () => (turnSock() === A ? B : A);
const before = B.last('bingo:state').called.length;
notTurn().emit('bingo:call', { n: 1 });
await sleep(150);
if (B.last('bingo:state').called.length === before) ok('only the player whose turn it is can call');
else bad('called out of turn');

// Calls rows 1-4 of A (= columns 1-4 of B): four lines each, nobody wins yet.
const plan = plain.slice(0, 20);
for (const n of plan) {
  const s = turnSock();
  s.emit('bingo:call', { n });
  await sleep(60);
}
await sleep(150);
st = B.last('bingo:state');
if (st.called.length === 20 && st.lines[ids.A] === 4 && st.lines[ids.B] === 4 && st.phase === 'play') ok('turns go round; the letters count up');
else bad('turns wrong', JSON.stringify({ called: st.called.length, lines: st.lines, phase: st.phase }));

const again = turnSock();
again.emit('bingo:call', { n: 7 });
await sleep(150);
if (again.errors().includes('CALLED')) ok('a number is only called once');
else bad('repeat call allowed');

console.log('\n\x1b[1m5. BINGO\x1b[0m');
// 25 finishes A's diagonal and B's (the same cell, transposed): a shared win.
turnSock().emit('bingo:call', { n: 25 });
await sleep(250);
st = B.last('bingo:state');
if (st.phase === 'ended' && st.winners.length === 2) ok('five lines on the same call: both win');
else bad('no shared win', JSON.stringify({ phase: st.phase, winners: st.winners, lines: st.lines }));
if (st.cards && st.cards[ids.B]?.join() === transposed.join()) ok('the cards are shown once it is over');
const roomNow = B.saw('player:updated').map(e => e.args[0]);
if (roomNow.some(p => p.id === ids.A && p.score === 1) && roomNow.some(p => p.id === ids.B && p.score === 1)) ok('each winner scores a win');
else bad('scores not updated');

console.log('\n\x1b[1m6. The hall game\x1b[0m');
B.emit('bingo:toLobby');
await sleep(100);
if (B.last('bingo:state').phase === 'ended') ok('only the host goes back to the lobby');
A.emit('bingo:toLobby');
await sleep(150);
A.emit('bingo:settings', { mode: 'caller', callSeconds: 0, pattern: 'line' });
await sleep(100);
A.emit('game:start');
await sleep(250);
st = C.last('bingo:state');
const cardA = A.last('bingo:card');
if (st.phase === 'play' && st.players.length === 3 && st.called.length === 0) ok('eyes down: everyone here gets a card');
else bad('caller game did not start', JSON.stringify(st));
if (cardA?.numbers[12] === 0 && cardA.marked[12] && cardA.numbers.every((n, i) => i === 12 || (n >= (i % 5) * 15 + 1 && n <= (i % 5) * 15 + 15))) ok('a proper 75-ball card, free in the middle');
else bad('card wrong', JSON.stringify(cardA));

B.emit('bingo:next');
await sleep(100);
if (C.last('bingo:state').called.length === 0) ok('only the host draws the balls');
const uncalledIdx = cardA.numbers.findIndex((n, i) => i !== 12);
A.emit('bingo:daub', { index: uncalledIdx });
await sleep(100);
if (!A.last('bingo:card').marked[uncalledIdx]) ok('an uncalled number cannot be daubed');
else bad('daubed an uncalled number');

A.emit('bingo:claim');
await sleep(150);
if (A.errors().includes('NO_BINGO') && C.last('bingo:state').phase === 'play') ok('a false BINGO is turned down');
else bad('false bingo accepted');
const noBefore = A.errors().length;
A.emit('bingo:claim');
await sleep(100);
if (A.errors().length === noBefore) ok('…and locks the shouter out for a moment');

// The host draws until A has a line, daubing as the numbers come.
let line = false;
for (let k = 0; k < 75 && !line; k++) {
  A.emit('bingo:next');
  await sleep(40);
  const n = A.last('bingo:state').called.at(-1);
  const i = cardA.numbers.indexOf(n);
  if (i >= 0) {
    A.emit('bingo:daub', { index: i });
    await sleep(40);
    line = (A.last('bingo:state').lines[ids.A] ?? 0) > 0;
  }
}
if (line) ok(`a line after ${A.last('bingo:state').called.length} balls`);
else bad('never made a line');
await sleep(3000); // sit out the lock from the false claim
A.emit('bingo:claim');
await sleep(200);
st = C.last('bingo:state');
if (st.phase === 'ended' && st.winners.join() === ids.A) ok('a real BINGO wins');
else bad('real bingo refused', JSON.stringify({ phase: st.phase, winners: st.winners, errors: A.errors() }));

console.log('\n\x1b[1m7. A timed draw\x1b[0m');
A.emit('bingo:settings', { callSeconds: 1, autoDaub: true });
await sleep(100);
A.emit('bingo:rematch');
await sleep(2300);
st = C.last('bingo:state');
if (st.called.length >= 2 && st.endsAt > 0) ok(`balls come out on the clock (${st.called.length} in 2.3s)`);
else bad('clock not drawing', JSON.stringify({ called: st.called.length, endsAt: st.endsAt }));
const card2 = B.last('bingo:card');
if (st.called.every((n) => !card2.numbers.includes(n) || card2.marked[card2.numbers.indexOf(n)])) ok('auto-daub marks every card');
else bad('auto-daub missed');
A.emit('bingo:pause');
await sleep(150);
const held = C.last('bingo:state').called.length;
await sleep(1500);
if (C.last('bingo:state').paused && C.last('bingo:state').called.length === held) ok('the host can hold the draw');
else bad('hold did not hold');

console.log(`\n\x1b[1m${pass.length} passed, ${fail.length} failed\x1b[0m`);
all.forEach(s => s.close());
process.exit(fail.length ? 1 : 0);
