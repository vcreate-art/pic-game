import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { encode } from 'uqr';
import type { GameKind } from '@pic-game/shared';
import { getSocket } from '../net/socket.js';
import { GAME_ICONS } from './gameIcons.js';
import { useGame } from '../store/game.js';

/**
 * A QR code that moves this seat to a phone. Scanning it opens /handoff/<code>
 * there; the seat, tonight's wins and its cards go with it, and this tab shows
 * where it went. Each code works once, for a few minutes, and is renewed here
 * when it runs out.
 */
export function PhoneHandoff({ onBack }: { onBack: () => void }) {
  const room = useGame((s) => s.room?.code);
  const kind = useGame((s) => s.room?.kind);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [life, setLife] = useState(0);
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const ask = useCallback(() => {
    setFailed(false);
    getSocket().emit('seat:handoff', (r) => {
      if (!r.ok) return setFailed(true);
      const at = Date.now();
      setToken(r.token);
      setLife(r.ms);
      setUntil(at + r.ms);
      setNow(at);
    });
  }, []);

  useEffect(ask, [ask]);
  // A code that runs out is replaced, and its countdown starts again. Timed
  // on this clock, since the server's may not agree with it.
  useEffect(() => {
    if (!token) return;
    const t = setTimeout(ask, life);
    return () => clearTimeout(t);
  }, [token, life, ask]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const link = token && room ? `${window.location.origin}/handoff/${token}` : null;

  return (
    <div className="profile__pop card handoff">
      <div className="handoff__head">
        <button type="button" className="handoff__back" onClick={onBack} aria-label="Back">
          <ArrowLeft aria-hidden="true" />
        </button>
        <p className="handoff__title">Play on your phone</p>
      </div>
      <div className="handoff__qr">
        {link && kind ? (
          <QrCode text={link} kind={kind} />
        ) : (
          <span className="handoff__wait">{failed ? 'Couldn\u2019t make a code.' : 'Making a code\u2026'}</span>
        )}
      </div>
      <p className="handoff__note">
        Scan using your phone.
        {token && (
          <>
            {' '}
            <span className="handoff__expiry">
              Expires in <span className="handoff__clock">{clock(Math.max(0, until - now))}</span>.
            </span>
          </>
        )}
      </p>
      {failed && (
        <button type="button" className="btn btn--outline" onClick={ask}>Make a new code</button>
      )}
    </div>
  );
}

const clock = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A dot's radius, in modules: a small gap between neighbours. ZXing read
 *  every size tried at this and smaller; jsQR, the weakest reader tried,
 *  does best here, and better still with the blur a camera adds. */
const DOT = 0.44;
/** The three corner squares a scanner finds the code by. */
const FINDER = 7;
/** The white border a scanner needs around the code, in modules. */
const QUIET = 4;

/**
 * The code in the style of a profile QR, in the game's colour: round dots,
 * rounded corner squares and the game's icon in the middle. Every game's
 * colour is at least 4.7:1 on white and decoded at every size tried. The icon
 * hides some of the code, which the highest error correction (about 30%
 * recoverable) more than covers.
 */
function QrCode({ text, kind }: { text: string; kind: GameKind }) {
  const { icon: Icon, color } = GAME_ICONS[kind];
  const { size, dots, finders, logo } = useMemo(() => {
    const { data } = encode(text, { border: 0, ecc: 'H' });
    const n = data.length;
    const finders = [
      [0, 0],
      [n - FINDER, 0],
      [0, n - FINDER],
    ] as const;
    const inFinder = (x: number, y: number) =>
      finders.some(([fx, fy]) => x >= fx && x < fx + FINDER && y >= fy && y < fy + FINDER);
    // A clear square in the middle for the icon, on whole cells, with one
    // cell of space on every side so it sits centred in its gap.
    const side = Math.round(n * 0.14) | 1;
    const at = (n - side) / 2;
    const inLogo = (x: number, y: number) => x >= at - 1 && x <= at + side && y >= at - 1 && y <= at + side;

    let d = '';
    data.forEach((row, y) =>
      row.forEach((on, x) => {
        if (!on || inFinder(x, y) || inLogo(x, y)) return;
        const cx = x + 0.5 - DOT;
        const cy = y + 0.5;
        d += `M${cx} ${cy}a${DOT} ${DOT} 0 1 0 ${DOT * 2} 0a${DOT} ${DOT} 0 1 0 ${-DOT * 2} 0`;
      }),
    );
    return { size: n, dots: d, finders, logo: { at, side } };
  }, [text]);

  const box = size + QUIET * 2;
  const mark = logo.side * 0.85;
  return (
    <svg viewBox={`${-QUIET} ${-QUIET} ${box} ${box}`} role="img" aria-label="QR code for this seat">
      <rect x={-QUIET} y={-QUIET} width={box} height={box} fill="#fff" />
      <g fill={color}>
        <path d={dots} />
        {finders.map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <rect x={x + 0.5} y={y + 0.5} width={FINDER - 1} height={FINDER - 1} rx={2} fill="none" stroke={color} strokeWidth={1} />
            <rect x={x + 2} y={y + 2} width={3} height={3} rx={1} />
          </g>
        ))}
      </g>
      <Icon
        x={size / 2 - mark / 2}
        y={size / 2 - mark / 2}
        width={mark}
        height={mark}
        color={color}
        strokeWidth={2}
        aria-hidden="true"
      />
    </svg>
  );
}
