import { CHOOSE_SECONDS } from '@pic-game/shared';
import posthog, { isPostHogEnabled } from '../lib/posthog.js';
import { getSocket } from '../net/socket.js';
import { selectDrawer, selectIsDrawer, useGame } from '../store/game.js';
import { Timer } from './Timer.js';

/**
 * Shown over the canvas while the word is being picked: the drawer choosing
 * from their options, everyone else waiting. The guessers' view has no access
 * to the options at all; the server sends them to the drawer's socket alone.
 */
export function WordChoice() {
  const choices = useGame((s) => s.choices);
  const endsAt = useGame((s) => s.chooseEndsAt);
  const isDrawer = useGame(selectIsDrawer);
  const drawer = useGame(selectDrawer);
  const socket = getSocket();

  if (isDrawer) {
    return (
      <div className="overlay">
        <div className="overlay__card">
          <p className="overlay__kicker">Your turn</p>
          <h3 className="overlay__title">Pick a word</h3>
          <div className="wordchoice">
            {choices?.map((w) => (
              <button
                key={w.id}
                type="button"
                className="wordchoice__btn"
                onClick={() => {
                  socket.emit('word:choose', { id: w.id });
                  if (isPostHogEnabled) posthog.capture('word_chosen');
                }}
              >
                {w.text}
              </button>
            ))}
          </div>
          <p className="overlay__hint">One is picked for you when time runs out.</p>
          {endsAt && <Timer endsAt={endsAt} total={CHOOSE_SECONDS} />}
        </div>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div className="overlay__card">
        <p className="overlay__kicker">Get ready</p>
        <h3 className="overlay__title">{drawer?.name ?? 'Someone'} is choosing a word</h3>
        {endsAt && <Timer endsAt={endsAt} total={CHOOSE_SECONDS} />}
      </div>
    </div>
  );
}
