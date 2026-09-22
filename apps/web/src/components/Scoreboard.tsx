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
          return (
            <li
              key={p.id}
              className={`scores__row ${guessed ? 'is-guessed' : ''} ${p.connected ? '' : 'is-away'}`}
            >
              <span className="scores__rank">{i + 1}</span>
              <Avatar data={p.avatar} size={32} />
              <span className="scores__name">
                {p.name}
                {p.id === me && <em> (you)</em>}
                {p.id === hostId && <span className="tag tag--host">host</span>}
              </span>
              <span className="scores__icons">
                {isDrawer && <span className="tag tag--drawing">drawing</span>}
                {guessed && <span className="tag tag--ok">guessed</span>}
                {!p.connected && <span className="tag tag--away">away</span>}
              </span>
              <span className="scores__pts">{p.score}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
