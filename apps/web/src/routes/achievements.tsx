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
  const list = byRelevance(stats);
  const earned = list.filter((a) => stats.unlocked[a.id]);
  const todo = list.filter((a) => !stats.unlocked[a.id]);

  const games = PLAYABLE_KINDS.map((k) => ({ kind: k, played: stats.played[k] ?? 0, won: stats.won[k] ?? 0 })).sort(
    (a, b) => b.played - a.played || b.won - a.won,
  );

  return (
    <div className="achv">
      <header className="achv__head">
        <h1 className="achv__title">Achievements</h1>
        <p className="achv__record">
          {played === 0
            ? 'Finish a game and your progress starts showing up here.'
            : `You've finished ${played} ${played === 1 ? 'game' : 'games'} and won ${won} of them.` +
              (stats.bestStreak > 1 ? ` Your best run is ${stats.bestStreak} wins in a row.` : '')}
        </p>
      </header>

      <div className="achv__progress">
        <p className="achv__count">{earned.length} of {ACHIEVEMENTS.length} earned</p>
        {/* One segment per achievement, so the bar is the whole shelf. */}
        <div className="achv__shelf" aria-hidden="true">
          {ACHIEVEMENTS.map((a, i) => (
            <span key={a.id} className={i < earned.length ? 'is-earned' : ''} />
          ))}
        </div>
      </div>

      {earned.length > 0 && (
        <section className="achv__section" aria-labelledby="achv-earned">
          <h2 id="achv-earned" className="achv__heading">Earned</h2>
          <ul className="achv__list">
            {earned.map((a) => (
              <li key={a.id} className="achv-row is-earned">
                <span className="achv-row__icon" aria-hidden="true"><Trophy /></span>
                <div className="achv-row__body">
                  <p className="achv-row__title">{a.title}</p>
                  <p className="achv-row__desc">{a.description}</p>
                </div>
                <p className="achv-row__side">{day.format(stats.unlocked[a.id])}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {todo.length > 0 && (
        <section className="achv__section" aria-labelledby="achv-todo">
          <h2 id="achv-todo" className="achv__heading">Still to get</h2>
          <ul className="achv__list">
            {todo.map((a) => {
              const n = Math.min(a.progress(stats), a.goal);
              return (
                <li key={a.id} className="achv-row">
                  <span className="achv-row__icon" aria-hidden="true"><Lock /></span>
                  <div className="achv-row__body">
                    <p className="achv-row__title">{a.title}</p>
                    <p className="achv-row__desc">{a.description}</p>
                  </div>
                  {a.goal > 1 && (
                    <div className="achv-row__side">
                      <span>{n} of {a.goal}</span>
                      <span
                        className="achv-row__bar"
                        role="progressbar"
                        aria-label={`${a.title} progress`}
                        aria-valuemin={0}
                        aria-valuemax={a.goal}
                        aria-valuenow={n}
                      >
                        <span style={{ width: `${(n / a.goal) * 100}%` }} />
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

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

      <p className="achv__note">Your progress is saved in this browser only and isn't shared with anyone.</p>
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/achievements',
  component: Achievements,
});
