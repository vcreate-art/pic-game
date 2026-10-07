import { useState } from 'react';
import { copyText } from '../lib/clipboard.js';
import { useGame } from '../store/game.js';

type CopyState = 'idle' | 'ok' | 'failed';

const LABELS: Record<CopyState, string> = {
  idle: 'Copy invite link',
  ok: 'Link copied',
  failed: 'Copy it below',
};

/** Room code and invite link. Shared, because every game needs people in it. */
export function InviteCard() {
  const code = useGame((s) => s.room?.code);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  if (!code) return null;

  const link = `${window.location.origin}/room/${code}`;
  const copy = async () => {
    const ok = await copyText(link);
    setCopyState(ok ? 'ok' : 'failed');
    setTimeout(() => setCopyState('idle'), 2400);
  };

  return (
    <div className="lobby__invite card">
      <h2 className="card__title">Invite friends</h2>
      <div className="lobby__code">{code}</div>
      <button type="button" className="btn btn--outline invite__copy" onClick={copy}>
        {/* Every label sits in the same spot and only the current one shows,
            so the button keeps the widest one's width as the text changes. */}
        <span className="invite__labels" aria-live="polite">
          {(Object.keys(LABELS) as CopyState[]).map((k) => (
            <span key={k} className={k === copyState ? 'is-on' : ''}>
              {LABELS[k]}
            </span>
          ))}
        </span>
      </button>
      <p className="lobby__link">{link}</p>
    </div>
  );
}
