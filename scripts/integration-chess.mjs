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
/** Waits for the NEXT event matching a predicate. `waitFor` returns the first
 *  one ever seen, which is wrong once several moves share an event name. */
const waitForMatch = (s, ev, pred, ms = 9000) => new Promise((res, rej) => {
  const hit = s.saw(ev).map(e => e.args[0]).find(pred);
  if (hit) return res(hit);
  const t = setTimeout(() => rej(new Error(`${s.label} never got a matching ${ev}`)), ms);
  const on = (a) => { if (pred(a)) { clearTimeout(t); s.off(ev, on); res(a); } };
  s.on(ev, on);
});
const waitFor = (s, ev, ms = 9000) => new Promise((res, rej) => {
  const hit = s.saw(ev);
  if (hit.length) return res(hit[0].args[0]);
  const t = setTimeout(() => rej(new Error(`${s.label} never got ${ev}`)), ms);
  s.once(ev, (a) => { clearTimeout(t); res(a); });
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

// Board indices: 0 = a1, 63 = h8.
const SQ = (name) => ('abcdefgh'.indexOf(name[0]) + (Number(name[1]) - 1) * 8);
const pieceAt = (state, name) => state.pieces.find(p => p.square === SQ(name));

const W = mk('White'), B = mk('Black'), S = mk('Spec');
await Promise.all([ready(W), ready(B), ready(S)]);

console.log('\n\x1b[1m1. Creating a Kung Fu Chess room\x1b[0m');
const cw = await emitAck(W, 'room:create', { name: 'Wanda', avatar: {}, game: 'kungfu' });
if (cw.ok && cw.state.kind === 'kungfu') ok(`room created as kungfu (${cw.state.code})`);
else { bad('room not created as kungfu', JSON.stringify(cw.ok && cw.state.kind)); process.exit(1); }
const code = cw.state.code;
const cb = await emitAck(B, 'room:join', { code, name: 'Blake', avatar: {} });
const cs = await emitAck(S, 'room:join', { code, name: 'Sam', avatar: {} });
if (cb.ok && cs.ok) ok('two more joined'); else bad('joins failed');
if (cw.state.game.phase === 'lobby' && cw.state.game.pieces.length === 0) ok('starts empty, in the lobby');
else bad('unexpected initial game state');

console.log('\n\x1b[1m2. Seats\x1b[0m');
W.emit('chess:settings', { cooldownMs: 1000 });
W.emit('chess:seat', { side: 'w' });
await sleep(250);
B.emit('chess:seat', { side: 'w' });
await sleep(250);
let st = B.last('chess:state');
if (st.seats.w === cw.playerId) ok('a taken seat cannot be stolen');
else bad('seat was stolen', JSON.stringify(st.seats));
if (B.saw('error').some(e => e.args[0].code === 'SEAT_TAKEN')) ok('the would-be taker is told why');
else bad('no SEAT_TAKEN error');

B.emit('chess:seat', { side: 'b' });
await sleep(300);
st = W.last('chess:state');
if (st.seats.w === cw.playerId && st.seats.b === cb.playerId) ok('both sides seated');
else bad('seats wrong', JSON.stringify(st.seats));

console.log('\n\x1b[1m3. Starting\x1b[0m');
S.emit('game:start');
await sleep(250);
if ((W.last('chess:state')?.phase ?? 'lobby') === 'lobby') ok('a non-host cannot start');
else bad('a non-host started the game');

W.emit('game:start');
await sleep(400);
st = S.last('chess:state');
if (st.phase === 'playing' && st.pieces.length === 32) ok('game running with 32 pieces');
else bad('bad start state', JSON.stringify({ phase: st?.phase, n: st?.pieces?.length }));
if (st.pieces.filter(p => p.type === 'k').length === 2) ok('both kings on the board');
else bad('kings missing');

console.log('\n\x1b[1m4. Who may move\x1b[0m');
const e2 = pieceAt(st, 'e2');
S.emit('chess:move', { pieceId: e2.id, to: SQ('e4') });
await sleep(300);
if (S.saw('chess:rejected').length === 1) ok(`spectator refused ("${S.last('chess:rejected').reason}")`);
else bad('spectator was allowed to move');

B.emit('chess:move', { pieceId: e2.id, to: SQ('e4') });
await sleep(300);
if (B.saw('chess:rejected').some(e => /not your piece/i.test(e.args[0].reason))) ok("cannot move the opponent's piece");
else bad('moved an enemy piece');

console.log('\n\x1b[1m5. Move legality\x1b[0m');
W.emit('chess:move', { pieceId: e2.id, to: SQ('e5') });
await sleep(250);
if (W.saw('chess:rejected').some(e => /cannot go there/i.test(e.args[0].reason))) ok('a pawn cannot leap three squares');
else bad('illegal pawn move accepted');
W.emit('chess:move', { pieceId: e2.id, to: 99 });
await sleep(250);
if (W.saw('chess:rejected').length >= 2) ok('an off-board destination is refused');
else bad('off-board move accepted');

console.log('\n\x1b[1m6. A legal move\x1b[0m');
W.emit('chess:move', { pieceId: e2.id, to: SQ('e4') });
const moved = await waitFor(B, 'chess:moved', 5000);
if (moved.to === SQ('e4') && moved.from === SQ('e2')) ok('pawn e2-e4, and the opponent sees it');
else bad('move not relayed correctly', JSON.stringify(moved));
if (moved.readyAt > Date.now()) ok('the piece comes back with a cooldown');
else bad('no cooldown set');

console.log('\n\x1b[1m7. Cooldown is enforced\x1b[0m');
const before = W.saw('chess:rejected').length;
W.emit('chess:move', { pieceId: e2.id, to: SQ('e5') });
await sleep(250);
if (W.saw('chess:rejected').slice(before).some(e => /breath/i.test(e.args[0].reason))) ok('the same piece cannot move again immediately');
else bad('cooldown not enforced');

// A DIFFERENT piece is free to move, which is the whole point of the game.
const d2 = pieceAt(S.last('chess:state') ?? st, 'd2') ?? st.pieces.find(p => p.square === SQ('d2'));
const beforeMoves = B.saw('chess:moved').length;
W.emit('chess:move', { pieceId: d2.id, to: SQ('d4') });
await sleep(400);
if (B.saw('chess:moved').length > beforeMoves) ok('a different piece may move at once — no turns');
else bad('a second piece was blocked; this is not turn-based');

console.log('\n\x1b[1m8. Capture and the king\x1b[0m');
// Scholar's route: the queen needs e2 vacated, which the first move did.
const queen = st.pieces.find(p => p.side === 'w' && p.type === 'q');
await sleep(1200);
W.emit('chess:move', { pieceId: queen.id, to: SQ('h5') });
const qh5 = await waitForMatch(B, 'chess:moved', (m) => m.pieceId === queen.id, 5000);
if (qh5.to === SQ('h5')) ok('queen swings out to h5');
else bad('queen went somewhere unexpected', JSON.stringify(qh5));

await sleep(1900);
const capBefore = B.saw('chess:moved').length;
W.emit('chess:move', { pieceId: queen.id, to: SQ('f7') });
await sleep(600);
const cap = B.saw('chess:moved').slice(capBefore).map(e => e.args[0]).find(m => m.to === SQ('f7'));
if (cap?.captured) ok('queen takes f7, and the capture is reported');
else bad('capture not reported', JSON.stringify(cap));

await sleep(1900);
W.emit('chess:move', { pieceId: queen.id, to: SQ('e8') });
const over = await waitFor(B, 'chess:over', 6000);
if (over.winner === 'w' && over.reason === 'king-captured') ok('taking the king wins it — no checkmate needed');
else bad('game did not end on king capture', JSON.stringify(over));

console.log('\n\x1b[1m9. After the game\x1b[0m');
W.emit('chess:move', { pieceId: queen.id, to: SQ('e7') });
await sleep(300);
if (W.saw('chess:rejected').some(e => /not running/i.test(e.args[0].reason))) ok('no moves once it is over');
else bad('a move was accepted after the game ended');

console.log('\n\x1b[1m10. A seated player leaving ends it\x1b[0m');
{
  const [X, Y] = [mk('X'), mk('Y')];
  await Promise.all([ready(X), ready(Y)]);
  const cx = await emitAck(X, 'room:create', { name: 'Xu', avatar: {}, game: 'kungfu' });
  const rc = cx.state.code;
  await emitAck(Y, 'room:join', { code: rc, name: 'Yara', avatar: {} });
  X.emit('chess:seat', { side: 'w' });
  Y.emit('chess:seat', { side: 'b' });
  await sleep(300);
  X.emit('game:start');
  await sleep(400);
  Y.disconnect();
  const end = await waitFor(X, 'chess:over', 6000);
  if (end.winner === 'w' && end.reason === 'opponent-left') ok('the remaining player wins when their opponent drops');
  else bad('wrong ending after a drop', JSON.stringify(end));
  X.disconnect();
}

console.log('\n\x1b[1m11. Pawns always promote\x1b[0m');
{
  const [P, Q] = [mk('P'), mk('Q')];
  await Promise.all([ready(P), ready(Q)]);
  const cp = await emitAck(P, 'room:create', { name: 'Pia', avatar: {}, game: 'kungfu' });
  const rc = cp.state.code;
  await emitAck(Q, 'room:join', { code: rc, name: 'Quinn', avatar: {} });
  P.emit('chess:seat', { side: 'w' });
  Q.emit('chess:seat', { side: 'b' });
  P.emit('chess:settings', { cooldownMs: 1000 }); // pawns rest 600ms
  await sleep(350);
  P.emit('game:start');
  // Seat changes also broadcast chess:state, so wait for the one holding a
  // full board rather than whichever arrives first.
  const board = await waitForMatch(P, 'chess:state', (st) => st.pieces.length === 32, 6000);
  const at = (name) => board.pieces.find(x => x.square === SQ(name));

  const wPawn = at('a2');
  const bPawn = at('b7');
  // Clear b7 so the white pawn has a road, then walk it up the b-file and take
  // the a8 rook diagonally — a pawn cannot capture straight ahead.
  Q.emit('chess:move', { pieceId: bPawn.id, to: SQ('b5') });
  await sleep(500);
  P.emit('chess:move', { pieceId: wPawn.id, to: SQ('a4') });
  await sleep(800);
  P.emit('chess:move', { pieceId: wPawn.id, to: SQ('b5') });   // captures
  await sleep(800);
  P.emit('chess:move', { pieceId: wPawn.id, to: SQ('b6') });
  await sleep(800);
  P.emit('chess:move', { pieceId: wPawn.id, to: SQ('b7') });
  await sleep(800);
  P.emit('chess:move', { pieceId: wPawn.id, to: SQ('a8') });   // captures + promotes

  const promo = await waitForMatch(
    Q, 'chess:moved', (m) => m.pieceId === wPawn.id && m.to === SQ('a8'), 6000,
  ).catch(() => null);
  if (promo?.promotedTo === 'q') ok('a pawn reaching the last rank becomes a queen');
  else bad('no promotion reported', JSON.stringify(promo));

  // Moves travel as deltas — the server does not re-broadcast the whole board
  // after one. To check its authoritative state really changed, join fresh and
  // read the snapshot a new arrival is given.
  await sleep(400);
  const R = mk('R');
  await ready(R);
  const joined = await emitAck(R, 'room:join', { code: rc, name: 'Rae', avatar: {} });
  const piece = joined.ok && joined.state.kind === 'kungfu'
    ? joined.state.game.pieces.find(x => x.id === wPawn.id)
    : null;
  if (piece?.type === 'q' && piece.square === SQ('a8')) {
    ok('a late joiner sees a queen on a8, so the server state really changed');
  } else {
    bad('server state does not hold the promoted queen', JSON.stringify(piece));
  }
  P.disconnect(); Q.disconnect(); R.disconnect();
}

console.log(`\n\x1b[1mRESULT: ${pass.length} passed, ${fail.length} failed\x1b[0m`);
if (fail.length) { console.log('\nFailures:'); fail.forEach(f => console.log(`  - ${f}`)); }
process.exit(fail.length ? 1 : 0);
