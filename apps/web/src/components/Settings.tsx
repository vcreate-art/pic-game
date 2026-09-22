import { SETTINGS_BOUNDS, type RoomSettings, type WordMode } from '@pic-game/shared';
import { getSocket } from '../net/socket.js';
import { selectIsHost, selectSkribbl, useGame } from '../store/game.js';

const FIELDS: Array<{ key: keyof typeof SETTINGS_BOUNDS; label: string; step: number }> = [
  { key: 'rounds', label: 'Rounds', step: 1 },
  { key: 'drawTime', label: 'Draw time (s)', step: 10 },
  { key: 'wordChoices', label: 'Word choices', step: 1 },
  { key: 'hints', label: 'Hints', step: 1 },
  { key: 'maxPlayers', label: 'Max players', step: 1 },
];

export function Settings() {
  const settings = useGame((s) => selectSkribbl(s)?.settings);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  if (!settings) return null;

  return (
    <div className="settings">
      {FIELDS.map(({ key, label, step }) => {
        const bounds = SETTINGS_BOUNDS[key];
        return (
          <label key={key} className="settings__row">
            <span className="settings__label">{label}</span>
            <input
              type="range"
              min={bounds.min}
              max={bounds.max}
              step={step}
              value={settings[key]}
              disabled={!isHost}
              onChange={(e) => socket.emit('room:settings', { [key]: Number(e.target.value) })}
            />
            <span className="settings__value">{settings[key]}</span>
          </label>
        );
      })}
      <div className="settings__modes">
        <span className="settings__label">Words</span>
        <div className="modes">
          {(
            [
              ['builtin', 'Built-in list', 'The game picks the words.'],
              ['players', 'Players suggest', 'Everyone else proposes a word for the drawer.'],
            ] as Array<[WordMode, string, string]>
          ).map(([mode, label, blurb]) => (
            <button
              key={mode}
              type="button"
              className={`mode ${settings.wordMode === mode ? 'is-active' : ''}`}
              disabled={!isHost}
              aria-pressed={settings.wordMode === mode}
              onClick={() => socket.emit('room:settings', { wordMode: mode })}
            >
              <strong>{label}</strong>
              <span>{blurb}</span>
            </button>
          ))}
        </div>
      </div>
      {settings.wordMode === 'players' && (
        <p className="settings__note">
          Whoever suggests the chosen word can’t score it, but earns points when others
          guess it. Works best with 4 or more players.
        </p>
      )}
      {!isHost && <p className="settings__note">Only the host can change these.</p>}
    </div>
  );
}
