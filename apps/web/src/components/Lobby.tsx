import { useState } from 'react';
import { getSocket } from '../net/socket.js';
import { selectIsHost, selectSkribbl, useGame } from '../store/game.js';
import { Avatar } from './Avatar.js';
import { GalleryButton } from './Gallery.js';
import { InviteCard } from './InviteCard.js';
import { KickButton } from './KickButton.js';
import { Settings } from './Settings.js';

export function Lobby() {
  const room = useGame((s) => s.room);
  const isHost = useGame(selectIsHost);
  const maxPlayers = useGame((s) => selectSkribbl(s)?.settings.maxPlayers);
  const socket = getSocket();
  if (!room) return null;

  const enough = room.players.filter((p) => p.connected).length >= 2;


  return (
    <div className="lobby">
      <InviteCard />

      <div className="lobby__players card">
        <h2 className="card__title">
          In the room · {room.players.length}
          {maxPlayers ? `/${maxPlayers}` : ''}
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
        {/* The last game's drawings stay to hand after the podium times out. */}
        <GalleryButton className="btn btn--ghost lobby__gallery" />
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
