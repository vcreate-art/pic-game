import { useEffect, useState, type ReactNode } from 'react';
import { GAME_CAPACITY, type GameKind } from '@pic-game/shared';
import { getSocket } from '../net/socket.js';
import { selectIsHost, useGame } from '../store/game.js';
import { GameCovers } from './GameCovers.js';

/**
 * A lobby's settings card heading. For the host, a link in its corner leads
 * to another game: the card turns from this game's settings into every game
 * as a cover, and back. The settings are for this game, so that's where
 * you'd look for another, and nothing pops up over the lobby.
 *
 * The rest of the card is the lobby's own markup, so while the covers show
 * a CSS rule (`.card:has(.card__head.is-picking)`) hides it.
 */
export function SettingsTitle({ children }: { children: ReactNode }) {
  const room = useGame((s) => s.room);
  const isHost = useGame(selectIsHost);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const canPick = !!room && isHost && room.meta.stage === 'lobby';

  useEffect(() => {
    if (!canPick) setPicking(false);
  }, [canPick]);

  const pick = (kind: GameKind) => {
    setBusy(true);
    getSocket().emit('room:switch', { kind }, (r) => {
      setBusy(false);
      if (r.ok) setPicking(false);
      else useGame.getState().setNotice(r.message ?? 'Could not switch games.');
    });
  };

  const here = room?.players.length ?? 0;

  return (
    <>
      <div className={`card__head ${picking ? 'is-picking' : ''}`}>
        <h2 className="card__title">{picking ? 'Play something else' : children}</h2>
        {canPick && (
          <button
            type="button"
            className="switchgame__link"
            aria-expanded={picking}
            onClick={() => setPicking((v) => !v)}
          >
            {picking ? 'Back to settings' : 'Change game'}
          </button>
        )}
      </div>
      {picking && room && (
        <div className="switchgrid">
          <GameCovers
            onPick={pick}
            active={room.kind}
            note={(k) =>
              k === room.kind ? 'Playing now' : here > GAME_CAPACITY[k] ? `Seats ${GAME_CAPACITY[k]}` : busy ? '…' : null
            }
          />
        </div>
      )}
    </>
  );
}
