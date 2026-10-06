import { useEffect, useState } from 'react';
import { GAME_CAPACITY, type GameKind } from '@pic-game/shared';
import { ArrowLeftRight, X } from 'lucide-react';
import { getSocket } from '../net/socket.js';
import { selectIsHost, useGame } from '../store/game.js';
import { GameCovers } from './GameCovers.js';

/**
 * The host's way to a different game, from the lobby only: an icon in the
 * corner of the settings card that opens every game as a cover, the same as
 * the front page.
 */
export function SwitchGame() {
  const room = useGame((s) => s.room);
  const isHost = useGame(selectIsHost);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const inLobby = room?.meta.stage === 'lobby';
  useEffect(() => {
    if (!inLobby) setOpen(false);
  }, [inLobby]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  if (!room || !isHost || !inLobby) return null;
  const here = room.players.length;

  const pick = (kind: GameKind) => {
    setBusy(true);
    getSocket().emit('room:switch', { kind }, (r) => {
      setBusy(false);
      if (r.ok) setOpen(false);
      else useGame.getState().setNotice(r.message ?? 'Could not switch games.');
    });
  };

  return (
    <>
      <button
        type="button"
        className="switchgame__btn"
        aria-label="Change game"
        title="Change game"
        onClick={() => setOpen(true)}
      >
        <ArrowLeftRight aria-hidden="true" />
      </button>
      {open && (
        <div className="sheet" onClick={() => setOpen(false)}>
          <div
            className="card sheet__card switchgame"
            role="dialog"
            aria-modal="true"
            aria-labelledby="switch-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="switchgame__head">
              <h2 id="switch-title" className="switchgame__title">Play something else</h2>
              <button type="button" className="sheet__close" aria-label="Close" onClick={() => setOpen(false)}>
                <X aria-hidden="true" />
              </button>
            </div>
            <p className="switchgame__sub">Everyone stays in the room, and tonight’s wins carry over.</p>
            <GameCovers
              onPick={pick}
              active={room.kind}
              note={(k) =>
                k === room.kind ? 'Playing now' : here > GAME_CAPACITY[k] ? `Seats ${GAME_CAPACITY[k]}` : busy ? '…' : null
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
