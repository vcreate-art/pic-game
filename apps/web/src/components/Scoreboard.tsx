import { selectIsHost, selectSkribbl, useGame } from '../store/game.js';
import { Avatar } from './Avatar.js';
import { KickButton } from './KickButton.js';

export function Scoreboard() {
  const players = useGame((s) => s.room?.players ?? []);
  const turn = useGame((s) => selectSkribbl(s)?.turn);
  const hostId = useGame((s) => s.room?.hostId);
  const me = useGame((s) => s.me);
  /** Whether *we* are the host, as distinct from the per-row `isHost`. */
  const amHost = useGame(selectIsHost);

  const ranked = [...players].sort((a, b) => b.score - a.score);

  return (
    <section className="scores card">
      <h2 className="card__title">Players</h2>
      <ol className={`scores__list ${amHost ? 'is-host' : ''}`}>
        {ranked.map((p, i) => {
          const isDrawer = turn?.drawerId === p.id;
          const guessed = turn?.guessed.includes(p.id);
          const isHost = p.id === hostId;
          return (
            <li
              key={p.id}
              className={[
                'scores__row',
                isDrawer ? 'is-drawing' : '',
                guessed ? 'is-guessed' : '',
                p.connected ? '' : 'is-away',
              ].join(' ')}
            >
              <span className="scores__rank">{i + 1}</span>
              {/* Host is a badge on the avatar corner, so it costs the cramped
                  sidebar no width and leaves the tag row for per-turn states. */}
              <Avatar data={p.avatar} size={32} host={isHost} />
              {/* Name and tags stack, so a long name is never squeezed out by a
                  status tag in the narrow sidebar. */}
              <span className="scores__meta">
                <span className="scores__name">
                  {p.name}
                  {p.id === me && <em> (you)</em>}
                </span>
                <span className="scores__tags">
                  {isDrawer && <span className="tag tag--drawing">drawing</span>}
                  {guessed && <span className="tag tag--ok">guessed</span>}
                  {!p.connected && <span className="tag tag--away">away</span>}
                </span>
              </span>
              <span className="scores__pts">{p.score}</span>
              {/* The empty slot keeps the column aligned on our own row. */}
              {amHost &&
                (p.id === me ? (
                  <span className="kick-slot" />
                ) : (
                  <KickButton playerId={p.id} name={p.name} />
                ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
