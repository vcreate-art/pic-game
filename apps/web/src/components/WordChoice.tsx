import { useState } from 'react';
import {
  CHOOSE_SECONDS, SUGGEST_SECONDS, SUGGEST_MAX_LEN, type SuggestAck,
} from '@pic-game/shared';
import posthog, { isPostHogEnabled } from '../lib/posthog.js';
import { getSocket } from '../net/socket.js';
import { selectDrawer, selectIsDrawer, useGame } from '../store/game.js';
import { Timer } from './Timer.js';

/**
 * Shown over the canvas while the word is being settled. Four views: the drawer
 * waiting on suggestions, the drawer picking, a player writing a suggestion, and
 * everyone else waiting.
 *
 * The guesser branches have no access to the candidate words at all — the server
 * sends them to the drawer's socket alone, and only once collecting has closed.
 */
export function WordChoice() {
  const choices = useGame((s) => s.choices);
  const endsAt = useGame((s) => s.chooseEndsAt);
  const isDrawer = useGame(selectIsDrawer);
  const drawer = useGame(selectDrawer);
  const suggest = useGame((s) => s.suggest);
  const mine = useGame((s) => s.mySuggestion);
  const error = useGame((s) => s.suggestError);
  const [text, setText] = useState('');
  const socket = getSocket();

  const collecting = !!suggest && !suggest.ready;
  const total = collecting ? SUGGEST_SECONDS : CHOOSE_SECONDS;
  const remaining = suggest ? Math.max(0, suggest.expected - suggest.count) : 0;

  // --- drawer, still waiting on the others ---
  if (isDrawer && collecting) {
    return (
      <div className="overlay">
        <div className="overlay__card">
          <p className="overlay__kicker">Your turn</p>
          <h3 className="overlay__title">Waiting for words…</h3>
          <Tally count={suggest.count} expected={suggest.expected} />
          <p className="overlay__hint">
            {remaining === 0
              ? 'Everyone is in — here we go.'
              : `${remaining} more ${remaining === 1 ? 'player' : 'players'} to go. Anyone who drops out stops counting.`}
          </p>
          {endsAt && <Timer endsAt={endsAt} total={total} />}
        </div>
      </div>
    );
  }

  // --- drawer, picking ---
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
          {endsAt && <Timer endsAt={endsAt} total={total} />}
        </div>
      </div>
    );
  }

  // --- a player writing their suggestion ---
  if (suggest?.open) {
    const send = (e: React.FormEvent) => {
      e.preventDefault();
      const t = text.trim();
      if (!t) return;
      socket.emit('word:suggest', { text: t }, (res: SuggestAck) => {
        if (res.ok) {
          useGame.getState().setMySuggestion(res.text);
          if (isPostHogEnabled) posthog.capture('word_suggested');
          setText('');
        } else {
          useGame.getState().setSuggestError(res.message);
        }
      });
    };

    return (
      <div className="overlay">
        <div className="overlay__card">
          <p className="overlay__kicker">Set the challenge</p>
          <h3 className="overlay__title">Suggest a word for {drawer?.name ?? 'the drawer'}</h3>
          <form className="suggest" onSubmit={send}>
            <input
              className="field__input"
              value={text}
              maxLength={SUGGEST_MAX_LEN + 6}
              placeholder={mine ? 'Change your word…' : 'e.g. lighthouse'}
              onChange={(e) => setText(e.target.value)}
              aria-label="Your suggested word"
              autoFocus
            />
            <button className="btn btn--primary" type="submit" disabled={!text.trim()}>
              {mine ? 'Replace' : 'Suggest'}
            </button>
          </form>
          {error && <p className="field__error">{error}</p>}
          {mine && (
            <p className="suggest__mine">
              Yours: <strong>{mine}</strong> — you can’t score it, but you earn points if
              others get it.
            </p>
          )}
          <Tally count={suggest.count} expected={suggest.expected} />
          <p className="overlay__hint">
            {mine
              ? remaining === 0
                ? 'Everyone is in.'
                : `Waiting for ${remaining} more. You can still change yours.`
              : 'Hardest word that someone can still get wins you the most.'}
          </p>
          {endsAt && <Timer endsAt={endsAt} total={total} />}
        </div>
      </div>
    );
  }

  // --- everyone else, while the drawer picks ---
  return (
    <div className="overlay">
      <div className="overlay__card">
        <p className="overlay__kicker">Get ready</p>
        <h3 className="overlay__title">{drawer?.name ?? 'Someone'} is choosing a word</h3>
        {endsAt && <Timer endsAt={endsAt} total={total} />}
      </div>
    </div>
  );
}

/** One pip per expected player, filled as their word lands. */
function Tally({ count, expected }: { count: number; expected: number }) {
  if (expected <= 0) return null;
  return (
    <div className="tally" role="img" aria-label={`${count} of ${expected} players have suggested`}>
      {Array.from({ length: expected }, (_, i) => (
        <span key={i} className={`tally__pip ${i < count ? 'is-in' : ''}`} />
      ))}
      <span className="tally__label">
        {count}/{expected}
      </span>
    </div>
  );
}
