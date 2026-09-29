import { CRYPTID_MAX_PLAYERS, CRYPTID_MIN_PLAYERS } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectCryptid, selectIsHost, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { InviteCard } from '../InviteCard.js';
import { KickButton } from '../KickButton.js';

const MODES = [
  { advanced: false, name: 'Standard', blurb: 'Every clue says where the creature could be. Six structures in three colours.' },
  { advanced: true, name: 'Advanced', blurb: 'Adds black structures, and clues that say where it is NOT. Harder to read.' },
];

export function CryptidLobby({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectCryptid);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  if (!room) return null;
  const { settings } = room.game;
  const here = room.players.filter((p) => p.connected).length;
  const enough = here >= CRYPTID_MIN_PLAYERS;

  return (
    <div className="lobbyscreen">
      <div className="lobby">
        <InviteCard />

        <div className="lobby__players card">
          <h2 className="card__title">Players · {room.players.length}</h2>
          <ul className="lobby__grid">
            {room.players.map((p) => (
              <li key={p.id} className="lobby__player">
                <Avatar data={p.avatar} size={44} host={p.id === room.hostId} />
                <span>{p.name}</span>
                {p.score > 0 && <span className="bingolobby__wins">{p.score} found</span>}
                {isHost && p.id !== room.hostId && <KickButton playerId={p.id} name={p.name} />}
              </li>
            ))}
          </ul>
        </div>

        <div className="lobby__settings card">
          <h2 className="card__title">Cryptid</h2>

          <div className="settings__modes">
            <span className="settings__label">Game</span>
            <div className="modes">
              {MODES.map((m) => (
                <button
                  key={m.name}
                  type="button"
                  className={`mode ${settings.advanced === m.advanced ? 'is-active' : ''}`}
                  disabled={!isHost}
                  aria-pressed={settings.advanced === m.advanced}
                  onClick={() => socket.emit('cryptid:settings', { advanced: m.advanced })}
                >
                  <strong>{m.name}</strong>
                  <span>{m.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <ol className="clobby__rules">
            <li>Everyone gets one secret clue. Together they point at exactly one space.</li>
            <li>On your turn, <b>question</b> a player about a space, or <b>search</b> one your clue allows.</li>
            <li>A disk means "could be here", a cube means "cannot be". Told no? You put down a cube too.</li>
            <li>Search the one space every clue allows, and you win.</li>
          </ol>

          <p className="settings__note settings__note--left">
            {CRYPTID_MIN_PLAYERS} to {CRYPTID_MAX_PLAYERS} players. Answers come from the app, so nobody can slip up
            or bluff. Anyone past {CRYPTID_MAX_PLAYERS} watches.
          </p>

          {isHost ? (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={!enough}
              onClick={() => socket.emit('game:start')}
            >
              {enough ? 'Deal the clues' : `Needs ${CRYPTID_MIN_PLAYERS} players`}
            </button>
          ) : (
            <p className="settings__note">Waiting for the host to start…</p>
          )}
        </div>
      </div>

      <div className="leavebar">
        <button className="btn btn--danger" type="button" onClick={onLeave}>
          Leave room
        </button>
      </div>
    </div>
  );
}
