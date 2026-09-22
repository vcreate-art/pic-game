import { useGame } from '../store/game.js';
import { Avatar } from './Avatar.js';

export function Scoreboard() {
  const players = useGame((s) => s.room?.players ?? []);
  const turn = useGame((s) => s.room?.turn);
  const hostId = useGame((s) => s.room?.hostId);
  const me = useGame((s) => s.me);

  const ranked = [...players].sort((a, b) => b.score - a.score);

  return (
    <section className="scores card">
      <h2 className="card__title">Players</h2>
      <ol className="scores__list">
        {ranked.map((p, i) => {
          const isDrawer = turn?.drawerId === p.id;
          const guessed = turn?.guessed.includes(p.id);
          const isHost = p.id === hostId;
          return (
            <li
              key={p.id}
              className={[
                'scores__row',
                guessed ? 'is-guessed' : '',
                p.connected ? '' : 'is-away',
                isHost ? 'is-host' : '',
              ].join(' ')}
            >
              <span className="scores__rank">{i + 1}</span>
              {/* The host is marked with a ring on the avatar rather than a tag:
                  it sits left of the name and costs the cramped sidebar no width. */}
              <span className="scores__avatar" title={isHost ? 'Host' : undefined}>
                <Avatar data={p.avatar} size={32} />
                {isHost && <span className="visually-hidden">Host</span>}
              </span>
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
            </li>
          );
        })}
      </ol>
    </section>
  );
}
