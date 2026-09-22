import { useEffect, useState } from 'react';
import { msUntil } from '../net/clock.js';

/** Counts down against server time rather than the local clock, so a client whose
 *  clock is wrong — or deliberately altered — still shows the real remaining time. */
export function Timer({ endsAt, total }: { endsAt: number; total: number }) {
  const [left, setLeft] = useState(() => msUntil(endsAt));

  useEffect(() => {
    setLeft(msUntil(endsAt));
    const id = setInterval(() => setLeft(msUntil(endsAt)), 200);
    return () => clearInterval(id);
  }, [endsAt]);

  const secs = Math.ceil(left / 1000);
  const frac = total > 0 ? Math.max(0, Math.min(1, left / (total * 1000))) : 0;
  const urgent = secs <= 10;

  return (
    <div className={`timer ${urgent ? 'timer--urgent' : ''}`}>
      <svg viewBox="0 0 36 36" className="timer__ring">
        <circle className="timer__track" cx="18" cy="18" r="16" />
        <circle
          className="timer__fill"
          cx="18"
          cy="18"
          r="16"
          style={{ strokeDashoffset: 100.5 * (1 - frac) }}
        />
      </svg>
      <span className="timer__num">{secs}</span>
    </div>
  );
}
