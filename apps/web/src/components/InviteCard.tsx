import { useState } from 'react';
import { copyText } from '../lib/clipboard.js';
import { useGame } from '../store/game.js';

/** Room code and invite link. Shared, because every game needs people in it. */
export function InviteCard() {
  const code = useGame((s) => s.room?.code);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');
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
      <button type="button" className="btn btn--ghost" onClick={copy}>
        {copyState === 'ok' ? 'Link copied' : copyState === 'failed' ? 'Copy it below' : 'Copy invite link'}
      </button>
      <p className="lobby__link">{link}</p>
    </div>
  );
}
