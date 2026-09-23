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
  s.blob = () => JSON.stringify(log);
  return s;
}
const ready = (s) => new Promise(r => s.on('connect', r));
const emitAck = (s, ev, p) => new Promise(r => s.emit(ev, p, r));
const waitForMatch = (s, ev, pred, ms = 9000) => new Promise((res, rej) => {
  const hit = s.saw(ev).map(e => e.args[0]).find(pred);
  if (hit) return res(hit);
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

console.log('\n\x1b[1m1. A Star Realms room\x1b[0m');
const ca = await emitAck(A, 'room:create', { name: 'Ana', avatar: {}, game: 'realms' });
if (ca.ok && ca.state.kind === 'realms') ok(`room created (${ca.state.code})`);
else { bad('not a realms room', JSON.stringify(ca.ok && ca.state.kind)); process.exit(1); }
const code = ca.state.code;
const cb = await emitAck(B, 'room:join', { code, name: 'Ben', avatar: {} });
await emitAck(S, 'room:join', { code, name: 'Sam', avatar: {} });
if (ca.state.game.phase === 'lobby' && ca.state.game.tradeRow.length === 0) ok('starts in the lobby with no cards dealt');
else bad('unexpected initial state');

console.log('\n\x1b[1m2. Seats\x1b[0m');
A.emit('realms:seat', { side: 'a' });
await sleep(250);
B.emit('realms:seat', { side: 'a' });
await sleep(300);
if (B.saw('error').some(e => e.args[0].code === 'SEAT_TAKEN')) ok('a taken seat cannot be stolen');
else bad('seat was stolen');
B.emit('realms:seat', { side: 'b' });
await sleep(300);
A.emit('realms:settings', { startingAuthority: 30 });
await sleep(300);
let st = B.last('realms:state');
if (st.seats.a === ca.playerId && st.seats.b === cb.playerId) ok('both seats filled');
else bad('seats wrong', JSON.stringify(st.seats));
if (st.settings.startingAuthority === 30) ok('host set the starting authority');
else bad('setting not applied');

console.log('\n\x1b[1m3. Dealing\x1b[0m');
S.emit('game:start');
await sleep(300);
if ((B.last('realms:state')?.phase ?? 'lobby') === 'lobby') ok('a non-host cannot start');
else bad('a non-host started the game');

A.emit('game:start');
const dealt = await waitForMatch(B, 'realms:state', (s) => s.phase === 'playing', 6000);
if (dealt.tradeRow.length === 5) ok('five cards on the trade row');
else bad('trade row wrong', String(dealt.tradeRow.length));
if (dealt.players.a.authority === 30 && dealt.players.b.authority === 30) ok('both start on the set authority');
else bad('authority wrong');
if (dealt.players.a.handCount === 3 && dealt.players.b.handCount === 5) ok('the player going first gets the shorter hand');
else bad('opening hands wrong', JSON.stringify([dealt.players.a.handCount, dealt.players.b.handCount]));

console.log('\n\x1b[1m4. Hands stay private\x1b[0m');
const myHand = await waitForMatch(A, 'realms:hand', () => true, 5000);
if (Array.isArray(myHand.hand) && myHand.hand.length === 3) ok('A is told their own three cards');
else bad('A did not get a hand', JSON.stringify(myHand));

// THE check: none of A's card ids may appear anywhere in what B or a
// spectator has received.
const mine = myHand.hand.map(c => c.id);
const leakedToB = mine.filter(id => B.blob().includes(id));
const leakedToS = mine.filter(id => S.blob().includes(id));
if (leakedToB.length === 0) ok("A's hand appears nowhere in B's traffic");
else bad('HAND LEAKED to the opponent', leakedToB.join(','));
if (leakedToS.length === 0) ok("A's hand appears nowhere in a spectator's traffic");
else bad('HAND LEAKED to a spectator', leakedToS.join(','));

if (S.saw('realms:hand').length === 0) ok('a spectator is sent no hand at all');
else bad('spectator received a hand');
const pub = B.last('realms:state');
if (!('hand' in pub.players.a) && !('deck' in pub.players.a)) ok('the public state has no hand or deck field to leak through');
else bad('public state carries private fields');

console.log('\n\x1b[1m5. Turn ownership\x1b[0m');
const bHand = await waitForMatch(B, 'realms:hand', () => true, 5000);
B.emit('realms:play', { cardId: bHand.hand[0].id });
await sleep(300);
if (B.saw('realms:rejected').some(e => /not your turn/i.test(e.args[0].reason))) ok('the player who is not on turn cannot play');
else bad('played out of turn');
S.emit('realms:play', { cardId: mine[0] });
await sleep(300);
if (S.saw('realms:rejected').some(e => /watching/i.test(e.args[0].reason))) ok('a spectator cannot play');
else bad('spectator played a card');

console.log('\n\x1b[1m6. Playing and buying\x1b[0m');
for (const id of mine) A.emit('realms:play', { cardId: id });
await sleep(500);
st = A.last('realms:state');
const pool = st.trade + st.combat;
if (pool > 0) ok(`playing the opening hand produced ${st.trade} trade and ${st.combat} combat`);
else bad('no trade or combat from three starters');
if (st.players.a.inPlay.length === 3) ok('all three cards are face up in play');
else bad('cards not in play', String(st.players.a.inPlay.length));

const afford = st.tradeRow.find(c => c) ;
A.emit('realms:buy', { cardId: afford.id });
await sleep(350);
st = A.last('realms:state');
const bought = st.players.a.discardCount > 0;
if (bought || A.saw('realms:rejected').some(e => /trade/i.test(e.args[0].reason))) {
  ok(bought ? 'bought a card, which went to the discard pile' : 'refused a card they could not afford');
} else bad('buy neither succeeded nor was refused');
if (st.tradeRow.length === 5) ok('the trade row stays full');
else bad('trade row not refilled', String(st.tradeRow.length));

console.log('\n\x1b[1m7. Ending the turn\x1b[0m');
A.emit('realms:end');
const handed = await waitForMatch(A, 'realms:state', (s) => s.turn === 'b', 5000);
if (handed.turn === 'b') ok('the turn passes');
else bad('turn did not pass');
if (handed.players.a.inPlay.length === 0 && handed.players.a.handCount === 0) ok('played cards and leftovers are swept away');
else bad('board not cleared');
if (handed.trade === 0 && handed.combat === 0) ok('the pools are emptied');
else bad('pools carried over');

console.log('\n\x1b[1m8. Winning\x1b[0m');
{
  const [X, Y] = [mk('X'), mk('Y')];
  await Promise.all([ready(X), ready(Y)]);
  const cx = await emitAck(X, 'room:create', { name: 'Xu', avatar: {}, game: 'realms' });
  const rc = cx.state.code;
  await emitAck(Y, 'room:join', { code: rc, name: 'Yara', avatar: {} });
  X.emit('realms:seat', { side: 'a' });
  Y.emit('realms:seat', { side: 'b' });
  X.emit('realms:settings', { startingAuthority: 20 });
  await sleep(400);
  X.emit('game:start');
  await waitForMatch(X, 'realms:state', (s) => s.phase === 'playing', 6000);

  // Y walking out ends it for X, which is the quickest honest ending to reach.
  Y.disconnect();
  const over = await waitForMatch(X, 'realms:over', () => true, 6000).catch(() => null);
  if (over?.winner === 'a') ok('a seated player leaving hands the game to the other');
  else bad('no ending after a departure', JSON.stringify(over));
  const done = X.last('realms:state');
  if (done?.phase === 'ended') ok('the room reports the game as over');
  else bad('phase not ended');
  X.disconnect();
}

console.log(`\n\x1b[1mRESULT: ${pass.length} passed, ${fail.length} failed\x1b[0m`);
if (fail.length) { console.log('\nFailures:'); fail.forEach(f => console.log(`  - ${f}`)); }
process.exit(fail.length ? 1 : 0);
