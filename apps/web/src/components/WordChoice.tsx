import { getSocket } from '../net/socket.js';
import { selectDrawer, selectIsDrawer, useGame } from '../store/game.js';
import { Timer } from './Timer.js';

/** Shown over the canvas while the drawer picks. Guessers reach the `else` branch,
 *  which has no access to the candidate words — the server never sent them. */
export function WordChoice() {
  const choices = useGame((s) => s.choices);
  const endsAt = useGame((s) => s.chooseEndsAt);
  const isDrawer = useGame(selectIsDrawer);
  const drawer = useGame(selectDrawer);
  const socket = getSocket();

  if (isDrawer && choices) {
    return (
      <div className="overlay">
        <div className="overlay__card">
          <p className="overlay__kicker">Your turn</p>
          <h3 className="overlay__title">Pick a word</h3>
          <div className="wordchoice">
            {choices.map((w, i) => (
              <button key={w} type="button" className="wordchoice__btn" onClick={() => socket.emit('word:choose', { index: i })}>
                {w}
              </button>
            ))}
          </div>
          {endsAt && <p className="overlay__hint">Auto-picks the first word when time runs out.</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div className="overlay__card">
        <p className="overlay__kicker">Get ready</p>
        <h3 className="overlay__title">{drawer?.name ?? 'Someone'} is choosing a word</h3>
        {endsAt && <Timer endsAt={endsAt} total={15} />}
      </div>
    </div>
  );
}
