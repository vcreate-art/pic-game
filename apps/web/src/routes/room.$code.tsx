import { useEffect, useRef, useState } from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { getEngine } from '../canvas/engineInstance.js';
import { JoinPanel, type Identity } from '../components/JoinPanel.js';
import { KungFuGame } from '../components/kungfu/KungFuGame.js';
import { Lobby } from '../components/Lobby.js';
import { SkribblGame } from '../components/skribbl/SkribblGame.js';
import { bindSocket } from '../net/bindings.js';
import { clearSeat, getSocket, loadProfile, loadSeat, saveSeat } from '../net/socket.js';
import { useGame } from '../store/game.js';
import { Route as rootRoute } from './__root.js';

function RoomPage() {
  const { code } = useParams({ from: '/room/$code' });
  const navigate = useNavigate();
  const me = useGame((s) => s.me);
  const room = useGame((s) => s.room);
  const phase = room?.kind === 'skribbl' ? room.phase : room?.game.phase;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const identity = useRef<Identity | null>(loadProfile());

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

  /** Joins on mount from the saved seat, which makes this route self-sufficient:
   *  it works the same whether you arrived from the landing page, refreshed, or
   *  opened an invite link cold. Nothing is carried over in memory from elsewhere.
   *
   *  Note there is deliberately no leave-on-unmount here. A cleanup that tears down
   *  shared state is unsafe under React's mount/unmount/remount cycle — it wiped the
   *  seat the landing page had just created. Leaving is now an explicit action, and
   *  a closed tab is handled by the socket disconnecting. */
  useEffect(() => {
    if (useGame.getState().me) return;
    const profile = loadProfile();
    if (!profile) return; // no nickname yet — the panel below collects one
    identity.current = profile;
    joinRoom(profile, loadSeat(code)?.token);
  }, [code]);

  function joinRoom(id: Identity, token?: string) {
    setBusy(true);
    setError(null);
    identity.current = id;
    getSocket().emit('room:join', { code, name: id.name, avatar: id.avatar, token }, (res) => {
      setBusy(false);
      if (!res.ok) {
        setError(res.message);
        if (res.code === 'NOT_FOUND') clearSeat();
        return;
      }
      useGame.getState().setMe(res.playerId);
      useGame.getState().sync(res.state);
      saveSeat({ code, playerId: res.playerId, token: res.token });
    });
  }

  const leave = () => {
    getSocket().emit('room:leave');
    clearSeat();
    useGame.getState().reset();
    void navigate({ to: '/' });
  };


  /** Being removed ends the session here. The seat token is deliberately kept:
   *  it is what the server matches to stop us walking straight back in. */
  const kickedBy = useGame((s) => s.kickedBy);
  useEffect(() => {
    if (!kickedBy) return;
    useGame.getState().reset();
    useGame.getState().setNotice(`${kickedBy} removed you from the room.`);
    void navigate({ to: '/' });
  }, [kickedBy, navigate]);

  // Arrived via an invite link with no seat yet — collect a name first.
  if (!me || !room) {
    return (
      <div className="landing landing--narrow">
        <div className="landing__hero">
          <h1 className="landing__title">Join room {code}</h1>
          <p className="landing__sub">Pick a nickname to jump in.</p>
        </div>
        <div className="card landing__card">
          <JoinPanel
            submitLabel="Join room"
            busy={busy}
            error={error}
            onSubmit={(id) => joinRoom(id, loadSeat(code)?.token)}
          />
          <button className="btn btn--ghost" type="button" onClick={() => void navigate({ to: '/' })}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  // Chess runs its own lobby, because "waiting to start" there means choosing
  // sides on the board rather than setting up a word list.
  if (room.kind === 'kungfu') return <KungFuGame onLeave={leave} />;

  // The server can run Star Realms before it has a screen; say so rather than
  // falling through to another game's lobby.
  if (room.kind === 'realms') {
    return (
      <div className="landing landing--narrow">
        <div className="landing__hero">
          <h1 className="landing__title">Star Realms</h1>
          <p className="landing__sub">The table is set, but the cards have nowhere to be drawn yet.</p>
        </div>
        <div className="leavebar">
          <button className="btn btn--danger" type="button" onClick={leave}>
            Leave room
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'lobby') {
    return (
      <div className="lobbyscreen">
        <Lobby />
        <div className="leavebar">
          <button className="btn btn--danger" type="button" onClick={leave}>
            Leave room
          </button>
        </div>
      </div>
    );
  }

  return <SkribblGame onLeave={leave} />;
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/room/$code',
  component: RoomPage,
});
