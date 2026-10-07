import { useCallback, useEffect, useMemo, useState } from 'react';
import { encode } from 'uqr';
import { getSocket } from '../net/socket.js';
import { useGame } from '../store/game.js';

type Code = { token: string; until: number };

/**
 * A QR code that moves this seat to a phone. Scanning it opens /handoff/<code>
 * there; the seat, tonight's wins and its cards go with it, and this tab shows
 * where it went. The code works once, for a few minutes.
 */
export function PhoneHandoff({ onBack }: { onBack: () => void }) {
  const room = useGame((s) => s.room?.code);
  const [code, setCode] = useState<Code | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const ask = useCallback(() => {
    setFailed(false);
    getSocket().emit('seat:handoff', (r) => {
      // Counted on this clock from now: the server's may not agree with it.
      if (r.ok) {
        const at = Date.now();
        setNow(at);
        setCode({ token: r.token, until: at + r.ms });
      }
      else setFailed(true);
    });
  }, []);

  useEffect(ask, [ask]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const link = code && room ? `${window.location.origin}/handoff/${code.token}` : null;
  const left = code ? Math.max(0, code.until - now) : 0;
  const expired = !!code && left === 0;

  return (
    <div className="profile__pop card handoff">
      <p className="handoff__title">Play on your phone</p>
      <div className={`handoff__qr ${expired ? 'is-expired' : ''}`}>
        {link ? <QrCode text={link} /> : <span className="handoff__wait">{failed ? 'Couldn’t make a code.' : 'Making a code…'}</span>}
      </div>
      {expired ? (
        <p className="handoff__note">This code has run out.</p>
      ) : (
        <p className="handoff__note">
          Scan it with your phone's camera to move your seat there, with tonight's wins.
          {code && <> Works once, for {clock(left)}.</>}
        </p>
      )}
      <div className="profile__actions">
        <button type="button" className="btn btn--ghost" onClick={onBack}>Back</button>
        {(expired || failed) && (
          <button type="button" className="btn btn--outline" onClick={ask}>Make a new code</button>
        )}
      </div>
    </div>
  );
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The code as one SVG path, a square per dark module. */
function QrCode({ text }: { text: string }) {
  const { size, d } = useMemo(() => {
    const { data } = encode(text, { border: 0, ecc: 'M' });
    let path = '';
    data.forEach((row, y) => row.forEach((on, x) => on && (path += `M${x} ${y}h1v1h-1z`)));
    return { size: data.length, d: path };
  }, [text]);
  return (
    <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} role="img" aria-label="QR code for this seat" shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <path d={d} fill="#1f2233" />
    </svg>
  );
}
