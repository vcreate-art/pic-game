import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { GAME_CAPACITY, GAME_LABELS, PLAYABLE_KINDS, type GameKind } from '@pic-game/shared';
import { ChevronDown } from 'lucide-react';
import { useDismiss } from '../lib/useDismiss.js';
import { getSocket } from '../net/socket.js';
import { useLeaveRoom } from '../net/useLeaveRoom.js';
import { selectIsHost, useGame } from '../store/game.js';
import { GAME_ICONS } from './gameIcons.js';

/**
 * The room's own controls, in the header over every game: which game is on,
 * and for the host, switching to another between games. Leaving is here for
 * everyone, whatever screen the game shows.
 */
export function RoomMenu() {
  const room = useGame((s) => s.room);
  const isHost = useGame(selectIsHost);
  const leave = useLeaveRoom();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(box, open, close);

  if (!room) return null;
  const { icon: Icon, color } = GAME_ICONS[room.kind];
  const canSwitch = room.meta.can.switch;
  const here = room.players.length;

  const switchTo = (kind: GameKind) => {
    setBusy(true);
    getSocket().emit('room:switch', { kind }, (r) => {
      setBusy(false);
      if (r.ok) setOpen(false);
      else useGame.getState().setNotice(r.message ?? 'Could not switch games.');
    });
  };

  return (
    <div className="roommenu" ref={box} style={{ '--game': color } as CSSProperties}>
      <button
        type="button"
        className="roommenu__chip"
        aria-expanded={open}
        aria-label={`Room menu, playing ${GAME_LABELS[room.kind].name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon className="roommenu__icon" aria-hidden="true" />
        <span className="roommenu__name">{GAME_LABELS[room.kind].name}</span>
        <ChevronDown className="roommenu__caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="roommenu__pop card">
          {isHost ? (
            <section className="roommenu__section" aria-labelledby="roommenu-switch">
              <h2 id="roommenu-switch" className="card__title">Switch game</h2>
              {!canSwitch && <p className="profile__note">Finish or end this game first.</p>}
              <ul className="roommenu__games">
                {PLAYABLE_KINDS.map((k) => {
                  const { icon: GameIcon, color: c } = GAME_ICONS[k];
                  const current = k === room.kind;
                  const tooBig = here > GAME_CAPACITY[k];
                  const why = current
                    ? 'Playing now'
                    : tooBig
                      ? `Seats ${GAME_CAPACITY[k]}`
                      : null;
                  return (
                    <li key={k}>
                      <button
                        type="button"
                        className={`roommenu__game ${current ? 'is-current' : ''}`}
                        style={{ '--game': c } as CSSProperties}
                        disabled={current || tooBig || !canSwitch || busy}
                        onClick={() => switchTo(k)}
                      >
                        <GameIcon className="roommenu__gicon" aria-hidden="true" />
                        <span className="roommenu__gname">{GAME_LABELS[k].name}</span>
                        {why && <span className="roommenu__why">{why}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <p className="profile__note">The host picks the game. Everyone stays in the room when they switch.</p>
          )}
          <button type="button" className="btn btn--danger" onClick={leave}>
            Leave room
          </button>
        </div>
      )}
    </div>
  );
}
