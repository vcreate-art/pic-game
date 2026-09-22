import { useEffect, useState } from 'react';
import { maskOf } from '@pic-game/shared';
import { useGame, selectIsDrawer, selectSkribbl } from '../store/game.js';

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

/** The blanks, with any revealed hint letters filled in. */
function Slots({ mask, revealed }: { mask: string; revealed: Record<number, string> }) {
  return (
    <span className="wordmask__slots">
      {[...mask].map((c, i) => {
        if (c === ' ') return <span key={i} className="wordmask__gap" />;
        const shown = revealed[i];
        return (
          <span key={i} className={`wordmask__slot ${shown ? 'is-revealed' : ''}`}>
            {shown ?? (c === '-' ? '-' : '')}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The drawer sees the real word; everyone else sees the mask plus whatever hint
 * letters have been revealed. There is no branch that could show a guesser the
 * word, because `secret` is null on every client except the drawer's.
 */
export function WordMask() {
  const isDrawer = useGame(selectIsDrawer);
  const secret = useGame((s) => s.secret);
  const turn = useGame((s) => selectSkribbl(s)?.turn);
  const [hidden, setHidden] = useState(false);

  // Every new word starts visible — you cannot draw what you cannot read. The
  // toggle is for hiding it again once you have it, with someone looking on.
  useEffect(() => setHidden(false), [secret]);

  if (!turn) return null;

  if (isDrawer && secret) {
    return (
      <div className="wordmask">
        <span className="wordmask__label">Draw this</span>
        <div className="wordmask__row">
          {hidden ? (
            <Slots mask={maskOf(secret)} revealed={{}} />
          ) : (
            <span className="wordmask__word">{secret}</span>
          )}
          <button
            type="button"
            className="wordmask__eye"
            onClick={() => setHidden((h) => !h)}
            aria-pressed={hidden}
            aria-label={hidden ? 'Show the word' : 'Hide the word'}
            title={hidden ? 'Show the word' : 'Hide the word'}
          >
            <EyeIcon off={hidden} />
          </button>
        </div>
      </div>
    );
  }

  // While the drawer is still picking there is no word yet, so there are no
  // slots to show and a "0" count would be noise.
  if (!turn.mask) {
    return (
      <div className="wordmask">
        <span className="wordmask__label">Get ready</span>
      </div>
    );
  }

  const revealedCount = Object.keys(turn.revealed).length;
  // Underscores mark letters; spaces and hyphens are shown literally, so only
  // the underscores are worth counting.
  const letters = (turn.mask.match(/_/g) ?? []).length;

  return (
    <div className="wordmask">
      <span className="wordmask__label">
        Guess the word
        {revealedCount > 0 ? ` · ${revealedCount} hint${revealedCount > 1 ? 's' : ''}` : ''}
      </span>
      <div className="wordmask__row">
        <Slots mask={turn.mask} revealed={turn.revealed} />
        <span className="wordmask__count" title="Letters in the word">
          {letters}
        </span>
      </div>
    </div>
  );
}
