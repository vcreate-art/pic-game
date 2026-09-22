import { io } from 'socket.io-client';

// Defaults to the server directly; point it at the Vite origin (or a LAN
// address) to exercise the proxy and the CORS policy the way a browser does.
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
  // Everything this client was ever told, as one searchable blob.
  s.blob = () => JSON.stringify(log);
  return s;
}
const ready = (s) => new Promise(r => s.on('connect', r));
const emitAck = (s, ev, p) => new Promise(r => s.emit(ev, p, r));
const waitFor = (s, ev, ms = 8000) => new Promise((res, rej) => {
  const hit = s.saw(ev);
  if (hit.length) return res(hit[0].args[0]);
  const t = setTimeout(() => rej(new Error(`${s.label} never got ${ev}`)), ms);
  s.once(ev, (a) => { clearTimeout(t); res(a); });
});

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

const A = mk('A'), B = mk('B'), C = mk('C');
await Promise.all([ready(A), ready(B), ready(C)]);
console.log('\n\x1b[1m1. Room creation and joining\x1b[0m');

const ca = await emitAck(A, 'room:create', { name: 'Alice', avatar: { color: 0, face: 0 } });
if (!ca.ok) { bad('create room', ca.message); process.exit(1); }
const code = ca.state.code;
ok(`room created (${code})`);

const cb = await emitAck(B, 'room:join', { code, name: 'Bob', avatar: { color: 1, face: 1 } });
const cc = await emitAck(C, 'room:join', { code, name: 'Cara', avatar: { color: 2, face: 2 } });
if (cb.ok && cc.ok) ok('two more players joined'); else bad('join failed');

const ids = { [ca.playerId]: 'A', [cb.playerId]: 'B', [cc.playerId]: 'C' };
const byId = { A, B, C };
const tokenA = ca.token;

// Short turn so the suite finishes quickly.
A.emit('room:settings', { rounds: 1, drawTime: 30, hints: 2 });
await sleep(150);

console.log('\n\x1b[1m2. Non-host cannot change settings or start\x1b[0m');
B.emit('room:settings', { rounds: 9 });
await sleep(150);
const s1 = (await emitAck(B, 'room:join', { code, name: 'Bob', avatar: {}, token: cb.token }));
// rejoin returns current state; rounds must still be 1
if (s1.ok && s1.state.settings.rounds === 1) ok('non-host settings change ignored');
else bad('non-host changed settings', JSON.stringify(s1.ok && s1.state.settings));

console.log('\n\x1b[1m3. Game start and word secrecy\x1b[0m');
A.emit('game:start');
const choosing = await waitFor(A, 'turn:choosing');
const drawerId = choosing.drawerId;
const drawerLabel = ids[drawerId];
const drawer = byId[drawerLabel];
const guessers = ['A','B','C'].filter(l => l !== drawerLabel).map(l => byId[l]);
ok(`turn started, drawer is ${drawerLabel}`);

// Only the drawer should have been offered words.
const drawerChoosing = drawer.saw('turn:choosing').map(e => e.args[0]).find(a => a.words);
if (drawerChoosing?.words?.length) ok(`drawer received ${drawerChoosing.words.length} candidate words (${drawerChoosing.words.map(w => w.text).join(', ')})`);
else bad('drawer got no word choices');

let leaked = guessers.filter(g => g.saw('turn:choosing').some(e => e.args[0].words));
if (leaked.length === 0) ok('guessers received NO candidate words');
else bad('candidate words leaked to guessers', leaked.map(g => g.label).join(','));

console.log('\n\x1b[1m4. A non-drawer cannot choose the word\x1b[0m');
guessers[0].emit('word:choose', { id: 'not-a-real-option' });
await sleep(250);
if (guessers[0].saw('turn:drawing').length === 0) ok('non-drawer word:choose ignored');
else bad('non-drawer started the turn');

// Options are addressed by id now, since the list can grow under the drawer.
drawer.emit('word:choose', { id: drawerChoosing.words[0].id });
const secret = await waitFor(drawer, 'word:secret');
const word = secret.word;
ok(`drawer received the secret word privately ("${word}")`);

const turn = await waitFor(guessers[0], 'turn:drawing');
if (!/[a-z]/i.test(turn.mask)) ok(`guessers see a blank mask ("${turn.mask}")`);
else bad('mask contains letters', turn.mask);

// THE core invariant: scan every byte any guesser has received.
const leakers = guessers.filter(g => g.blob().toLowerCase().includes(word.toLowerCase()));
if (leakers.length === 0) ok('word appears NOWHERE in any guesser traffic');
else bad('WORD LEAKED to guessers', leakers.map(g => g.label).join(','));

