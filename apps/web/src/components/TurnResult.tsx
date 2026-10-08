import { useGame } from '../store/game.js';
import { Avatar } from './Avatar.js';

const REASON: Record<string, string> = {
  'timeout': "Time's up!",
  'all-guessed': 'Everybody got it!',
  'drawer-left': 'The drawer left.',
};

/** The word finally becomes public here — after the turn is over, when revealing
 *  it can no longer affect anyone's score. */
export function TurnResult() {
  const result = useGame((s) => s.turnResult);
  const players = useGame((s) => s.room?.players ?? []);
  const me = useGame((s) => s.me);
  if (!result) return null;

  const scored = players
    .map((p) => ({ ...p, delta: result.deltas[p.id] ?? 0 }))
    .sort((a, b) => b.delta - a.delta);

  return (
    <div className="overlay">
      <div className="overlay__card">
        <p className="overlay__kicker">{REASON[result.reason] ?? 'Round over'}</p>
        <h3 className="overlay__title">
          The word was <span className="reveal">{result.word}</span>
        </h3>
        <ul className="deltas">
          {scored.map((p) => (
            <li key={p.id} className="deltas__row">
              <Avatar data={p.avatar} size={28} />
              <span className="deltas__name">{p.name}</span>
              <span className={`deltas__pts ${p.delta > 0 ? 'is-gain' : 'is-zero'}`}>
                {p.delta > 0 ? `+${p.delta}` : '—'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
