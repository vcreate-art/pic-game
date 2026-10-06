import { getSocket } from '../net/socket.js';
import { selectIsHost, useGame } from '../store/game.js';

/**
 * Covers the game while the host has it paused, so nobody plays on by
 * mistake. The header stays usable above it, and the host resumes from here
 * or from the room menu.
 */
export function PausedOverlay() {
  const paused = useGame((s) => s.room?.meta.paused ?? null);
  const players = useGame((s) => s.room?.players);
  const hostId = useGame((s) => s.room?.hostId);
  const isHost = useGame(selectIsHost);
  if (!paused) return null;

  const name = (id?: string) => players?.find((p) => p.id === id)?.name ?? 'The host';

  return (
    <div className="paused" role="dialog" aria-modal="true" aria-labelledby="paused-title">
      <div className="paused__card card">
        <h2 id="paused-title" className="paused__title">Paused</h2>
        <p className="paused__text">
          {isHost
            ? 'Everything is on hold until you carry on.'
            : `${name(paused.by)} paused the game. It carries on when ${name(hostId)} resumes it.`}
        </p>
        {isHost && (
          <button type="button" className="btn btn--primary btn--lg" onClick={() => getSocket().emit('room:resume')}>
            Resume
          </button>
        )}
      </div>
    </div>
  );
}
