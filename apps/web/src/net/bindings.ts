import type { CanvasEngine } from '../canvas/engine.js';
import { useGame } from '../store/game.js';
import { getSocket } from './socket.js';
import { syncClock } from './clock.js';

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
    g().sync(state);
    engine.replay(state.ops);
  });

  socket.on('player:joined', (p) => g().patchPlayer(p));
  socket.on('player:updated', (p) => g().patchPlayer(p));
  socket.on('player:left', ({ id }) => g().dropPlayer(id));
  socket.on('room:settings', (s) => g().setSettings(s));
  socket.on('host:changed', ({ hostId }) => g().setHost(hostId));
  socket.on('kicked', ({ by }) => g().setKickedBy(by));

  socket.on('turn:choosing', (p) => {
    g().beginChoosing(p);
    engine.clear();
  });
  socket.on('word:secret', ({ word }) => g().setSecret(word));
  socket.on('suggest:state', (st) => g().setSuggest(st));
  socket.on('turn:drawing', (turn) => g().beginDrawing(turn));
  socket.on('hint:reveal', ({ index, char }) => g().reveal(index, char));
  socket.on('turn:end', (r) => g().endTurn(r));
  socket.on('game:end', ({ players }) => g().endGame(players));

  // --- canvas: engine only, deliberately bypassing React ---
  socket.on('draw:start', (op) => engine.startStroke({ kind: 'stroke', ...op }));
  socket.on('draw:append', ({ id, pts }) => engine.appendStroke(id, pts));
  socket.on('draw:end', ({ id }) => engine.endStroke(id));
  socket.on('draw:fill', (op) => engine.applyFill(op));
  socket.on('canvas:undone', ({ ops }) => engine.replay(ops));
  socket.on('canvas:cleared', () => engine.clear());

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
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    for (const ev of [
      'state:sync', 'player:joined', 'player:updated', 'player:left',
      'room:settings', 'host:changed', 'kicked', 'turn:choosing', 'word:secret', 'suggest:state',
      'turn:drawing', 'hint:reveal', 'turn:end', 'game:end',
      'draw:start', 'draw:append', 'draw:end', 'draw:fill',
      'canvas:undone', 'canvas:cleared', 'chat:message', 'guess:correct', 'error',
    ] as const) {
      socket.off(ev);
    }
  };
}
