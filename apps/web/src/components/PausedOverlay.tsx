import { useEffect, useState, type CSSProperties } from 'react';
import { serverNow } from '../net/clock.js';
import { getSocket } from '../net/socket.js';
import { selectIsHost, useGame } from '../store/game.js';
import { GAME_ICONS } from './gameIcons.js';

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Covers the game in its own colour while the host has it paused, so
 * nobody plays on by mistake, and counts how long it has been. The header
 * stays usable above it.
 */
export function PausedOverlay() {
  const paused = useGame((s) => s.room?.meta.paused ?? null);
  const kind = useGame((s) => s.room?.kind);
  const players = useGame((s) => s.room?.players);
  const hostId = useGame((s) => s.room?.hostId);
  const isHost = useGame(selectIsHost);
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    if (!paused) return;
    setNow(serverNow());
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, [paused]);

  if (!paused || !kind) return null;
  const nameOf = (id?: string) => players?.find((p) => p.id === id)?.name ?? 'the host';

  return (
    <div
      className="paused"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paused-title"
      style={{ '--game': GAME_ICONS[kind].color } as CSSProperties}
    >
      <div className="paused__inner">
        <h2 id="paused-title" className="paused__word">Paused</h2>
        <p className="paused__line">
          {isHost ? 'You paused the game' : `${nameOf(paused.by)} paused the game`}{' '}
          <span className="paused__time">{elapsed(now - paused.at)} ago</span>
        </p>
        {isHost ? (
          <button type="button" className="paused__resume" onClick={() => getSocket().emit('room:resume')}>
            Resume
          </button>
        ) : (
          <p className="paused__wait">Waiting for {nameOf(hostId)} to carry on.</p>
        )}
      </div>
    </div>
  );
}
