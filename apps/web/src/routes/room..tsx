import { useEffect, useRef, useState } from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { CanvasBoard } from '../canvas/CanvasBoard.js';
import { getEngine } from '../canvas/engineInstance.js';
import { Chat } from '../components/Chat.js';
import { JoinPanel, type Identity } from '../components/JoinPanel.js';
import { Lobby } from '../components/Lobby.js';
import { Podium } from '../components/Podium.js';
import { Scoreboard } from '../components/Scoreboard.js';
import { Timer } from '../components/Timer.js';
import { Toolbar } from '../components/Toolbar.js';
import { TurnResult } from '../components/TurnResult.js';
import { WordChoice } from '../components/WordChoice.js';
import { WordMask } from '../components/WordMask.js';
import { bindSocket } from '../net/bindings.js';
import { clearSeat, getSocket, loadSeat, saveSeat } from '../net/socket.js';
import { selectIsDrawer, useGame } from '../store/game.js';
import { Route as rootRoute } from './__root.js';

function RoomPage() {
  const { code } = useParams({ from: '/room/$code' });
  const navigate = useNavigate();
  const me = useGame((s) => s.me);
  const room = useGame((s) => s.room);
  const phase = room?.phase;
  const isDrawer = useGame(selectIsDrawer);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const identity = useRef<Identity | null>(null);

  // Bind socket events for as long as this page is mounted.
  useEffect(() => bindSocket(getEngine()), []);

  /** Rejoins after a dropped connection. Socket.IO reconnects transparently but
   *  the server still needs the token to hand back the same seat and score. */
  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => {
      const seat = loadSeat(code);
      const id = identity.current;
      if (!seat || !id) return;
      socket.emit('room:join', { code, name: id.name, avatar: id.avatar, token: seat.token }, (res) => {
        if (res.ok) {
          useGame.getState().setMe(res.playerId);
          useGame.getState().sync(res.state);
          saveSeat({ code, playerId: res.playerId, token: res.token });
        } else {
          clearSeat();
          useGame.getState().reset();
        }
      });
    };
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
    };
  }, [code]);

  // Leaving the page should free the seat rather than leave a ghost player behind.
  useEffect(() => {
    return () => {
      getSocket().emit('room:leave');
      clearSeat();
      useGame.getState().reset();
    };
  }, []);

  const join = (id: Identity) => {
    setBusy(true);
    setError(null);
    identity.current = id;
    const seat = loadSeat(code);
    getSocket().emit(
      'room:join',
      { code, name: id.name, avatar: id.avatar, token: seat?.token },
      (res) => {
        setBusy(false);
        if (!res.ok) {
          setError(res.message);
          if (res.code === 'NOT_FOUND') clearSeat();
          return;
        }
        useGame.getState().setMe(res.playerId);
        useGame.getState().sync(res.state);
        saveSeat({ code, playerId: res.playerId, token: res.token });
      },
    );
  };

  // Arrived via an invite link with no seat yet — collect a name first.
  if (!me || !room) {
    return (
      <div className="landing">
        <div className="landing__hero">
          <h1 className="landing__title">Join room {code}</h1>
          <p className="landing__sub">Pick a nickname to jump in.</p>
        </div>
        <div className="card landing__card">
          <JoinPanel submitLabel="Join room" busy={busy} error={error} onSubmit={join} />
          <button className="btn btn--ghost" type="button" onClick={() => void navigate({ to: '/' })}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'lobby') return <Lobby />;

  return (
    <div className="game">
      <div className="game__head">
        <div className="game__round">
          Round {room.round}/{room.settings.rounds}
        </div>
        <WordMask />
        {phase === 'drawing' && room.turn && (
          <Timer endsAt={room.turn.endsAt} total={room.settings.drawTime} />
        )}
      </div>

      <div className="game__body">
        <Scoreboard />

        <div className="game__stage">
          <div className="board__wrap">
            <CanvasBoard />
            {phase === 'choosing' && <WordChoice />}
            {phase === 'turnEnd' && <TurnResult />}
            {phase === 'gameEnd' && <Podium />}
          </div>
          {isDrawer && phase === 'drawing' && <Toolbar />}
        </div>

        <Chat />
      </div>
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/room/$code',
  component: RoomPage,
});
