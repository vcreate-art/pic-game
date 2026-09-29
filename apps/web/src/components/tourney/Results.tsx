import { useState } from 'react';
import { standings, type TourneyState } from '@pic-game/shared';
import { copyText } from '../../lib/clipboard.js';
import { getSocket } from '../../net/socket.js';
import { pts } from './common.js';

/** The standings as plain text, for pasting into a group chat. */
function summary(t: TourneyState): string {
  const rows = standings(t);
  const place = (i: number) => (i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`);
  const lines = rows.map((e, i) => {
    const main = e.main ? ` (${e.main})` : '';
    const how = e.outOnTurn !== null ? `out on turn ${e.outOnTurn}` : `${pts(e.points)} pts`;
    return `${place(i)} ${e.name}${main}: ${how} · ${e.wins}-${e.losses}`;
  });
  const laps = Math.max(1, ...t.history.map((h) => h.lap));
  return [
    `🏆 ${t.settings.name}: final standings`,
    ...lines,
    `${t.history.length} matches over ${laps} lap${laps === 1 ? '' : 's'}.`,
  ].join('\n');
}

export function Results({ t, isHost }: { t: TourneyState; isHost: boolean }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const rows = standings(t);
  const names = t.winners.map((id) => t.entrants.find((e) => e.id === id)?.name ?? '?');

  return (
    <section className="card tresults">
      <p className="overlay__kicker">{t.settings.name}</p>
      <h2 className="tresults__title">
        {names.length > 1 ? `${names.join(' & ')} share it!` : `${names[0]} wins!`}
      </h2>
      <div className="tpodium">
        {[1, 0, 2].map((i) => {
          const e = rows[i];
          return e ? (
            <div key={e.id} className={`tpodium__slot tpodium__slot--${i + 1}`}>
              <strong>{e.name}</strong>
              <span>{e.main ?? ' '}</span>
              <b>{e.outOnTurn !== null ? `out T${e.outOnTurn}` : pts(e.points)}</b>
              <div className="tpodium__block">{i + 1}</div>
            </div>
          ) : <div key={i} className="tpodium__slot" />;
        })}
      </div>
      <div className="tresults__actions">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            setCopied((await copyText(summary(t))) ? 'ok' : 'failed');
            setTimeout(() => setCopied('idle'), 2400);
          }}
        >
          {copied === 'ok' ? 'Copied' : copied === 'failed' ? 'Could not copy' : 'Copy results'}
        </button>
        {isHost && (
          <button type="button" className="btn btn--primary" onClick={() => getSocket().emit('tourney:toSetup')}>
            Play again, same players
          </button>
        )}
      </div>
    </section>
  );
}