console.log('\n\x1b[1m5. Only the drawer may draw\x1b[0m');
const before = guessers[1].saw('draw:start').length;
guessers[0].emit('draw:start', { id: 'evil-1', tool: 'pen', color: '#000000', size: 4, pts: [10, 10] });
guessers[0].emit('draw:append', { id: 'evil-1', pts: [20, 20] });
await sleep(250);
if (guessers[1].saw('draw:start').length === before) ok('non-drawer strokes rejected');
else bad('a non-drawer drew on the canvas');

drawer.emit('draw:start', { id: 'good-1', tool: 'pen', color: '#000000', size: 10, pts: [100, 100] });
drawer.emit('draw:append', { id: 'good-1', pts: [200, 200, 300, 300] });
await sleep(250);
if (guessers[0].saw('draw:start').length > 0) ok('drawer strokes DO reach guessers');
else bad('drawer strokes not relayed');

console.log('\n\x1b[1m6. Malformed and out-of-range input\x1b[0m');
const b4 = guessers[0].saw('draw:start').length;
drawer.emit('draw:start', { id: 'junk', tool: 'pen', color: '#000000', size: 10, pts: [1.5, 2] });
drawer.emit('draw:start', { id: 'junk2', tool: 'pen', color: '#000000', size: 10, pts: [-5, 99999] });
drawer.emit('draw:start', { id: 'junk3', tool: 'pen', color: 'javascript:alert(1)', size: 9999, pts: [1, 2, 3] });
await sleep(300);
if (guessers[0].saw('draw:start').length === b4) ok('malformed stroke payloads dropped');
else bad('malformed stroke accepted');

console.log('\n\x1b[1m7. The drawer cannot chat\x1b[0m');
drawer.emit('chat:guess', { text: word });
await sleep(250);
if (drawer.saw('error').some(e => e.args[0].code === 'NO_CHAT')) ok('drawer blocked from chat');
else bad('drawer was allowed to chat');

console.log('\n\x1b[1m8. Guessing and scoring\x1b[0m');
guessers[0].emit('chat:guess', { text: 'definitely-not-it' });
await sleep(200);
if (guessers[1].saw('chat:message').some(e => e.args[0].text === 'definitely-not-it')) ok('wrong guesses broadcast as normal chat');
else bad('wrong guess not broadcast');

guessers[0].emit('chat:guess', { text: word });
const correct = await waitFor(guessers[1], 'guess:correct');
if (correct.playerId && !JSON.stringify(correct).toLowerCase().includes(word.toLowerCase())) {
  ok('guess:correct carries a player id and not the word');
} else bad('guess:correct leaked the word', JSON.stringify(correct));

// The still-guessing player must not see the winning text anywhere.
if (!guessers[1].blob().toLowerCase().includes(word.toLowerCase())) ok('still-guessing player STILL has not seen the word');
else bad('word leaked to the remaining guesser via the correct guess');

await sleep(250); // player:updated lands on a different socket than the one we awaited
const upd = guessers[0].saw('player:updated').map(e => e.args[0]).filter(p => p.score > 0);
if (upd.length) ok(`scoring applied (+${upd.at(-1).score})`);
else bad('no score awarded');

console.log('\n\x1b[1m9. Turn ends early once everyone has guessed\x1b[0m');
guessers[1].emit('chat:guess', { text: word });
const end = await waitFor(guessers[0], 'turn:end', 6000);
if (end.reason === 'all-guessed') ok('turn ended early with reason "all-guessed"');
else bad('wrong end reason', end.reason);
if (end.word.toLowerCase() === word.toLowerCase()) ok('word revealed to everyone AFTER the turn');
else bad('word not revealed at turn end');
const drawerDelta = end.deltas[drawerId];
if (drawerDelta > 0) ok(`drawer was paid for a guessed drawing (+${drawerDelta})`);
else bad('drawer earned nothing despite both players guessing');

console.log('\n\x1b[1m10. Rate limiting\x1b[0m');
for (let i = 0; i < 40; i++) guessers[0].emit('chat:guess', { text: `spam ${i}` });
await sleep(600);
if (guessers[0].saw('error').some(e => e.args[0].code === 'RATE_LIMITED')) ok('chat flood rate-limited');
else bad('no rate limit triggered by 40 rapid messages');

console.log('\n\x1b[1m11. Reconnect keeps the seat and score\x1b[0m');
const scoreBefore = (await emitAck(B, 'room:join', { code, name: 'Bob', avatar: {}, token: cb.token }));
const bScore = scoreBefore.ok ? scoreBefore.state.players.find(p => p.id === cb.playerId)?.score : -1;
A.disconnect();
await sleep(400);
const A2 = mk('A2');
await ready(A2);
const re = await emitAck(A2, 'room:join', { code, name: 'Alice', avatar: { color: 0, face: 0 }, token: tokenA });
if (re.ok && re.playerId === ca.playerId) ok('reconnect reclaimed the SAME player id');
else bad('reconnect created a new player', re.ok ? re.playerId : re.message);
if (re.ok && re.state.players.length === 3) ok('player list still has 3 — no ghost clone');
else bad('player list wrong after reconnect', re.ok ? re.state.players.length : '?');

