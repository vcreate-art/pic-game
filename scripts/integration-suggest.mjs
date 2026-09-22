import { io } from 'socket.io-client';

const URL = process.env.PIC_GAME_URL ?? 'http://localhost:3001';
const pass = [], fail = [];
const ok = (m) => { pass.push(m); console.log(`  \x1b[32mPASS\x1b[0m ${m}`); };
const bad = (m, d = '') => { fail.push(m); console.log(`  \x1b[31mFAIL\x1b[0m ${m}${d ? ` — ${d}` : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/** Mirrors SUGGEST_SECONDS, plus slack. */
const SUGGEST_BACKSTOP_MS = 32_000;

function mk(label) {
  const s = io(URL, { transports: ['websocket'] });
  const log = [];
  s.onAny((ev, ...args) => log.push({ ev, args }));
  s.label = label; s.log = log;
  s.saw = (ev) => log.filter(e => e.ev === ev);
  s.blob = () => JSON.stringify(log);
  return s;
}
const ready = (s) => new Promise(r => s.on('connect', r));
const emitAck = (s, ev, p) => new Promise(r => s.emit(ev, p, r));
/** Polls a getter until it returns something truthy, or gives up. */
const pollFor = async (get, ms = 30000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = get();
    if (v) return v;
    await sleep(250);
  }
  return null;
};
const waitFor = (s, ev, ms = 9000) => new Promise((res, rej) => {
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

const A = mk('A'), B = mk('B'), C = mk('C'), D = mk('D');
await Promise.all([ready(A), ready(B), ready(C), ready(D)]);

console.log('\n\x1b[1m1. Room in player-suggested mode\x1b[0m');
const ca = await emitAck(A, 'room:create', { name: 'Alice', avatar: {} });
const code = ca.state.code;
const cb = await emitAck(B, 'room:join', { code, name: 'Bob', avatar: {} });
const cc = await emitAck(C, 'room:join', { code, name: 'Cara', avatar: {} });
const cd = await emitAck(D, 'room:join', { code, name: 'Dan', avatar: {} });
A.emit('room:settings', { wordMode: 'players', rounds: 1, drawTime: 30, hints: 0 });
await sleep(250);
const check = await emitAck(B, 'room:join', { code, name: 'Bob', avatar: {}, token: cb.token });
if (check.ok && check.state.settings.wordMode === 'players') ok('room switched to player-suggested words');
else bad('wordMode not applied', JSON.stringify(check.ok && check.state.settings));

console.log('\n\x1b[1m2. Suggestion window opens\x1b[0m');
A.emit('game:start');
const choosing = await waitFor(A, 'turn:choosing');
const drawerId = choosing.drawerId;
const ids = { [ca.playerId]: 'A', [cb.playerId]: 'B', [cc.playerId]: 'C', [cd.playerId]: 'D' };
if (ids[drawerId] !== 'A') { bad(`expected A to draw, got ${ids[drawerId]}`); process.exit(1); }
ok('turn started, A is the drawer');

const st = await waitFor(B, 'suggest:state');
if (st.open === true) ok('suggestion window is open for non-drawers');
else bad('suggest:state not open');

console.log('\n\x1b[1m3. The drawer cannot suggest\x1b[0m');
const drawerTry = await emitAck(A, 'word:suggest', { text: 'cheating' });
if (!drawerTry.ok) ok(`drawer refused: "${drawerTry.message}"`);
else bad('the drawer was allowed to suggest a word');

console.log('\n\x1b[1m4. Input validation\x1b[0m');
for (const [text, why] of [['ab', 'too short'], ['h3llo', 'digits'], ['x'.repeat(30), 'too long'], ['<script>', 'punctuation']]) {
  const r = await emitAck(B, 'word:suggest', { text });
  if (!r.ok) ok(`rejected ${why}`); else bad(`accepted ${why}`, text);
}

console.log('\n\x1b[1m5. Suggestions are accepted and deduplicated\x1b[0m');
const sb = await emitAck(B, 'word:suggest', { text: 'lighthouse' });
if (sb.ok && sb.text === 'lighthouse') ok('B suggested "lighthouse"'); else bad('B suggestion rejected');
const dup = await emitAck(C, 'word:suggest', { text: 'LIGHT HOUSE' });
if (!dup.ok) ok('duplicate refused across case and spacing'); else bad('duplicate accepted');
const sc = await emitAck(C, 'word:suggest', { text: 'trombone' });
if (sc.ok) ok('C suggested "trombone"'); else bad('C suggestion rejected');
await sleep(350);

console.log('\n\x1b[1m5b. The drawer waits until everyone is in\x1b[0m');
if (A.saw('turn:choosing').every(e => !e.args[0].words)) ok('drawer shown NO options while a player is still writing');
else bad('drawer was handed the list early');
const mid = A.saw('suggest:state').at(-1).args[0];
if (mid.ready === false && mid.count === 2 && mid.expected === 3) ok(`progress reported as ${mid.count}/${mid.expected}, not ready`);
else bad('suggest:state wrong mid-window', JSON.stringify(mid));

const sd = await emitAck(D, 'word:suggest', { text: 'windmill' });
if (sd.ok) ok('D completed the set'); else bad('D suggestion rejected');
await sleep(400);
const readyState = A.saw('suggest:state').at(-1).args[0];
if (readyState.ready === true && readyState.open === false) ok('window closed the moment the last word landed');
else bad('window stayed open after everyone suggested', JSON.stringify(readyState));

const late = await emitAck(B, 'word:suggest', { text: 'afterthought' });
if (!late.ok) ok('suggestions refused once the drawer is picking'); else bad('accepted a late suggestion');

console.log('\n\x1b[1m6. Suggestions reach the drawer ONLY\x1b[0m');
const opts = A.saw('turn:choosing').map(e => e.args[0]).filter(a => a.words).at(-1);
const texts = (opts?.words ?? []).map(w => w.text);
if (['lighthouse', 'trombone', 'windmill'].every(w => texts.includes(w))) ok(`drawer sees all 3 suggestions (${texts.join(', ')})`);
else bad('drawer missing suggestions', texts.join(','));

const leaked = [B, C, D].filter(g => /lighthouse|trombone|windmill/i.test(g.blob().replace(/"(lighthouse|trombone|windmill)"/g, (m, w) => {
  // A player's OWN word comes back in their ack; that is not a leak.
  return ({ B: 'lighthouse', C: 'trombone', D: 'windmill' })[g.label] === w ? '' : m;
})));
if (leaked.length === 0) ok("no player sees another player's suggestion");
else bad('suggestions leaked between players', leaked.map(g => g.label).join(','));

if ((opts?.words ?? []).every(w => Object.keys(w).sort().join(',') === 'id,text')) ok('options carry id and text only — no authorship');
else bad('option objects carry extra fields', JSON.stringify(opts?.words?.[0]));

console.log('\n\x1b[1m7. A non-drawer cannot pick\x1b[0m');
const target = opts.words.find(w => w.text === 'lighthouse');
C.emit('word:choose', { id: target.id });
await sleep(300);
if (C.saw('turn:drawing').length === 0) ok('non-drawer word:choose ignored');
else bad('a non-drawer started the turn');

console.log('\n\x1b[1m8. Drawer picks B\'s word\x1b[0m');
A.emit('word:choose', { id: target.id });
const secret = await waitFor(A, 'word:secret');
if (secret.word === 'lighthouse') ok('drawer received the chosen suggestion privately');
else bad('wrong secret', secret.word);
const turn = await waitFor(C, 'turn:drawing');
if (!/[a-z]/i.test(turn.mask)) ok(`guessers see a blank mask ("${turn.mask}")`);
else bad('mask leaked letters', turn.mask);

console.log('\n\x1b[1m9. The author cannot score their own word\x1b[0m');
const beforeCorrect = C.saw('guess:correct').length;
B.emit('chat:guess', { text: 'lighthouse' });
await sleep(400);
if (B.saw('guess:correct').filter(e => e.args[0].playerId === cb.playerId).length === 0) ok('author got no credit for their own word');
else bad('author scored on their own word');
if (C.saw('guess:correct').length === beforeCorrect) ok('author\'s attempt did not register as a guess');
else bad('author registered as a guesser');

// The crucial one: the default chat path would broadcast an unrecognised guess
// verbatim, printing the answer to everyone still playing.
const cBlob = C.blob().toLowerCase();
if (!cBlob.includes('lighthouse')) ok('author\'s attempt was NOT broadcast — word still hidden from C');
else bad('WORD LEAKED to C via the author\'s chat message');

console.log('\n\x1b[1m10. Turn ends when the eligible guessers are done\x1b[0m');
C.emit('chat:guess', { text: 'lighthouse' });
await sleep(300);
D.emit('chat:guess', { text: 'lighthouse' });
const end = await waitFor(C, 'turn:end', 8000);
if (end.reason === 'all-guessed') ok('early end fired with the author excluded from the count');
else bad('turn did not end early', end.reason);

console.log('\n\x1b[1m11. Authorship revealed, and paid\x1b[0m');
if (end.authorId === cb.playerId) ok('turn:end names B as the author');
else bad('authorId wrong or missing', String(end.authorId));
if ((end.deltas[cb.playerId] ?? 0) > 0) ok(`author earned ${end.deltas[cb.playerId]} for a word others solved`);
else bad('author earned nothing despite both guessers solving it');
if ((end.deltas[ca.playerId] ?? 0) > 0) ok(`drawer still paid normally (+${end.deltas[ca.playerId]})`);
else bad('drawer earned nothing');

console.log('\n\x1b[1m12. A dropout stops the room waiting\x1b[0m');
{
  const [P, Q, R] = [mk('P'), mk('Q'), mk('R')];
  await Promise.all([ready(P), ready(Q), ready(R)]);
  const cp = await emitAck(P, 'room:create', { name: 'Pat', avatar: {} });
  const rc = cp.state.code;
  await emitAck(Q, 'room:join', { code: rc, name: 'Quinn', avatar: {} });
  await emitAck(R, 'room:join', { code: rc, name: 'Rae', avatar: {} });
  P.emit('room:settings', { wordMode: 'players', rounds: 1, drawTime: 30 });
  await sleep(200);
  P.emit('game:start');
  await waitFor(P, 'turn:choosing');
  await sleep(300);

  await emitAck(Q, 'word:suggest', { text: 'porcupine' });
  await sleep(300);
  if (P.saw('turn:choosing').every(e => !e.args[0].words)) ok('still waiting on R');
  else bad('opened picking before R suggested');

  // R walks away without ever suggesting.
  R.disconnect();
  await sleep(700);
  const opts = P.saw('turn:choosing').map(e => e.args[0]).filter(a => a.words).at(-1);
  if (opts) ok('dropout stopped the wait — drawer got the list without the backstop');
  else bad('room kept waiting on a disconnected player');
  const st = P.saw('suggest:state').at(-1).args[0];
  if (st.expected === 1) ok('the departed player is no longer counted as expected');
  else bad('expected count still includes the dropout', JSON.stringify(st));
  P.disconnect(); Q.disconnect();
}

console.log('\n\x1b[1m13. Auto-pick prefers a real suggestion over padding\x1b[0m');
{
  const [G, H] = [mk('G'), mk('H')];
  await Promise.all([ready(G), ready(H)]);
  const cg = await emitAck(G, 'room:create', { name: 'Gus', avatar: {} });
  const rc = cg.state.code;
  await emitAck(H, 'room:join', { code: rc, name: 'Hana', avatar: {} });
  // drawTime short; the suggest window itself is fixed at 20s server-side.
  G.emit('room:settings', { wordMode: 'players', rounds: 1, drawTime: 30 });
  await sleep(200);
  G.emit('game:start');
  await waitFor(G, 'turn:choosing');
  await sleep(300);
  // One suggestion against two padded slots: a uniform pick would take the
  // player's word only a third of the time.
  const sug = await emitAck(H, 'word:suggest', { text: 'kaleidoscope' });
  if (!sug.ok) bad('suggestion rejected in auto-pick test', sug.message);
  const secret = await waitFor(G, 'word:secret', 30000);
  if (secret.word === 'kaleidoscope') ok('auto-pick took the suggestion, not the padding');
  else bad('auto-pick discarded the only suggestion', secret.word);
  G.disconnect(); H.disconnect();
}

console.log('\n\x1b[1m14. Built-in top-up when nobody suggests\x1b[0m');
const E = mk('E'), F = mk('F');
await Promise.all([ready(E), ready(F)]);
const ce = await emitAck(E, 'room:create', { name: 'Eve', avatar: {} });
const code2 = ce.state.code;
await emitAck(F, 'room:join', { code: code2, name: 'Fay', avatar: {} });
E.emit('room:settings', { wordMode: 'players', rounds: 1, drawTime: 30 });
await sleep(200);
E.emit('game:start');
await waitFor(E, 'turn:choosing');
// F is connected but silent, so the room has to sit out the full backstop
// before it gives up waiting — which is the point of the gate.
const early = E.saw('turn:choosing').filter(e => e.args[0].words);
if (early.length === 0) ok('drawer still waiting while a connected player stays silent');
else bad('drawer was handed the list before the backstop expired');

const opts2 = await pollFor(
  () => E.saw('turn:choosing').map(e => e.args[0]).filter(a => a.words).at(-1),
  SUGGEST_BACKSTOP_MS,
);
if ((opts2?.words?.length ?? 0) >= 3) ok(`backstop expired: drawer offered ${opts2.words.length} built-in words`);
else bad('no fallback options after the backstop', JSON.stringify(opts2?.words));

E.emit('word:choose', { id: opts2.words[0].id });
const secret2 = await waitFor(E, 'word:secret', 6000);
if (secret2.word) ok(`a built-in word starts the turn normally ("${secret2.word}")`);
else bad('built-in pick failed');

const turn2 = await waitFor(F, 'turn:drawing', 5000).catch(() => null);
if (turn2) ok('turn proceeds for the other player');
else bad('turn did not start on a built-in word');

// No suggestion means no author, so nobody should be paid an author bonus.
F.emit('chat:guess', { text: secret2.word });
const end2 = await waitFor(F, 'turn:end', 8000);
if (end2.authorId === undefined) ok('a built-in word carries no author');
else bad('built-in word reported an author', String(end2.authorId));

console.log(`\n\x1b[1mRESULT: ${pass.length} passed, ${fail.length} failed\x1b[0m`);
if (fail.length) { console.log('\nFailures:'); fail.forEach(f => console.log(`  - ${f}`)); }
process.exit(fail.length ? 1 : 0);
