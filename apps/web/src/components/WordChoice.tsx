import { useState } from 'react';
import { SUGGEST_MAX_LEN, type SuggestAck } from '@pic-game/shared';
import { getSocket } from '../net/socket.js';
import { selectDrawer, selectIsDrawer, useGame } from '../store/game.js';
import { Timer } from './Timer.js';

/**
 * Shown over the canvas while the word is being settled.
 *
 * Three different views: the drawer picks, the other players suggest, and in
 * builtin mode everyone else just waits. Note the guessers' branches have no
 * access to the candidate words at all — the server sends `words` to the
 * drawer's socket alone, so there is nothing here to leak.
 */
export function WordChoice() {
  const choices = useGame((s) => s.choices);
  const endsAt = useGame((s) => s.chooseEndsAt);
  const isDrawer = useGame(selectIsDrawer);
  const drawer = useGame(selectDrawer);
  const suggest = useGame((s) => s.suggest);
  const mine = useGame((s) => s.mySuggestion);
  const error = useGame((s) => s.suggestError);
  const drawTotal = useGame((s) => s.room?.settings.wordChoices ?? 3);
  const [text, setText] = useState('');
  const socket = getSocket();

  if (isDrawer) {
    const waiting = suggest?.open && (choices?.length ?? 0) === 0;
    return (
      <div className="overlay">
        <div className="overlay__card">
          <p className="overlay__kicker">Your turn</p>
          <h3 className="overlay__title">{waiting ? 'Waiting for words…' : 'Pick a word'}</h3>
          <div className="wordchoice">
            {choices?.map((w) => (
              <button
                key={w.id}
                type="button"
                className="wordchoice__btn"
                onClick={() => socket.emit('word:choose', { id: w.id })}
              >
                {w.text}
              </button>
            ))}
          </div>
          {suggest?.open && (
            <p className="overlay__hint">
              {suggest.count === 0
                ? 'The others are thinking of words for you.'
                : `${suggest.count} suggested so far — more may still arrive.`}
            </p>
          )}
          {!suggest?.open && <p className="overlay__hint">One is picked for you when time runs out.</p>}
          {endsAt && <Timer endsAt={endsAt} total={suggest?.open ? 20 : 15} />}
        </div>
      </div>
    );
  }

  // Non-drawer, player-suggested mode: offer a word.
  if (suggest?.open) {
    const send = (e: React.FormEvent) => {
      e.preventDefault();
      const t = text.trim();
      if (!t) return;
      socket.emit('word:suggest', { text: t }, (res: SuggestAck) => {
        if (res.ok) {
          useGame.getState().setMySuggestion(res.text);
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
          <h3 className="overlay__title">
            Suggest a word for {drawer?.name ?? 'the drawer'}
          </h3>
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
              Yours: <strong>{mine}</strong>
              {' — '}
              <span>you can’t score it, but you earn points if others get it.</span>
            </p>
          )}
          <p className="overlay__hint">
            {suggest.count} of {drawTotal} slots filled. Hardest word that someone can still
            get wins you the most.
          </p>
          {endsAt && <Timer endsAt={endsAt} total={20} />}
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
