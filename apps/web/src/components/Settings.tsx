import { useEffect, useRef, useState } from 'react';
import {
  CUSTOM_WORDS, SETTINGS_BOUNDS, WORDS_EN, type RoomSettings, type WordMode, type WordSource,
} from '@pic-game/shared';
import posthog, { isPostHogEnabled } from '../lib/posthog.js';
import { getSocket } from '../net/socket.js';
import { selectIsHost, selectSkribbl, useGame } from '../store/game.js';

const FIELDS: Array<{ key: keyof typeof SETTINGS_BOUNDS; label: string; step: number }> = [
  { key: 'rounds', label: 'Rounds', step: 1 },
  { key: 'drawTime', label: 'Draw time (s)', step: 10 },
  { key: 'wordChoices', label: 'Word choices', step: 1 },
  { key: 'hints', label: 'Hints', step: 1 },
  { key: 'maxPlayers', label: 'Max players', step: 1 },
];

const SOURCES: Array<[WordSource, string, string]> = [
  ['builtin', 'Built-in', `${WORDS_EN.length} words.`],
  ['mixed', 'Mixed', 'Built-in plus yours.'],
  ['custom', 'Only mine', `Needs ${CUSTOM_WORDS.minForGame} or more.`],
];

export function Settings() {
  const settings = useGame((s) => selectSkribbl(s)?.settings);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  const saved = settings?.customWords ?? [];
  const [draft, setDraft] = useState(saved.join(', '));
  // Said only when a guest reaches for a setting, not all the time.
  const [told, setTold] = useState(false);
  const toldTimer = useRef<ReturnType<typeof setTimeout>>();
  const tell = () => {
    setTold(true);
    clearTimeout(toldTimer.current);
    toldTimer.current = setTimeout(() => setTold(false), 2400);
  };
  useEffect(() => () => clearTimeout(toldTimer.current), []);
  // Pick up the saved list when it changes elsewhere (another host, a reload).
  useEffect(() => setDraft(saved.join(', ')), [saved.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!settings) return null;

  const updateSettings = (change: Partial<Omit<RoomSettings, 'customWords'>>, setting: string) => {
    socket.emit('room:settings', change);
    if (isPostHogEnabled) posthog.capture('room_settings_changed', { setting });
  };

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
              onChange={(e) => updateSettings({ [key]: Number(e.target.value) }, key)}
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
              onClick={() => updateSettings({ wordMode: mode }, 'word_mode')}
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
      <div className="settings__modes">
        <span className="settings__label">
          {settings.wordMode === 'players' ? 'Words to fill the gaps' : 'Word pool'}
        </span>
        <div className="modes modes--3">
          {SOURCES.map(([source, label, blurb]) => (
            <button
              key={source}
              type="button"
              className={`mode ${settings.wordSource === source ? 'is-active' : ''}`}
              disabled={!isHost}
              aria-pressed={settings.wordSource === source}
              onClick={() => updateSettings({ wordSource: source }, 'word_source')}
            >
              <strong>{label}</strong>
              <span>{blurb}</span>
            </button>
          ))}
        </div>
        {settings.wordSource !== 'builtin' && (
          <div className="wordbox">
            <textarea
              className="wordbox__box"
              value={draft}
              readOnly={!isHost}
              onFocus={isHost ? undefined : tell}
              placeholder="Your words, separated by commas or new lines: inside jokes, a theme, anything drawable."
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
            />
            <div className="wordbox__foot">
              <span className={fewWords(settings) ? 'wordbox__count is-low' : 'wordbox__count'}>
                {settings.customWords.length} saved
              </span>
              {isHost && (
                <button type="button" className="tool" onClick={() => socket.emit('room:words', { text: draft })}>
                  Save words
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Disabled controls swallow taps, so a guest's tap lands on this
          instead, and gets told why nothing happens. The word list sits
          above it, to scroll and read. */}
      {!isHost && <div className={`settings__shield ${told ? 'is-on' : ''}`} aria-hidden="true" onClick={tell} />}
      {!isHost && (
        <p className={`settings__told ${told ? 'is-on' : ''}`} role="status">
          {told ? 'Only the host can change these.' : ''}
        </p>
      )}
    </div>
  );
}

/** "Only mine" with too few words to play. The server refuses to start too. */
export function fewWords(s: { wordSource: WordSource; customWords: string[] }): boolean {
  return s.wordSource === 'custom' && s.customWords.length < CUSTOM_WORDS.minForGame;
}
