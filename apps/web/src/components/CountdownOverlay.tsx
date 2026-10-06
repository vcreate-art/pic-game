import { useEffect, useState, type CSSProperties } from 'react';
import { GAME_LABELS } from '@pic-game/shared';
import { serverNow } from '../net/clock.js';
import { useGame } from '../store/game.js';
import { GAME_ICONS } from './gameIcons.js';

/**
 * The big 3-2-1 over the game before it starts, and before a paused game
 * carries on. The server holds the game still until it runs out.
 */
export function CountdownOverlay() {
  const countdown = useGame((s) => s.room?.meta.countdown ?? null);
  const kind = useGame((s) => s.room?.kind);
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    if (!countdown) return;
    setNow(serverNow());
    const t = setInterval(() => setNow(serverNow()), 100);
    return () => clearInterval(t);
  }, [countdown]);

  if (!countdown || !kind) return null;
  const n = Math.max(1, Math.ceil((countdown.until - now) / 1000));

  return (
    <div
      className="paused countdown"
      role="status"
      aria-live="assertive"
      style={{ '--game': GAME_ICONS[kind].color } as CSSProperties}
    >
      <div className="paused__inner">
        <p className="countdown__label">
          {countdown.kind === 'start' ? `${GAME_LABELS[kind].name} starts in` : 'Back in'}
        </p>
        {/* Keyed on the number, so each one lands afresh. */}
        <p key={n} className="countdown__n">{n}</p>
      </div>
    </div>
  );
}
