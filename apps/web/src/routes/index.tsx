import { useState } from 'react';
import { GAME_LABELS, PLAYABLE_KINDS, type GameKind } from '@pic-game/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { JoinPanel, type Identity } from '../components/JoinPanel.js';
import { peekRoom } from '../api/client.js';
import { getSocket, saveSeat } from '../net/socket.js';
import { useGame } from '../store/game.js';
import { Route as rootRoute } from './__root.js';

function Landing() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [game, setGame] = useState<GameKind>('skribbl');

  const go = (id: Identity) => {
    setBusy(true);
    setError(null);
    const socket = getSocket();
    const wanted = code.trim().toUpperCase();

    if (wanted) {
      // Preflight over HTTP so a typo gives a clear message instead of a silent failure.
      peekRoom(wanted)
        .then((peek) => {
          if (!peek.exists) {
            setBusy(false);
            setError('No room with that code.');
            return;
          }
          socket.emit('room:join', { code: wanted, name: id.name, avatar: id.avatar }, (res) => {
            setBusy(false);
            if (!res.ok) {
              setError(res.message);
              return;
            }
            useGame.getState().setMe(res.playerId);
            useGame.getState().sync(res.state);
            saveSeat({ code: res.state.code, playerId: res.playerId, token: res.token });
            void navigate({ to: '/room/$code', params: { code: res.state.code } });
          });
        })
        .catch(() => {
          setBusy(false);
          setError('Could not reach the server.');
        });
      return;
    }

    socket.emit('room:create', { name: id.name, avatar: id.avatar, game }, (res) => {
      setBusy(false);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      useGame.getState().setMe(res.playerId);
      useGame.getState().sync(res.state);
      saveSeat({ code: res.state.code, playerId: res.playerId, token: res.token });
      void navigate({ to: '/room/$code', params: { code: res.state.code } });
    });
  };

  return (
    <div className="landing">
      <div className="landing__hero">
        <h1 className="landing__title">Pick your game.</h1>
        <p className="landing__sub">Grab some friends. One link, everyone's in.</p>
      </div>

      <div className={`landing__cols ${code.trim() ? 'is-single' : ''}`}>
      {/* Hidden once a code is typed: joining an existing room inherits
          whichever game that room was created with. */}
      {!code.trim() && (
        <div className="picker">
          {PLAYABLE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`pick ${game === k ? 'is-active' : ''}`}
              aria-pressed={game === k}
              onClick={() => setGame(k)}
            >
              <span className={`pick__art ${k === 'skribbl' ? 'is-flipped' : ''}`} aria-hidden="true">
                {k === 'skribbl' ? '✏️' : k === 'kungfu' ? '♞' : '🚀'}
              </span>
              <strong>{GAME_LABELS[k].name}</strong>
              <span>{GAME_LABELS[k].blurb}</span>
            </button>
          ))}
        </div>
      )}

      <div className="card landing__card">
        <JoinPanel
          submitLabel={code.trim() ? 'Join room' : `Create ${GAME_LABELS[game].name}`}
          busy={busy}
          error={error}
          onSubmit={go}
        >
          <label className="field">
            <span className="field__label">Room code <em>— leave blank to start a new one</em></span>
            <input
              className="field__input field__input--code"
              value={code}
              maxLength={6}
              placeholder="ABC123"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </label>
        </JoinPanel>
      </div>
      </div>
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Landing,
});
