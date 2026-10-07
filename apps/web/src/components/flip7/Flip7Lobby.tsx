import { FLIP7_BONUS, FLIP7_MAX_PLAYERS, FLIP7_MIN_PLAYERS, FLIP7_TARGETS } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectFlip7, selectIsHost, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { KickButton } from '../KickButton.js';
import { InviteCard } from '../InviteCard.js';
import { SettingsTitle } from '../SettingsTitle.js';
import { WinsByGame } from '../WinsByGame.js';
import { Dots } from '../Dots.js';

const LENGTHS: Record<number, string> = { 100: 'Quick', 150: 'Short', 200: 'The box', 300: 'Long' };

export function Flip7Lobby() {
  const room = useGame(selectFlip7);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  if (!room) return null;
  const { settings } = room.game;
  const here = room.players.filter((p) => p.connected).length;
  const enough = here >= FLIP7_MIN_PLAYERS;

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
                <WinsByGame wins={room.meta.winsByGame[p.id]} />
                {isHost && p.id !== room.hostId && <KickButton playerId={p.id} name={p.name} />}
              </li>
            ))}
          </ul>
        </div>

        <div className="lobby__settings card">
          <SettingsTitle>Game settings</SettingsTitle>

          <div className="settings__modes">
            <span className="settings__label">Play to</span>
            <div className="modes f7lobby__targets">
              {FLIP7_TARGETS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`mode ${settings.target === t ? 'is-active' : ''}`}
                  disabled={!isHost}
                  aria-pressed={settings.target === t}
                  onClick={() => socket.emit('flip7:settings', { target: t })}
                >
                  <strong>{t} points</strong>
                  <span>{LENGTHS[t]}</span>
                </button>
              ))}
            </div>
          </div>

          <ol className="clobby__rules">
            <li>On your turn, <b>hit</b> to flip another card or <b>stay</b> to bank your round.</li>
            <li>Flip a number you already have and you <b>bust</b>: nothing this round.</li>
            <li>Seven different numbers is a <b>Flip 7</b>: the round ends and you get +{FLIP7_BONUS}.</li>
            <li>Freeze, Flip Three and Second Chance go to whoever you pick. ×2 doubles your numbers.</li>
          </ol>

          <p className="settings__note settings__note--left">
            {FLIP7_MIN_PLAYERS} to {FLIP7_MAX_PLAYERS} players. First past the target at the end of a round wins.
          </p>

          {isHost ? (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={!enough}
              onClick={() => socket.emit('game:start')}
            >
              {enough ? 'Shuffle and deal' : `Needs ${FLIP7_MIN_PLAYERS} players`}
            </button>
          ) : (
            <p className="settings__note">Waiting for the host to start<Dots /></p>
          )}
        </div>
      </div>

    </div>
  );
}
