import type { CanvasEngine } from '../canvas/engine.js';
import { disposeFightView, getFightView } from '../fight/instance.js';
import { disposeRaceView, getRaceView } from '../race/instance.js';
import { disposeMazeClient, getMazeClient } from '../maze/client.js';
import { useGame } from '../store/game.js';
import { getSocket } from './socket.js';
import { setPausedAt, syncClock } from './clock.js';

/**
 * Wires every server event to either the store or the canvas engine.
 *
 * The split matters: stroke events go straight to the engine and never touch
 * React state, so a fast drawer produces zero re-renders. Only game state
 * (players, phase, scores) flows into the store.
 */
export function bindSocket(engine: CanvasEngine): () => void {
  const socket = getSocket();
  const g = () => useGame.getState();

  const onConnect = () => {
    g().setConnected(true);
    syncClock();
  };
  const onDisconnect = () => g().setConnected(false);

  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);

  socket.on('state:sync', (state) => {
    // The host switched games: nothing the last one drew may carry over.
    const was = g().room?.kind;
    if (was && was !== state.kind) {
      disposeFightView();
      disposeRaceView();
      disposeMazeClient();
      engine.clear();
    }
    setPausedAt(state.meta.paused?.at ?? null);
    g().sync(state);
    // Only the drawing game has a canvas to restore.
    if (state.kind === 'skribbl') engine.replay(state.ops);
    if (state.kind === 'fight' && state.frame) getFightView().pushFrame(state.frame);
  });

  socket.on('player:joined', (p) => g().patchPlayer(p));
  socket.on('player:updated', (p) => g().patchPlayer(p));
  socket.on('player:left', ({ id }) => g().dropPlayer(id));
  socket.on('room:settings', (s) => g().setSettings(s));
  socket.on('host:changed', ({ hostId }) => g().setHost(hostId));
  socket.on('room:meta', (m) => {
    setPausedAt(m.paused?.at ?? null);
    g().setMeta(m);
  });
  socket.on('kicked', ({ by }) => g().setKickedBy(by));
  // The room is the other tab's now: drop it here and say so.
  socket.on('room:replaced', ({ to }) => {
    const code = g().room?.code;
    if (code) g().replacedHere(code, to);
  });

  socket.on('turn:choosing', (p) => {
    g().beginChoosing(p);
    engine.clear();
  });
  socket.on('word:secret', ({ word }) => g().setSecret(word));
  socket.on('turn:clock', ({ endsAt }) => g().setTurnClock(endsAt));
  socket.on('turn:drawing', (turn) => g().beginDrawing(turn));
  socket.on('hint:reveal', ({ index, char }) => g().reveal(index, char));
  socket.on('turn:end', (r) => g().endTurn(r));
  socket.on('game:end', ({ players, gallery }) => g().endGame(players, gallery));
  socket.on('draw:reactions', (r) => g().setReactions(r));

  // --- canvas: engine only, deliberately bypassing React ---
  socket.on('draw:start', (op) => engine.startStroke({ kind: 'stroke', ...op }));
  socket.on('draw:append', ({ id, pts }) => engine.appendStroke(id, pts));
  socket.on('draw:end', ({ id }) => engine.endStroke(id));
  socket.on('draw:replace', ({ id, pts }) => engine.replaceStroke(id, pts));
  socket.on('draw:fill', (op) => engine.applyFill(op));
  socket.on('canvas:undone', ({ ops }) => engine.replay(ops));
  socket.on('canvas:cleared', () => engine.clear());

  // --- kung fu chess ---
  socket.on('chess:state', (game) => g().setChess(game));
  socket.on('chess:moved', (m) => g().applyChessMove(m));
  socket.on('chess:over', ({ winner, reason }) => g().chessOver(winner, reason));
  socket.on('chess:rejected', ({ reason }) => {
    g().setNotice(reason);
    setTimeout(() => {
      if (useGame.getState().notice === reason) useGame.getState().setNotice(null);
    }, 1800);
  });

  // --- star realms ---
  socket.on('realms:state', (game) => g().setRealms(game));
  socket.on('realms:hand', ({ hand, owedDiscards }) => g().setRealmsHand(hand, owedDiscards));
  socket.on('realms:over', ({ winner }) => g().realmsOver(winner));
  socket.on('realms:rejected', ({ reason }) => {
    g().setNotice(reason);
    setTimeout(() => {
      if (useGame.getState().notice === reason) useGame.getState().setNotice(null);
    }, 2200);
  });

  // --- stick kombat: frames and effects go straight to the view, like strokes ---
  socket.on('fight:state', (game) => g().setFight(game));
  socket.on('fight:frame', (f) => getFightView().pushFrame(f));
  socket.on('fight:events', (evs) => getFightView().pushEvents(evs));

  // --- meat race: ghosts and the feed go straight to the view ---
  socket.on('race:state', (game) => g().setRace(game));
  socket.on('race:ghosts', (gs) => getRaceView().pushGhosts(gs));
  socket.on('race:events', (evs) => getRaceView().pushEvents(evs));

  // --- word spies ---
  socket.on('spies:state', (game) => g().setSpies(game));
  socket.on('spies:key', ({ key }) => g().setSpiesKey(key));

  // --- bingo ---
  socket.on('bingo:state', (game) => g().setBingo(game));
  socket.on('bingo:card', (card) => g().setBingoCard(card));

  // --- cryptid ---
  socket.on('cryptid:state', (game) => g().setCryptid(game));
  socket.on('cryptid:clue', ({ clue }) => g().setCryptidClue(clue));

  // --- flip 7 ---
  socket.on('flip7:state', (game) => g().setFlip7(game));

  // --- maze wars: frames and the feed go straight to the client, like strokes ---
  socket.on('maze:state', (game) => g().setMaze(game));
  socket.on('maze:frame', (f) => getMazeClient().pushFrame(f));
  socket.on('maze:events', (evs) => getMazeClient().pushEvents(evs));

  // --- mk11 tournament ---
  socket.on('tourney:state', (game) => g().setTourney(game));

  socket.on('chat:message', (m) => g().pushMessage(m));
  socket.on('guess:correct', ({ playerId }) => g().markGuessed(playerId));

  socket.on('error', ({ message }) => {
    g().setNotice(message);
    setTimeout(() => {
      if (useGame.getState().notice === message) useGame.getState().setNotice(null);
    }, 3000);
  });

  if (socket.connected) onConnect();

  return () => {
    // Off the room page, nothing is paused.
    setPausedAt(null);
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    for (const ev of [
      'state:sync', 'player:joined', 'player:updated', 'player:left',
      'room:settings', 'room:meta', 'host:changed', 'kicked', 'room:replaced', 'turn:choosing', 'turn:clock', 'word:secret',
      'turn:drawing', 'hint:reveal', 'turn:end', 'game:end', 'draw:reactions',
      'draw:start', 'draw:append', 'draw:end', 'draw:replace', 'draw:fill',
      'canvas:undone', 'canvas:cleared', 'chat:message', 'guess:correct', 'error',
      'chess:state', 'chess:moved', 'chess:over', 'chess:rejected',
      'realms:state', 'realms:hand', 'realms:over', 'realms:rejected',
      'fight:state', 'fight:frame', 'fight:events',
      'race:state', 'race:ghosts', 'race:events',
      'spies:state', 'spies:key',
      'bingo:state', 'bingo:card', 'cryptid:state', 'cryptid:clue', 'flip7:state', 'maze:state', 'maze:frame', 'maze:events', 'tourney:state',
    ] as const) {
      socket.off(ev);
    }
  };
}
