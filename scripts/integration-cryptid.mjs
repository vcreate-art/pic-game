// Run with tsx, which resolves the shared package's TypeScript source:
//   CRYPTID_AWAY_MS=1500 npx tsx apps/server/src/index.ts
//   npx tsx scripts/integration-cryptid.mjs
import { io } from 'socket.io-client';
import { HEXES, clueAllows, clueKey } from '../packages/shared/src/index.ts';

const URL = process.env.PIC_GAME_URL ?? 'http://localhost:3001';
const pass = [], fail = [];
const ok = (m) => { pass.push(m); console.log(`  \x1b[32mPASS\x1b[0m ${m}`); };
const bad = (m, d = '') => { fail.push(m); console.log(`  \x1b[31mFAIL\x1b[0m ${m}${d ? ` — ${d}` : ''}`); };
const check = (cond, m, d) => (cond ? ok(m) : bad(m, d));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** The latest room broadcast, from whichever socket got it: any one of them
 *  may be the player who disconnects or leaves partway through. */
let latest = null;
const scores = {};

function mk(label) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const log = [];
  s.onAny((ev, ...args) => log.push({ ev, args }));
  s.on('cryptid:state', (g) => (latest = g));
  s.on('player:updated', (p) => (scores[p.id] = p.score));
  s.label = label;
  s.saw = (ev) => log.filter(e => e.ev === ev);
  s.last = (ev) => s.saw(ev).at(-1)?.args[0];
  s.errors = () => s.saw('error').map(e => e.args[0].message);
  s.clear = () => (log.length = 0);
  return s;
}
const ready = (s) => new Promise(r => (s.connected ? r() : s.on('connect', r)));
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

const A = mk('A'), B = mk('B'), C = mk('C'), D = mk('D');
let all = [A, B, C, D];
await Promise.all(all.map(ready));

console.log('\n\x1b[1m1. A Cryptid room\x1b[0m');
const c = await emitAck(A, 'room:create', { name: 'Ann', avatar: {}, game: 'cryptid' });
if (c.ok && c.state.kind === 'cryptid' && c.state.game.phase === 'lobby') ok(`room created (${c.state.code})`);
else { bad('not a cryptid room', JSON.stringify(c)); process.exit(1); }
const code = c.state.code;
const ids = { A: c.playerId };
const tokens = { A: c.token };

A.emit('game:start');
await sleep(200);
check(A.errors().some((e) => /at least 3/.test(e)), 'needs three players');

for (const [s, n] of [[B, 'Bo'], [C, 'Cy'], [D, 'Di']]) {
  const r = await emitAck(s, 'room:join', { code, name: n, avatar: {} });
  ids[s.label] = r.playerId;
  tokens[s.label] = r.token;
}
const sock = Object.fromEntries(all.map((s) => [ids[s.label], s]));

console.log('\n\x1b[1m2. Settings\x1b[0m');
B.emit('cryptid:settings', { advanced: true });
await sleep(150);
check(A.last('cryptid:state')?.settings.advanced !== true, 'only the host changes settings');
A.emit('cryptid:settings', { advanced: true });
await sleep(150);
check(B.last('cryptid:state')?.settings.advanced === true, 'the host turns on the advanced game');
A.emit('cryptid:settings', { setupCubes: false });
await sleep(150);
check(B.last('cryptid:state')?.settings.setupCubes === false, 'setup cubes can be switched off');
A.emit('cryptid:settings', { setupCubes: true });
await sleep(150);

console.log('\n\x1b[1m3. Dealing\x1b[0m');
A.emit('game:start');
await sleep(300);
let st = B.last('cryptid:state');
check(st.phase === 'setup' && st.players.length === 4 && st.setupLeft === 8, 'four players, two setup cubes each', JSON.stringify({ phase: st.phase, n: st.players.length, left: st.setupLeft }));
check(st.board && st.board.structures.length === 8, 'an advanced map has eight structures');
check(Object.keys(st.openClues).length === 0 && st.answer === null, 'no clue or answer in the public state');
check(!JSON.stringify(st).includes('"kind":"terrains"') && !JSON.stringify(st).includes('"not":'), 'nothing clue-shaped leaks into it');
const clues = {};
for (const s of all) clues[ids[s.label]] = s.last('cryptid:clue')?.clue;
check(all.every((s) => clues[ids[s.label]]), 'each player gets their own clue');
check(new Set(Object.values(clues).map(clueKey)).size === 4, 'four different clues');
const board = st.board;
const answer = [...Array(HEXES).keys()].filter((h) => Object.values(clues).every((cl) => clueAllows(board, cl, h)));
check(answer.length === 1, 'together the clues allow exactly one space', `${answer.length}`);
const [ANSWER] = answer;

