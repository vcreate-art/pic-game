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

const R1 = mk('R1'), R2 = mk('R2'), B1 = mk('B1'), B2 = mk('B2'), S = mk('Spec');
const all = [R1, R2, B1, B2, S];
await Promise.all(all.map(ready));

console.log('\n\x1b[1m1. A Word Spies room\x1b[0m');
const c = await emitAck(R1, 'room:create', { name: 'Rae', avatar: {}, game: 'spies' });
if (c.ok && c.state.kind === 'spies' && c.state.game.phase === 'lobby') ok(`room created (${c.state.code})`);
else { bad('not a spies room'); process.exit(1); }
const code = c.state.code;
const ids = { R1: c.playerId };
for (const [s, name] of [[R2, 'Rob'], [B1, 'Bea'], [B2, 'Ben'], [S, 'Sam']]) {
  const j = await emitAck(s, 'room:join', { code, name, avatar: {} });
  ids[s.label] = j.playerId;
}

console.log('\n\x1b[1m2. Teams\x1b[0m');
R1.emit('game:start');
await sleep(200);
if (R1.errors().includes('NOT_READY')) ok('cannot start without two full teams');
else bad('started without teams');

R1.emit('spies:join', { team: 'red', role: 'spymaster' });
await sleep(150);
R2.emit('spies:join', { team: 'red', role: 'spymaster' });
await sleep(200);
if (R2.errors().includes('SEAT_TAKEN')) ok('a team has one spymaster');
else bad('two spymasters');
R2.emit('spies:join', { team: 'red', role: 'operative' });
B1.emit('spies:join', { team: 'blue', role: 'spymaster' });
B2.emit('spies:join', { team: 'blue', role: 'operative' });
await sleep(250);
let st = S.last('spies:state');
if (st.teams.red.spymaster === ids.R1 && st.teams.blue.operatives.includes(ids.B2)) ok('both teams seated');
else bad('seats wrong', JSON.stringify(st.teams));

console.log('\n\x1b[1m3. Words\x1b[0m');
B1.emit('spies:settings', { clueMode: 'spoken' });
R1.emit('spies:settings', { wordSource: 'custom', guessSeconds: 9999 });
R1.emit('spies:words', { text: 'alpha, bravo, charlie\ndelta' });
await sleep(250);
st = S.last('spies:state');
if (st.settings.clueMode === 'typed' && st.settings.guessSeconds === 300) ok('only the host changes settings; timers clamp');
else bad('settings wrong', JSON.stringify(st.settings));
if (st.settings.customWords.length === 4) ok("the host's words are parsed");
else bad('custom words wrong', JSON.stringify(st.settings.customWords));
R1.emit('game:start');
await sleep(200);
if (R1.errors().includes('FEW_WORDS')) ok('too few words of their own to fill a board');
else bad('dealt with 4 words');
R1.emit('spies:settings', { wordSource: 'mixed', guessSeconds: 0 });

console.log('\n\x1b[1m4. The key stays secret\x1b[0m');
R1.emit('game:start');
await sleep(400);
st = S.last('spies:state');
if (st.phase === 'clue' && st.board.length === 25) ok(`dealt; ${st.turn} goes first`);
else bad('no game', JSON.stringify(st.phase));
const key = R1.last('spies:key')?.key;
if (key?.length === 25 && B1.last('spies:key')) ok('both spymasters got the key');
else bad('spymasters missing the key');
if (!R2.saw('spies:key').length && !B2.saw('spies:key').length && !S.saw('spies:key').length) ok('operatives and spectators did not');
else bad('key leaked to a guesser');
if ([R2, B2, S].every(s => s.saw('spies:state').every(e => e.args[0].key === null || e.args[0].phase === 'ended'))) ok('and no state carries it while play is on');
else bad('key in state');

const T = st.turn;
const O = T === 'red' ? 'blue' : 'red';
const SM = { red: R1, blue: B1 };
const OP = { red: R2, blue: B2 };
const idx = (color, n = 0) => key.map((k, i) => [k, i]).filter(([k, i]) => k === color && st.board[i].revealed === null)[n][1];

R2.emit('spies:join', { team: 'blue', role: 'operative' });
await sleep(200);
if (R2.errors().includes('LOCKED')) ok('teams are locked mid-game');
else bad('switched mid-game');
S.emit('spies:join', { team: 'red', role: 'operative' });
await sleep(200);
if (S.last('spies:state').teams.red.operatives.includes(ids.Spec)) ok('a spectator can join a team as a guesser');
else bad('spectator could not join');
if (!S.saw('spies:key').length) ok('...and still gets no key');

console.log('\n\x1b[1m5. Clues\x1b[0m');
SM[O].emit('spies:clue', { word: 'zyzzyva', count: 1 });
await sleep(150);
if (S.last('spies:state').phase === 'clue') ok("the other spymaster cannot give this team's clue");
SM[T].emit('spies:clue', { word: st.board[0].word, count: 1 });
await sleep(200);
if (SM[T].errors().includes('BAD_CLUE')) ok('a clue that is a board word is refused');
else bad('board word accepted');
SM[T].emit('spies:clue', { word: 'zyzzyva', count: 1 });
await sleep(200);
st = S.last('spies:state');
if (st.phase === 'guess' && st.clue?.word === 'ZYZZYVA' && st.guessesLeft === 2) ok('ZYZZYVA 1: two guesses');
else bad('clue not taken', JSON.stringify(st.clue));

