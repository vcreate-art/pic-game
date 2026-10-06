import { useCallback, useRef, useState } from 'react';
import { useDismiss } from '../lib/useDismiss.js';
import { selectIsHost, useGame } from '../store/game.js';
import { Avatar } from './Avatar.js';
import { KickButton } from './KickButton.js';
import { WinCount } from './WinCount.js';

/**
 * Everyone in the room, from the header, whatever game is running. Mid-game
 * most screens show only the people playing, so this is where the host finds
 * a watcher to remove, and anyone can see who is here and the session's wins.
 */
export function PeopleButton() {
  const room = useGame((s) => s.room);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(box, open, close);

  if (!room || !me) return null;
  const { players } = room;

  return (
    <div className="people" ref={box}>
      <button
        type="button"
        className="people__chip"
        aria-expanded={open}
        aria-label={`${players.length} in the room`}
        title="Who is in the room"
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">👥</span>
        {players.length}
      </button>
      {open && (
        <div className="people__pop card">
          <h2 className="card__title">In the room · {players.length}</h2>
          <ul className="people__list">
            {players.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'is-away'}>
                <Avatar data={p.avatar} size={26} host={p.id === room.hostId} />
                <span className="people__name">
                  {p.name}
                  {p.id === me && <em> (you)</em>}
                </span>
                {!p.connected && <span className="people__tag">away</span>}
                <WinCount n={room.meta.wins[p.id]} />
                {isHost && p.id !== room.hostId && <KickButton playerId={p.id} name={p.name} />}
              </li>
            ))}
          </ul>
          {room.meta.games > 0 && (
            <p className="profile__note">
              {room.meta.games} {room.meta.games === 1 ? 'game' : 'games'} played this session.
            </p>
          )}
          {isHost && players.length > 1 && (
            <p className="profile__note">Tap × and then Remove? to take someone out. They cannot rejoin this room.</p>
          )}
        </div>
      )}
    </div>
  );
}