const allows = (id, h) => clueAllows(board, clues[id], h);
const state = () => latest;
const cubeSpace = (id) => {
  const s = state();
  return [...Array(HEXES).keys()].find((h) => s.cubes[h] === null && (s.phase !== 'setup' || !s.disks[h].length) && !allows(id, h) && h !== ANSWER);
};

console.log('\n\x1b[1m4. Setup\x1b[0m');
let turn = st.turn;
const notTurn = st.players.find((id) => id !== turn);
sock[notTurn].emit('cryptid:cube', { hex: cubeSpace(notTurn) });
await sleep(150);
check(sock[notTurn].errors().some((e) => /not your turn/.test(e)), 'only the player to move puts down a cube');
const yesHex = [...Array(HEXES).keys()].find((h) => allows(turn, h));
sock[turn].emit('cryptid:cube', { hex: yesHex });
await sleep(150);
check(sock[turn].errors().some((e) => /Your clue allows/.test(e)), 'a cube where your clue allows the creature is refused');
for (let i = 0; i < 8; i++) {
  const t = state().turn;
  sock[t].emit('cryptid:cube', { hex: cubeSpace(t) });
  await sleep(120);
}
st = state();
check(st.phase === 'turn' && st.cubes.filter(Boolean).length === 8 && st.setupLeft === 0, 'eight setup cubes, then the first turn', `${st.phase} ${st.cubes.filter(Boolean).length}`);
check(st.turn === st.players[0], 'the first player takes the first turn');

console.log('\n\x1b[1m5. Questions\x1b[0m');
turn = st.turn;
let target = st.players.find((id) => id !== turn);
const yesQ = [...Array(HEXES).keys()].find((h) => st.cubes[h] === null && allows(target, h) && h !== ANSWER);
sock[turn].emit('cryptid:question', { target, hex: yesQ });
await sleep(150);
st = state();
check(st.disks[yesQ].includes(target) && st.phase === 'turn' && st.turn !== turn, 'a yes puts their disk down and passes the turn');
let q = st.log.at(-1);
check(q.kind === 'question' && q.yes === true && q.target === target, 'the history records the answer');

turn = st.turn;
target = st.players.find((id) => id !== turn);
const noQ = [...Array(HEXES).keys()].find((h) => st.cubes[h] === null && !allows(target, h));
sock[turn].emit('cryptid:question', { target, hex: noQ });
await sleep(150);
st = state();
check(st.cubes[noQ] === target && st.phase === 'penalty' && st.turn === turn, 'a no is their cube, and the asker owes one');
sock[turn].emit('cryptid:question', { target, hex: yesQ });
await sleep(120);
check(state().phase === 'penalty', 'no questions while a cube is owed');
sock[turn].emit('cryptid:cube', { hex: cubeSpace(turn) });
await sleep(150);
st = state();
check(st.phase === 'turn' && st.turn !== turn, 'the penalty cube ends the turn');

console.log('\n\x1b[1m6. A search that fails\x1b[0m');
turn = st.turn;
const ruledOut = [...Array(HEXES).keys()].find((h) => st.cubes[h] === null && !allows(turn, h));
sock[turn].emit('cryptid:search', { hex: ruledOut });
await sleep(150);
check(sock[turn].errors().some((e) => /own clue/.test(e)), 'you cannot search where your own clue rules it out');
const wrong = [...Array(HEXES).keys()].find((h) => state().cubes[h] === null && allows(turn, h) && h !== ANSWER);
sock[turn].emit('cryptid:search', { hex: wrong });
await sleep(150);
st = state();
const srch = st.log.at(-1);
check(srch?.kind === 'search' && !srch.found && srch.answers.at(-1)?.yes === false && st.cubes[wrong] === srch.answers.at(-1)?.id,
  'a wrong search stops at the first no, which puts down a cube');
check(!!srch?.answers?.every((a, i) => i === srch.answers.length - 1 || a.yes), 'everyone before that said yes');
check(st.phase === 'penalty', 'and the searcher owes a cube');
sock[turn].emit('cryptid:cube', { hex: cubeSpace(turn) });
await sleep(150);

console.log('\n\x1b[1m7. Watchers\x1b[0m');
const E = mk('E');
await ready(E);
{
  const r = await emitAck(E, 'room:join', { code, name: 'Eve', avatar: {} });
  ids.E = r.playerId;
  tokens.E = r.token;
}
await sleep(150);
check(E.last('cryptid:clue') === undefined || E.last('cryptid:clue').clue === null, 'a late arrival gets no clue');
E.emit('cryptid:search', { hex: ANSWER });
await sleep(120);
check(state().phase !== 'ended', 'and cannot play');

