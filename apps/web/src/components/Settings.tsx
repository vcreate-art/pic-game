import { SETTINGS_BOUNDS, type RoomSettings } from '@pic-game/shared';
import { getSocket } from '../net/socket.js';
import { selectIsHost, useGame } from '../store/game.js';

const FIELDS: Array<{ key: keyof RoomSettings; label: string; step: number }> = [
  { key: 'rounds', label: 'Rounds', step: 1 },
  { key: 'drawTime', label: 'Draw time (s)', step: 10 },
  { key: 'wordChoices', label: 'Word choices', step: 1 },
  { key: 'hints', label: 'Hints', step: 1 },
  { key: 'maxPlayers', label: 'Max players', step: 1 },
];

export function Settings() {
  const settings = useGame((s) => s.room?.settings);
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
      {!isHost && <p className="settings__note">Only the host can change these.</p>}
    </div>
  );
}
