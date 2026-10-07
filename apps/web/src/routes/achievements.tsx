import type { CSSProperties } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Lock, Trophy } from 'lucide-react';
import { GAME_LABELS, PLAYABLE_KINDS } from '@pic-game/shared';
import { GAME_ICONS } from '../components/gameIcons.js';
import { ACHIEVEMENTS, byRelevance, totalPlayed, totalWon, useStats } from '../lib/achievements.js';
import { Route as rootRoute } from './__root.js';

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function Achievements() {
  const stats = useStats();
  const played = totalPlayed(stats);
  const won = totalWon(stats);
  const earned = ACHIEVEMENTS.filter((a) => stats.unlocked[a.id]).length;

  const list = byRelevance(stats);

  const games = PLAYABLE_KINDS.map((k) => ({ kind: k, played: stats.played[k] ?? 0, won: stats.won[k] ?? 0 })).sort(
    (a, b) => b.played - a.played || b.won - a.won,
  );

  return (
    <div className="achv">
      <header className="achv__head">
        <h1 className="achv__title">Achievements</h1>
        <p className="achv__note">Saved in this browser only. Nothing here is shared.</p>
      </header>

      <dl className="achv__stats">
        <div><dt>Games</dt><dd>{played}</dd></div>
        <div><dt>Wins</dt><dd>{won}</dd></div>
        <div><dt>Win rate</dt><dd>{played ? `${Math.round((won / played) * 100)}%` : '–'}</dd></div>
        <div><dt>Best streak</dt><dd>{stats.bestStreak}</dd></div>
        <div><dt>Earned</dt><dd>{earned}/{ACHIEVEMENTS.length}</dd></div>
      </dl>

      {played === 0 && (
        <p className="achv__empty">Finish a game and your progress starts showing up here.</p>
      )}

      <section className="achv__section" aria-labelledby="achv-list">
        <h2 id="achv-list" className="achv__heading">Badges</h2>
        <ul className="achv__grid">
          {list.map((a) => {
            const at = stats.unlocked[a.id];
            const n = Math.min(a.progress(stats), a.goal);
            return (
              <li key={a.id} className={`achv-card ${at ? 'is-earned' : ''}`}>
                <span className="achv-card__icon" aria-hidden="true">{at ? <Trophy /> : <Lock />}</span>
                <div className="achv-card__body">
                  <p className="achv-card__title">{a.title}</p>
                  <p className="achv-card__desc">{a.description}</p>
                  {at ? (
                    <p className="achv-card__meta">Earned {day.format(at)}</p>
                  ) : a.goal > 1 ? (
                    <div className="achv-card__bar" role="progressbar" aria-valuemin={0} aria-valuemax={a.goal} aria-valuenow={n}>
                      <span style={{ width: `${(n / a.goal) * 100}%` }} />
                      <em>{n}/{a.goal}</em>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="achv__section" aria-labelledby="achv-games">
        <h2 id="achv-games" className="achv__heading">By game</h2>
        <ul className="achv__games">
          {games.map((g) => {
            const { icon: Icon, color } = GAME_ICONS[g.kind];
            return (
              <li key={g.kind} className={`achv-game ${g.played ? '' : 'is-new'}`} style={{ '--game': color } as CSSProperties}>
                <Icon className="achv-game__icon" aria-hidden="true" />
                <span className="achv-game__name">{GAME_LABELS[g.kind].name}</span>
                <span className="achv-game__count">
                  {g.played ? `${g.played} played, ${g.won} won` : 'Not played yet'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/achievements',
  component: Achievements,
});