console.log('\n\x1b[1m8. Away\x1b[0m');
st = state();
turn = st.turn;
const awayLabel = sock[turn].label;
sock[turn].disconnect();
await sleep(2200);
st = state();
check(st.log.at(-1)?.kind === 'skip' && st.log.at(-1)?.by === turn && st.turn !== turn, 'a player who is away has their turn passed');
const back = mk(awayLabel);
await ready(back);
const r = await emitAck(back, 'room:join', { code, name: 'Back', avatar: {}, token: tokens[awayLabel] });
await sleep(150);
check(r.ok && r.playerId === turn && clueKey(back.last('cryptid:clue')?.clue ?? {}) === clueKey(clues[turn]), 'coming back hands them their clue again');
sock[turn] = back;
all = all.map((s) => (s.label === awayLabel ? back : s));

console.log('\n\x1b[1m9. Leaving mid-game\x1b[0m');
st = state();
const leaver = st.players.find((id) => id !== st.turn && id !== ids.A);
sock[leaver].emit('room:leave');
await sleep(200);
st = state();
check(st.openClues[leaver] && clueKey(st.openClues[leaver]) === clueKey(clues[leaver]), 'their clue goes public, since it still counts');
const nameOf = (id) => ({ [ids.A]: 'Ann', [ids.B]: 'Bo', [ids.C]: 'Cy', [ids.D]: 'Di', [ids.E]: 'Eve' })[id];
check(st.phase !== 'lobby' && st.departed[leaver] === nameOf(leaver),
  'and the game goes on, still knowing them by name', JSON.stringify(st.departed));

console.log('\n\x1b[1m10. Found\x1b[0m');
// Pass turns until someone still here is up, then search the answer.
for (let i = 0; i < 6 && state().phase === 'penalty'; i++) {
  const t = state().turn;
  sock[t].emit('cryptid:cube', { hex: cubeSpace(t) });
  await sleep(120);
}
st = state();
turn = st.turn;
check(st.cubes[ANSWER] === null, 'nobody could ever put a cube on the answer');
sock[turn].emit('cryptid:search', { hex: ANSWER });
await sleep(200);
st = state();
check(st.phase === 'ended' && st.winner === turn && st.answer === ANSWER, 'searching the one space every clue allows wins');
check(Object.keys(st.openClues).length === 4, 'every clue is shown at the end');
check(st.log.at(-1)?.answers?.map((a) => a.id).includes(leaver), 'the player who left still answered the search');
check(scores[turn] === 1, 'the winner scores a find');

console.log('\n\x1b[1m11. Again\x1b[0m');
sock[ids.B].emit('cryptid:rematch');
await sleep(150);
check(state().phase === 'ended', 'only the host starts another');
const oldBoard = JSON.stringify(state().board);
sock[ids.A].emit('cryptid:rematch');
await sleep(300);
st = state();
check(st.phase === 'setup' && JSON.stringify(st.board) !== oldBoard, 'a rematch deals a new map');
check(st.players.length === 4 && st.players.includes(ids.E), 'the watcher is in this one');

console.log('\n\x1b[1m12. Removing a player\x1b[0m');
const sockOf = (id) => (id === ids.E ? E : sock[id]);
const victim = st.players.find((id) => id !== ids.A);
const bystander = st.players.find((id) => id !== ids.A && id !== victim);
sockOf(bystander).emit('player:kick', { playerId: victim });
await sleep(150);
check(!state().departed[victim], 'only the host can remove someone');
sock[ids.A].emit('player:kick', { playerId: ids.A });
await sleep(120);
check(state().players.includes(ids.A) && !state().departed[ids.A], 'the host cannot remove themselves');
const victimSock = sockOf(victim);
const victimLabel = victimSock.label;
sock[ids.A].emit('player:kick', { playerId: victim });
await sleep(200);
st = state();
check(victimSock.saw('kicked').length === 1, 'the removed player is told');
check(st.departed[victim] === nameOf(victim) && st.openClues[victim], 'mid-game, their clue goes public like a leaver', JSON.stringify(st.departed));
check(st.phase === 'setup' && st.turn !== victim, 'and play carries on without them');
const again = await emitAck(mk('again'), 'room:join', { code, name: 'Sneaky', avatar: {}, token: tokens[victimLabel] });
check(!again.ok && again.code === 'KICKED', 'and cannot come back on the same seat', JSON.stringify(again));

console.log('\n\x1b[1m13. Too few left\x1b[0m');
const leavers = st.players.filter((id) => id !== ids.A && id !== victim);
for (const id of leavers) {
  sockOf(id).emit('room:leave');
  await sleep(120);
}
check(state().phase === 'lobby', 'with one player left, back to the lobby');

for (const s of [...all, E, back]) s.disconnect();
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
