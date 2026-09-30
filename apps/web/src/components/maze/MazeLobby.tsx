import {
  MAZE_KILL_LIMITS, MAZE_MAX_PLAYERS, MAZE_MIN_PLAYERS, MAZE_MINUTES, MAZE_THEMES, MAZE_THEME_NAMES,
  type MazeRadar, type MazeThemeChoice,
} from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectMaze, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { InviteCard } from '../InviteCard.js';
import { KickButton } from '../KickButton.js';
import { CONTROL_HELP, ControlsPicker, useMazeControls } from './controls.js';

const THEMES: { value: MazeThemeChoice; name: string }[] = [
  { value: 'random', name: 'Surprise me' },
  ...MAZE_THEMES.map((t) => ({ value: t, name: MAZE_THEME_NAMES[t] })),
];

const RADARS: { value: MazeRadar; name: string; blurb: string }[] = [
  { value: 'all', name: 'Everyone', blurb: 'The mini map shows every player, all the time.' },
  { value: 'firing', name: 'Only when firing', blurb: 'A player shows up for three seconds after each shot. Sneaking pays.' },
];

export function MazeLobby({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectMaze);
  const isHost = useGame(selectIsHost);
  const [controls, setControls] = useMazeControls();
  const socket = getSocket();
  if (!room) return null;
  const { settings } = room.game;
  const here = room.players.filter((p) => p.connected).length;
  const enough = here >= MAZE_MIN_PLAYERS;

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
                {isHost && p.id !== room.hostId && <KickButton playerId={p.id} name={p.name} />}
                {p.score > 0 && <span className="bingolobby__wins">{p.score} win{p.score === 1 ? '' : 's'}</span>}
              </li>
            ))}
          </ul>
        </div>

        <div className="lobby__settings card">
          <h2 className="card__title">Maze Wars</h2>

          <label className="settings__row bingolobby__row">
            <span className="settings__label">Match length</span>
            <select
              className="spytimes__select"
              value={settings.minutes}
              disabled={!isHost}
              onChange={(e) => socket.emit('maze:settings', { minutes: Number(e.target.value) })}
            >
              {MAZE_MINUTES.map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </label>
          <label className="settings__row bingolobby__row">
            <span className="settings__label">Kill limit</span>
            <select
              className="spytimes__select"
              value={settings.killLimit}
              disabled={!isHost}
              onChange={(e) => socket.emit('maze:settings', { killLimit: Number(e.target.value) })}
            >
              {MAZE_KILL_LIMITS.map((k) => <option key={k} value={k}>{k ? `First to ${k}` : 'None: play the clock'}</option>)}
            </select>
          </label>

          <div className="settings__modes">
            <span className="settings__label">Mini map shows</span>
            <div className="modes">
              {RADARS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={`mode ${settings.radar === r.value ? 'is-active' : ''}`}
                  disabled={!isHost}
                  aria-pressed={settings.radar === r.value}
                  onClick={() => socket.emit('maze:settings', { radar: r.value })}
                >
                  <strong>{r.name}</strong>
                  <span>{r.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="settings__row bingolobby__row">
            <span className="settings__label">Look</span>
            <select
              className="spytimes__select"
              value={settings.theme}
              disabled={!isHost}
              onChange={(e) => socket.emit('maze:settings', { theme: e.target.value as MazeThemeChoice })}
            >
              {THEMES.map((t) => <option key={t.value} value={t.value}>{t.name}</option>)}
            </select>
          </label>
          <label className="settings__row bingolobby__row">
            <span className="settings__label">Fog: see only what you could</span>
            <input
              type="checkbox"
              className="bingolobby__check"
              checked={settings.fog}
              disabled={!isHost}
              onChange={(e) => socket.emit('maze:settings', { fog: e.target.checked })}
            />
          </label>
          <label className="settings__row bingolobby__row">
            <span className="settings__label">Power-ups</span>
            <input
              type="checkbox"
              className="bingolobby__check"
              checked={settings.powerups}
              disabled={!isHost}
              onChange={(e) => socket.emit('maze:settings', { powerups: e.target.checked })}
            />
          </label>

          <div className="settings__modes">
            <span className="settings__label">Your controls</span>
            <ControlsPicker value={controls} onChange={setControls} />
            <span className="settings__note settings__note--left">{CONTROL_HELP[controls]}</span>
          </div>

          <ol className="clobby__rules">
            <li>Five hits and you are out. You are back in a moment, far from everyone.</li>
            <li>Health comes back if you stay out of trouble for a few seconds.</li>
            {settings.powerups && (
              <li>
                Grab <b>Speed</b>, <b>Ghost missiles</b> (through walls) and <b>Spread shot</b>: they stack, up to
                three, and your second button uses the last one you picked up. A <b>Shield</b> goes on top of
                any of them, one at a time. A kill may swap stacks, and now and then everyone's get shuffled.
              </li>
            )}
          </ol>

          <p className="settings__note settings__note--left">
            {MAZE_MIN_PLAYERS} to {MAZE_MAX_PLAYERS} players, a new maze every match. Needs a keyboard.
          </p>

          {isHost ? (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={!enough}
              onClick={() => socket.emit('game:start')}
            >
              {enough ? 'Into the maze' : `Needs ${MAZE_MIN_PLAYERS} players`}
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
