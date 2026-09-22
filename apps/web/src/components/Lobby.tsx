import { useState } from 'react';
import { copyText } from '../lib/clipboard.js';
import { getSocket } from '../net/socket.js';
import { selectIsHost, useGame } from '../store/game.js';
import { Avatar } from './Avatar.js';
import { KickButton } from './KickButton.js';
import { Settings } from './Settings.js';

export function Lobby() {
  const room = useGame((s) => s.room);
  const isHost = useGame(selectIsHost);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');
  const socket = getSocket();
  if (!room) return null;

  const link = `${window.location.origin}/room/${room.code}`;
  const enough = room.players.filter((p) => p.connected).length >= 2;

  const copy = async () => {
    const ok = await copyText(link);
    setCopyState(ok ? 'ok' : 'failed');
    setTimeout(() => setCopyState('idle'), 2400);
  };

  return (
    <div className="lobby">
      <div className="lobby__invite card">
        <h2 className="card__title">Invite friends</h2>
        <div className="lobby__code">{room.code}</div>
        <button type="button" className="btn btn--ghost" onClick={copy}>
          {copyState === 'ok' ? 'Link copied' : copyState === 'failed' ? 'Copy it below' : 'Copy invite link'}
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
              <Avatar data={p.avatar} size={44} host={p.id === room.hostId} />
              <span>{p.name}</span>
              {isHost && p.id !== room.hostId && <KickButton playerId={p.id} name={p.name} />}
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
