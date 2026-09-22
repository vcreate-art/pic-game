import { useEffect, useState } from 'react';
import { getSocket } from '../net/socket.js';

/**
 * Two-step on purpose. Removing someone is irreversible from their side and
 * lands on another person, so a single stray click in a crowded player list
 * should not do it. The armed state disarms itself after a few seconds.
 */
export function KickButton({ playerId, name }: { playerId: string; name: string }) {
  const [armed, setArmed] = useState(false);
  const socket = getSocket();

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      className={`kick ${armed ? 'is-armed' : ''}`}
      title={armed ? `Remove ${name}?` : `Remove ${name}`}
      aria-label={armed ? `Confirm removing ${name}` : `Remove ${name}`}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          socket.emit('player:kick', { playerId });
          setArmed(false);
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? 'Remove?' : '×'}
    </button>
  );
}
