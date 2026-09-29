import { useEffect, useState } from 'react';
import {
  MANUAL_BONUSES, bonusesFor, type BonusKind, type ManualBonus, type MatchScore, type TourneyState,
} from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { MainSelect, pts } from './common.js';

export const BONUS_SHORT: Record<BonusKind, string> = {
  clean: 'Clean 2-0', streak: 'Win streak', flawless: 'Flawless', fatality: 'Fatality', brutality: 'Brutality',
};

/**
 * The host's result for the match on: who won, 2-0 or 2-1, what happened on
 * screen. The payout is worked out here with the same rules the server uses,
 * so the host sees exactly what will land before confirming.
 */
export function ReportSheet({ t, onClose }: { t: TourneyState; onClose: () => void }) {
  const m = t.current!;
  const a = t.entrants.find((e) => e.id === m.a)!;
  const b = t.entrants.find((e) => e.id === m.b)!;
  const [winner, setWinner] = useState<string | null>(null);
  const [score, setScore] = useState<MatchScore>('2-1');
  const [ticked, setTicked] = useState<ManualBonus[]>([]);
  const [chars, setChars] = useState({ a: a.main, b: b.main });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const bonuses = winner ? bonusesFor(t, winner, score, ticked) : [];
  const extra = bonuses.reduce((s, x) => s + x.points, 0);
  const toggle = (k: ManualBonus) => setTicked((l) => (l.includes(k) ? l.filter((x) => x !== k) : [...l, k]));
  const confirm = () => {
    if (!winner) return;
    getSocket().emit('tourney:report', { winner, score, bonuses: ticked, chars: chars.a || chars.b ? chars : null });
    onClose();
  };

  return (
    <div className="overlay overlay--page treport" role="dialog" aria-modal="true" aria-label="Report the result" onClick={onClose}>
      <div className="treport__panel" onClick={(e) => e.stopPropagation()}>
        <h3 className="overlay__title">Who won?</h3>

        <div className="treport__winners">
          {[a, b].map((e) => (
            <button
              key={e.id}
              type="button"
              className={`treport__who ${winner === e.id ? 'is-on' : ''}`}
              aria-pressed={winner === e.id}
              onClick={() => setWinner(e.id)}
            >
              <strong>{e.name}</strong>
              <span>{e.main ?? 'No main'}</span>
            </button>
          ))}
        </div>

        <div className="treport__row">
          <span className="settings__label">Rounds</span>
          <div className="treport__seg">
            {(['2-0', '2-1'] as const).map((s) => (
              <button key={s} type="button" className={`tool ${score === s ? 'is-active' : ''}`} aria-pressed={score === s} onClick={() => setScore(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {MANUAL_BONUSES.some((k) => t.settings.bonuses[k] > 0) && (
          <div className="treport__row">
            <span className="settings__label">What happened</span>
            <div className="treport__seg">
              {MANUAL_BONUSES.filter((k) => t.settings.bonuses[k] > 0).map((k) => (
                <button key={k} type="button" className={`tool ${ticked.includes(k) ? 'is-active' : ''}`} aria-pressed={ticked.includes(k)} onClick={() => toggle(k)}>
                  {BONUS_SHORT[k]} <small>+{t.settings.bonuses[k]}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="treport__row">
          <span className="settings__label">Characters played (optional)</span>
          <div className="treport__chars">
            <MainSelect label={`${a.name} played`} blank={`${a.name}: not noted`} value={chars.a} onChange={(c) => setChars((x) => ({ ...x, a: c }))} />
            <MainSelect label={`${b.name} played`} blank={`${b.name}: not noted`} value={chars.b} onChange={(c) => setChars((x) => ({ ...x, b: c }))} />
          </div>
        </div>

        <div className={`treport__payout ${winner ? '' : 'is-empty'}`}>
          {winner ? (
            <>
              <span>
                <b>{winner === a.id ? a.name : b.name}</b> takes the pot of {pts(m.pot)}
                {bonuses.map((x) => <span key={x.kind} className="tchip">{BONUS_SHORT[x.kind]} +{x.points}</span>)}
              </span>
              <strong>+{pts(m.pot + extra)}</strong>
            </>
          ) : (
            'Pick the winner'
          )}
        </div>

        <div className="treport__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Back</button>
          <button type="button" className="btn btn--primary" disabled={!winner} onClick={confirm}>Confirm result</button>
        </div>
      </div>
    </div>
  );
}