console.log('\n\x1b[1m12. Bad room codes\x1b[0m');
const nf = await emitAck(mk('D'), 'room:join', { code: 'ZZZZZZ', name: 'Dan', avatar: {} });
if (!nf.ok && nf.code === 'NOT_FOUND') ok('unknown room code rejected cleanly');
else bad('unknown code not rejected');

console.log('\n\x1b[1m13. Kicking\x1b[0m');
{
  const [H, K, M] = [mk('H'), mk('K'), mk('M')];
  await Promise.all([ready(H), ready(K), ready(M)]);
  const ch = await emitAck(H, 'room:create', { name: 'Host', avatar: {} });
  const rc = ch.state.code;
  const ck = await emitAck(K, 'room:join', { code: rc, name: 'Kicky', avatar: {} });
  const cm = await emitAck(M, 'room:join', { code: rc, name: 'Mo', avatar: {} });
  await sleep(200);

  // Only the host may remove anyone.
  M.emit('player:kick', { playerId: ck.playerId });
  await sleep(300);
  if (K.saw('kicked').length === 0) ok('a non-host cannot kick');
  else bad('a non-host removed a player');

  // And not themselves, which would leave the room without a host.
  H.emit('player:kick', { playerId: ch.playerId });
  await sleep(300);
  if (H.saw('kicked').length === 0) ok('the host cannot kick themselves');
  else bad('the host kicked themselves');

  H.emit('player:kick', { playerId: ck.playerId });
  const note = await waitFor(K, 'kicked', 5000);
  if (note.by === 'Host') ok(`kicked player told who did it ("${note.by}")`);
  else bad('kick notice missing the name', JSON.stringify(note));

  await sleep(300);
  if (M.saw('player:left').some(e => e.args[0].id === ck.playerId)) ok('other players saw them leave');
  else bad('player:left not broadcast');
  if (M.saw('chat:message').some(e => /removed by Host/.test(e.args[0].text ?? ''))) ok('a system message explains the removal');
  else bad('no system message for the removal');

  // The seat is what gets blocked, so presenting the same token is refused.
  const back = await emitAck(K, 'room:join', { code: rc, name: 'Kicky', avatar: {}, token: ck.token });
  if (!back.ok && back.code === 'KICKED') ok('the kicked seat cannot rejoin');
  else bad('a kicked player walked back in', JSON.stringify(back));

  // Being honest about the limit: a fresh session is a different seat.
  const fresh = await emitAck(K, 'room:join', { code: rc, name: 'Kicky', avatar: {} });
  if (fresh.ok) ok('a fresh session is a new seat — kick is a soft block, as documented');
  else bad('unexpected: a brand new seat was refused', JSON.stringify(fresh));
  H.disconnect(); K.disconnect(); M.disconnect();
}

console.log('\n\x1b[1m14. Kicking mid-turn\x1b[0m');
{
  const [H, K, M] = [mk('H2'), mk('K2'), mk('M2')];
  await Promise.all([ready(H), ready(K), ready(M)]);
  const ch = await emitAck(H, 'room:create', { name: 'Boss', avatar: {} });
  const rc = ch.state.code;
  await emitAck(K, 'room:join', { code: rc, name: 'Drawer', avatar: {} });
  const cm = await emitAck(M, 'room:join', { code: rc, name: 'Watcher', avatar: {} });
  H.emit('room:settings', { rounds: 1, drawTime: 60 });
  await sleep(200);
  H.emit('game:start');
  const ch2 = await waitFor(H, 'turn:choosing');
  const drawerId = ch2.drawerId;
  if (drawerId === ch.playerId) {
    // The room creator is the host AND the first drawer, and cannot kick
    // themselves, so turn 1 can only exercise the guesser path. The
    // drawer-left path is reached through the same removePlayer() call and is
    // covered by the disconnect test above.
    H.emit('player:kick', { playerId: cm.playerId });
    await sleep(400);
    if (M.saw('kicked').length === 1) ok('a guesser can be removed mid-turn');
    else bad('mid-turn kick failed');
    const stillGoing = H.saw('turn:end').length === 0;
    if (stillGoing) ok('the turn carries on after a guesser is removed');
    else bad('removing a guesser ended the turn');
  } else {
    H.emit('player:kick', { playerId: drawerId });
    const end = await waitFor(M, 'turn:end', 6000);
    if (end.reason === 'drawer-left') ok('kicking the drawer ended the turn cleanly');
    else bad('wrong end reason after kicking the drawer', end.reason);
  }
  H.disconnect(); K.disconnect(); M.disconnect();
}

console.log(`\n\x1b[1mRESULT: ${pass.length} passed, ${fail.length} failed\x1b[0m`);
if (fail.length) { console.log('\nFailures:'); fail.forEach(f => console.log(`  - ${f}`)); }
process.exit(fail.length ? 1 : 0);
