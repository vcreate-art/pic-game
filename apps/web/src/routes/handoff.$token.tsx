import { useEffect, useRef, useState } from 'react';
import { createRoute, useNavigate, useParams } from '@tanstack/react-router';
import { getSocket, loadProfile, saveProfile, saveSeat } from '../net/socket.js';
import { flash, importStats } from '../lib/achievements.js';
import { useGame } from '../store/game.js';
import { Route as rootRoute } from './__root.js';

/**
 * Where a seat's QR code lands on the other device. Takes the seat, with its
 * name and avatar if this device has no profile yet, and the achievements
 * the other device sent, then goes to the room, so the room's own address is
 * what stays in history.
 */
function HandoffPage() {
  const { token } = useParams({ from: '/handoff/$token' });
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // StrictMode mounts twice in development; the code only works once.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    getSocket().emit('seat:pickup', { token }, (res) => {
      if (!res.ok) {
        setError(res.message);
        return;
      }
      const code = res.state.code;
      const seat = res.state.players.find((p) => p.id === res.playerId);
      if (!loadProfile() && seat) saveProfile({ name: seat.name, avatar: seat.avatar });
      if (useGame.getState().replaced === code) useGame.getState().setReplaced(null);
      // The achievements came along: join them with whatever this device has.
      const brought = res.stats ? importStats(res.stats) : false;
      useGame.getState().setMe(res.playerId);
      useGame.getState().sync(res.state);
      saveSeat({ code, playerId: res.playerId, token: res.token });
      void navigate({ to: '/room/$code', params: { code }, replace: true });
      if (brought) flash('🏆 Your achievements came along');
    });
  }, [token, navigate]);

  return (
    <div className="landing landing--narrow">
      <div className="landing__hero">
        <h1 className="landing__title">{error ? 'This code has run out' : 'Moving your seat…'}</h1>
        <p className="landing__sub">
          {error
            ? 'Each code works once, for five minutes. On your other device, open the menu under your name and choose Play on your phone for a new one.'
            : 'Bringing your seat over from your other device.'}
        </p>
      </div>
      {error && (
        <div className="card landing__card">
          <button className="btn btn--ghost" type="button" onClick={() => void navigate({ to: '/' })}>
            Back to home
          </button>
        </div>
      )}
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/handoff/$token',
  component: HandoffPage,
});
