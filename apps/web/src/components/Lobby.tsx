import { useState } from 'react';
import { getSocket } from '../net/socket.js';
import { selectIsHost, useGame } from '../store/game.js';
import { Avatar } from './Avatar.js';
import { Settings } from './Settings.js';

export function Lobby() {
  const room = useGame((s) => s.room);
  const isHost = useGame(selectIsHost);
  const [copied, setCopied] = useState(false);
  const socket = getSocket();
  if (!room) return null;

  const link = `${window.location.origin}/room/${room.code}`;
  const enough = room.players.filter((p) => p.connected).length >= 2;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard needs a secure context; the link is on screen to copy by hand.
    }
  };

  return (
    <div className="lobby">
      <div className="lobby__invite card">
        <h2 className="card__title">Invite friends</h2>
        <div className="lobby__code">{room.code}</div>
        <button type="button" className="btn btn--ghost" onClick={copy}>
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
        <p className="lobby__link">{link}</p>
      </div>

      <div className="lobby__players card">
        <h2 className="card__title">
          In the room · {room.players.length}/{room.settings.maxPlayers}
        </h2>
        <ul className="lobby__grid">
          {room.players.map((p) => (
            <li key={p.id} className="lobby__player">
              <Avatar data={p.avatar} size={44} />
              <span>{p.name}</span>
              {p.id === room.hostId && <span className="tag tag--host">host</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="lobby__settings card">
        <h2 className="card__title">Game settings</h2>
        <Settings />
        {isHost ? (
          <button
            type="button"
            className="btn btn--primary btn--lg"
            disabled={!enough}
            onClick={() => socket.emit('game:start')}
          >
            {enough ? 'Start game' : 'Need 2+ players'}
          </button>
        ) : (
          <p className="settings__note">Waiting for the host to start…</p>
        )}
      </div>
    </div>
  );
}