console.log('\n\x1b[1m6. Guessing\x1b[0m');
SM[T].emit('spies:reveal', { index: idx(T) });
OP[O].emit('spies:reveal', { index: idx(T) });
await sleep(200);
if (S.last('spies:state').board.every(b => b.revealed === null)) ok('spymasters and the other team cannot reveal');
OP[T].emit('spies:mark', { index: idx(T) });
await sleep(150);
if (S.last('spies:state').marks[idx(T)]?.length === 1) ok('a guesser can point at a card for the team');
OP[T].emit('spies:reveal', { index: idx(T) });
await sleep(200);
st = S.last('spies:state');
if (st.phase === 'guess' && st.guessesLeft === 1 && st.remaining[T] === (T === st.starting ? 8 : 7)) ok('own agent: keep going');
else bad('own agent wrong', JSON.stringify({ phase: st.phase, left: st.guessesLeft, rem: st.remaining }));
if (Object.keys(st.marks).length === 0) ok('pointers clear after a reveal');
OP[T].emit('spies:reveal', { index: idx('neutral') });
await sleep(200);
st = S.last('spies:state');
if (st.phase === 'clue' && st.turn === O) ok('a bystander ends the turn');
else bad('turn did not pass', JSON.stringify({ phase: st.phase, turn: st.turn }));

SM[O].emit('spies:clue', { word: 'quux', count: 0 });
await sleep(200);
st = S.last('spies:state');
if (st.guessesLeft === -1) ok('a 0 clue means guess as many as you like');
OP[O].emit('spies:pass');
await sleep(200);
st = S.last('spies:state');
if (st.turn === T && st.phase === 'clue') ok('guessers can pass the turn');

SM[T].emit('spies:clue', { word: 'blorp', count: 2 });
await sleep(200);
OP[T].emit('spies:reveal', { index: idx('assassin') });
await sleep(300);
st = S.last('spies:state');
if (st.phase === 'ended' && st.winner === O && st.reason === 'assassin') ok(`the assassin: ${O} wins`);
else bad('assassin not handled', JSON.stringify({ phase: st.phase, winner: st.winner }));
if (st.key?.length === 25) ok('the key is shown to everyone at the end');
else bad('no key at the end');

console.log('\n\x1b[1m7. The clock\x1b[0m');
R1.emit('spies:toLobby');
await sleep(200);
R1.emit('spies:settings', { clueSeconds: 1 });
await sleep(150);
R1.emit('game:start');
await sleep(300);
st = S.last('spies:state');
if (st.endsAt > Date.now()) ok('the clue clock is running');
else bad('no clue clock');
const turn2 = st.turn;
await sleep(1500);
st = S.last('spies:state');
if (st.turn !== turn2 && st.phase === 'clue') ok("time's up passes the turn");
else bad('clock did not pass the turn', JSON.stringify({ turn: st.turn, was: turn2 }));
R1.emit('spies:settings', { clueSeconds: 0 });

console.log('\n\x1b[1m8. At a real table\x1b[0m');
// A typed game never hands the key to someone who only asks for it.
S.emit('spies:peek');
await sleep(200);
if (!S.saw('spies:key').length) ok('asking for the key in a typed game gets nothing');
else bad('typed game handed out the key');

const H = mk('Host2'), P = mk('Pal');
await Promise.all([ready(H), ready(P)]);
const t2 = await emitAck(H, 'room:create', { name: 'Hana', avatar: {}, game: 'spies' });
await emitAck(P, 'room:join', { code: t2.state.code, name: 'Pat', avatar: {} });
H.emit('spies:settings', { clueMode: 'spoken' });
await sleep(150);
H.emit('game:start');
await sleep(300);
let t = P.last('spies:state');
if (t?.phase === 'guess' && !H.errors().includes('NOT_READY')) ok('a spoken game starts with nobody seated, straight into guessing');
else bad('spoken game did not start', JSON.stringify({ phase: t?.phase, errors: H.errors() }));
if (!P.saw('spies:key').length) ok('nobody is sent the key unasked');
P.emit('spies:peek');
await sleep(200);
const tkey = P.last('spies:key')?.key;
if (tkey?.length === 25 && !H.saw('spies:key').length) ok('the key goes to the phone that asks, and only that one');
else bad('peek wrong');
const turn = t.turn;
const other = turn === 'red' ? 'blue' : 'red';
P.emit('spies:reveal', { index: tkey.indexOf(turn) });
await sleep(200);
t = P.last('spies:state');
if (t.board.some(b => b.revealed === turn) && t.turn === turn) ok('anyone can turn a card over; the right one keeps the turn');
else bad('reveal refused at the table', JSON.stringify({ turn: t.turn }));
H.emit('spies:reveal', { index: tkey.indexOf('neutral') });
await sleep(200);
t = P.last('spies:state');
if (t.turn === other && t.phase === 'guess') ok('a wrong card passes the turn, straight to guessing again');
else bad('turn did not pass', JSON.stringify({ turn: t.turn, phase: t.phase }));
P.emit('spies:pass');
await sleep(200);
if (P.last('spies:state').turn === turn) ok('anyone can end the turn');
H.close(); P.close();

console.log(`\n\x1b[1m${pass.length} passed, ${fail.length} failed\x1b[0m`);
all.forEach(s => s.close());
process.exit(fail.length ? 1 : 0);
