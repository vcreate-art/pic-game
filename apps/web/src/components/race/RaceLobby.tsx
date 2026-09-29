import { CHASER_PACES, LEVELS, type ChaserPace } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectRace, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { KickButton } from '../KickButton.js';
import { InviteCard } from '../InviteCard.js';

const PACE: Record<ChaserPace, { name: string; blurb: string }> = {
  off: { name: 'Off', blurb: 'No wall. Take your time.' },
  slow: { name: 'Lazy', blurb: 'It only catches stragglers.' },
  normal: { name: 'Hungry', blurb: 'Keep moving.' },
  fast: { name: 'Starving', blurb: 'No mistakes.' },
};

export function RaceControls() {
  return (
    <ul className="race__keys">
      <li><kbd>A</kbd> <kbd>D</kbd> or <kbd>←</kbd> <kbd>→</kbd> run</li>
      <li><kbd>Space</kbd> or <kbd>J</kbd> jump (hold for higher) · again in the air to double jump (wings on your back)</li>
      <li><kbd>Shift</kbd> or <kbd>K</kbd> dash · keep holding it on the ground to sprint</li>
      <li>After the double jump, hold <kbd>Space</kbd> while falling to glide</li>
      <li>Push into a wall to cling · jump off it and steer back to climb · <kbd>W</kbd>/<kbd>↑</kbd> climbs too</li>
      <li>A wall gives back your double jump and dash</li>
    </ul>
  );
}

export function RaceLobby({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectRace);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  if (!room) return null;
  const { game } = room;

  return (
    <div className="lobbyscreen">
      <div className="lobby">
        <InviteCard />

        <div className="lobby__players card">
          <h2 className="card__title">Racers · {room.players.length}</h2>
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
          <h2 className="card__title">The cup</h2>

          <div className="settings__modes">
            <span className="settings__label">Levels</span>
            <div className="modes modes--3">
              {LEVELS.map((lv, i) => (
                <button
                  key={lv.id}
                  type="button"
                  className={`mode ${game.settings.levels === i + 1 ? 'is-active' : ''}`}
                  disabled={!isHost}
                  aria-pressed={game.settings.levels === i + 1}
                  onClick={() => socket.emit('race:settings', { levels: i + 1 })}
                >
                  <strong>{i + 1} level{i ? 's' : ''}</strong>
                  <span>{LEVELS.slice(0, i + 1).map((l) => l.name).join(', ')}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings__modes">
            <span className="settings__label">The grinder (a wall that chases you)</span>
            <div className="modes modes--4">
              {CHASER_PACES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`mode ${game.settings.chaser === p ? 'is-active' : ''}`}
                  disabled={!isHost}
                  aria-pressed={game.settings.chaser === p}
                  onClick={() => socket.emit('race:settings', { chaser: p })}
                >
                  <strong>{PACE[p].name}</strong>
                  <span>{PACE[p].blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="race__rules">
            <RaceControls />
            <p className="settings__note settings__note--left">
              Dying sends you back to your last flag. Getting caught by the grinder
              ends your level. Points go 10, 8, 6, 5, 4, 3, 2, 1 by finishing place.
            </p>
          </div>

          {isHost ? (
            <button type="button" className="btn btn--primary btn--lg" onClick={() => socket.emit('game:start')}>
              Start the cup
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
