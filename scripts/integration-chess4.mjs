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

const N = 14;
const sq = (file, rank) => rank * N + file;

const R = mk('Red'), B = mk('Blue'), Y = mk('Yellow'), G = mk('Green');
await Promise.all([ready(R), ready(B), ready(Y), ready(G)]);

console.log('\n\x1b[1m1. A four-player room\x1b[0m');
const cr = await emitAck(R, 'room:create', { name: 'Rosa', avatar: {}, game: 'kungfu' });
const code = cr.state.code;
const cb = await emitAck(B, 'room:join', { code, name: 'Bo', avatar: {} });
const cy = await emitAck(Y, 'room:join', { code, name: 'Yuki', avatar: {} });
const cg = await emitAck(G, 'room:join', { code, name: 'Gil', avatar: {} });
R.emit('chess:settings', { variant: 'cruciform', cooldownMs: 1000 });
await sleep(400);
let st = B.last('chess:state');
if (st?.settings.variant === 'cruciform') ok('switched to the cruciform board');
else bad('variant not applied', JSON.stringify(st?.settings));

console.log('\n\x1b[1m2. Four seats\x1b[0m');
R.emit('chess:seat', { side: 'r' });
B.emit('chess:seat', { side: 'b' });
Y.emit('chess:seat', { side: 'y' });
await sleep(500);
R.emit('game:start');
await sleep(400);
if ((R.last('chess:state')?.phase ?? 'lobby') === 'lobby') ok('will not start with a side unseated');
else bad('started with an empty seat');

G.emit('chess:seat', { side: 'g' });
await sleep(400);
R.emit('game:start');
const board = await waitForMatch(B, 'chess:state', (s) => s.phase === 'playing', 6000);
if (board.pieces.length === 64) ok('64 pieces dealt — four armies of sixteen');
else bad('wrong piece count', String(board.pieces.length));
const kings = board.pieces.filter(p => p.type === 'k').map(p => p.side).sort();
if (JSON.stringify(kings) === JSON.stringify(['b', 'g', 'r', 'y'])) ok('a king for each of the four sides');
else bad('kings wrong', JSON.stringify(kings));
if (board.pieces.every(p => [0,1,12,13].includes(p.square % N) || [0,1,12,13].includes(Math.floor(p.square / N)))) {
  ok('every army starts on its own edge');
} else bad('pieces are not on the edges');

console.log('\n\x1b[1m3. Four directions of play\x1b[0m');
const at = (f, r) => board.pieces.find(p => p.square === sq(f, r));
const redPawn = at(5, 1);
R.emit('chess:move', { pieceId: redPawn.id, to: sq(5, 3) });   // up, double step
const rm = await waitForMatch(Y, 'chess:moved', (m) => m.pieceId === redPawn.id, 5000).catch(() => null);
if (rm?.to === sq(5, 3)) ok('a red pawn advances up the board');
else bad('red pawn move failed', JSON.stringify(rm));

const bluePawn = at(1, 5);
B.emit('chess:move', { pieceId: bluePawn.id, to: sq(3, 5) });  // sideways, double step
const bm = await waitForMatch(Y, 'chess:moved', (m) => m.pieceId === bluePawn.id, 5000).catch(() => null);
if (bm?.to === sq(3, 5)) ok('a blue pawn advances sideways — its own forward');
else bad('blue pawn move failed', JSON.stringify(bm));

const greenPawn = at(12, 7);
G.emit('chess:move', { pieceId: greenPawn.id, to: sq(10, 7) });
const gm = await waitForMatch(Y, 'chess:moved', (m) => m.pieceId === greenPawn.id, 5000).catch(() => null);
if (gm?.to === sq(10, 7)) ok('a green pawn advances the other way');
else bad('green pawn move failed', JSON.stringify(gm));

// A red pawn cannot move like a blue one.
const redPawn2 = at(6, 1);
R.emit('chess:move', { pieceId: redPawn2.id, to: sq(7, 1) });
await sleep(300);
if (R.saw('chess:rejected').some(e => /cannot go there/i.test(e.args[0].reason))) {
  ok('a red pawn cannot move sideways');
} else bad('sideways red pawn accepted');

console.log('\n\x1b[1m4. Elimination keeps the game going\x1b[0m');
Y.disconnect();
const elim1 = await waitForMatch(B, 'chess:eliminated', (e) => e.side === 'y', 6000).catch(() => null);
if (elim1) ok('yellow is knocked out when they leave');
else bad('no elimination on departure');
await sleep(300);
if (B.saw('chess:over').length === 0) ok('with three left, the game carries on');
else bad('game ended too early', JSON.stringify(B.last('chess:over')));

const stAfter = B.last('chess:state');
if (stAfter?.eliminated?.includes('y')) ok('state lists yellow as eliminated');
else bad('eliminated list wrong', JSON.stringify(stAfter?.eliminated));
if (stAfter?.pieces.some(p => p.side === 'y')) ok("a dead army's pieces stay on the board as obstacles");
else bad('yellow pieces vanished');

console.log('\n\x1b[1m5. Last one standing wins\x1b[0m');
G.disconnect();
await sleep(600);
if (B.saw('chess:over').length === 0) ok('two left, still playing');
else bad('ended with two players still in');

B.disconnect();
const over = await waitForMatch(R, 'chess:over', () => true, 6000).catch(() => null);
if (over?.winner === 'r') ok('red is the last standing and wins');
else bad('wrong winner', JSON.stringify(over));
if (over?.reason === 'opponent-left') ok('the ending names what caused it');
else bad('wrong reason', String(over?.reason));

console.log('\n\x1b[1m6. The classic board still works alongside\x1b[0m');
{
  const [X, Z] = [mk('X'), mk('Z')];
  await Promise.all([ready(X), ready(Z)]);
  const cx = await emitAck(X, 'room:create', { name: 'Xu', avatar: {}, game: 'kungfu' });
  await emitAck(Z, 'room:join', { code: cx.state.code, name: 'Zed', avatar: {} });
  X.emit('chess:seat', { side: 'w' });
  Z.emit('chess:seat', { side: 'b' });
  await sleep(400);
  X.emit('game:start');
  const cl = await waitForMatch(Z, 'chess:state', (s) => s.phase === 'playing', 6000);
  if (cl.pieces.length === 32 && cl.settings.variant === 'classic') ok('a default room is still the 8x8 two-player game');
  else bad('classic default broken', JSON.stringify({ n: cl.pieces.length, v: cl.settings.variant }));
  X.disconnect(); Z.disconnect();
}

console.log(`\n\x1b[1mRESULT: ${pass.length} passed, ${fail.length} failed\x1b[0m`);
if (fail.length) { console.log('\nFailures:'); fail.forEach(f => console.log(`  - ${f}`)); }
process.exit(fail.length ? 1 : 0);
