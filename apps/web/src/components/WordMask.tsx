import { useGame, selectIsDrawer } from '../store/game.js';

/**
 * The drawer sees the real word; everyone else sees the mask with whatever hint
 * letters have been revealed. There is no branch here that could show a guesser
 * the word, because `secret` is null on every client except the drawer's.
 */
export function WordMask() {
  const isDrawer = useGame(selectIsDrawer);
  const secret = useGame((s) => s.secret);
  const turn = useGame((s) => s.room?.turn);

  if (!turn) return null;

  if (isDrawer && secret) {
    return (
      <div className="wordmask">
        <span className="wordmask__label">Draw this</span>
        <span className="wordmask__word">{secret}</span>
      </div>
    );
  }

  const chars = [...turn.mask];
  const revealedCount = Object.keys(turn.revealed).length;

  return (
    <div className="wordmask">
      <span className="wordmask__label">
        Guess the word{revealedCount > 0 ? ` · ${revealedCount} hint${revealedCount > 1 ? 's' : ''}` : ''}
      </span>
      <span className="wordmask__slots">
        {chars.map((c, i) => {
          if (c === ' ') return <span key={i} className="wordmask__gap" />;
          const shown = turn.revealed[i];
          return (
            <span key={i} className={`wordmask__slot ${shown ? 'is-revealed' : ''}`}>
              {shown ?? (c === '-' ? '-' : '')}
            </span>
          );
        })}
      </span>
      <span className="wordmask__count" title="Letters in the word">
        {chars.filter((c) => c !== ' ').length}
      </span>
    </div>
  );
}
