import { getSocket } from '../net/socket.js';
import { selectIsHost, useGame } from '../store/game.js';
import { Avatar } from './Avatar.js';
import { GalleryButton } from './Gallery.js';
import { Dots } from './Dots.js';

export function Podium() {
  const final = useGame((s) => s.final);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  if (!final) return null;

  const ranked = [...final].sort((a, b) => b.score - a.score);
  const [first, second, third] = ranked;

  return (
    <div className="overlay">
      <div className="overlay__card overlay__card--wide">
        <p className="overlay__kicker">Game over</p>
        <h3 className="overlay__title">{first ? `${first.name} wins!` : 'Nobody wins'}</h3>

        <div className="podium">
          {[second, first, third].map((p, i) =>
            p ? (
              <div key={p.id} className={`podium__slot podium__slot--${[2, 1, 3][i]}`}>
                <Avatar data={p.avatar} size={48} />
                <span className="podium__name">{p.name}</span>
                <span className="podium__score">{p.score}</span>
                <div className="podium__block">{[2, 1, 3][i]}</div>
              </div>
            ) : (
              <div key={i} className="podium__slot podium__slot--empty" />
            ),
          )}
        </div>

        <ol className="podium__rest">
          {ranked.slice(3).map((p, i) => (
            <li key={p.id}>
              <span>{i + 4}.</span> {p.name} <strong>{p.score}</strong>
            </li>
          ))}
        </ol>

        <GalleryButton />

        {isHost ? (
          <button className="btn btn--primary" type="button" onClick={() => socket.emit('game:start')}>
            Play again
          </button>
        ) : (
          <p className="overlay__hint">Waiting for the host to start another game<Dots /></p>
        )}
      </div>
    </div>
  );
}
