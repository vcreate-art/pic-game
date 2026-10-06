import type { BingoMode, BingoPattern } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectBingo, selectIsHost, useGame } from '../../store/game.js';
import { WinCount } from '../WinCount.js';
import { Avatar } from '../Avatar.js';
import { KickButton } from '../KickButton.js';
import { InviteCard } from '../InviteCard.js';
import { SettingsTitle } from '../SettingsTitle.js';

const MODES: { value: BingoMode; name: string; blurb: string }[] = [
  { value: 'turns', name: '5×5, take turns', blurb: 'Write 1–25 on your grid. Call numbers in turn; five lines spells BINGO.' },
  { value: 'caller', name: 'Classic 75-ball', blurb: 'Random cards, balls drawn on a clock. Daub fast and shout BINGO.' },
];

const PATTERNS: { value: BingoPattern; name: string; blurb: string }[] = [
  { value: 'line', name: 'One line', blurb: 'Any row, column or diagonal.' },
  { value: 'blackout', name: 'Full card', blurb: 'Every square. A long game.' },
];

const TURN_TIMES = [0, 10, 15, 20, 30, 60];
const CALL_TIMES = [0, 3, 5, 8, 12, 20];

export function BingoLobby() {
  const room = useGame(selectBingo);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  if (!room) return null;
  const { settings } = room.game;
  const turns = settings.mode === 'turns';
  const here = room.players.filter((p) => p.connected).length;
  const enough = !turns || here >= 2;

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
                <WinCount n={room.meta.wins[p.id]} />
              </li>
            ))}
          </ul>
        </div>

        <div className="lobby__settings card">
          <SettingsTitle>Game settings</SettingsTitle>

          <div className="settings__modes">
            <span className="settings__label">Game</span>
            <div className="modes">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  className={`mode ${settings.mode === m.value ? 'is-active' : ''}`}
                  disabled={!isHost}
                  aria-pressed={settings.mode === m.value}
                  onClick={() => socket.emit('bingo:settings', { mode: m.value })}
                >
                  <strong>{m.name}</strong>
                  <span>{m.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          {turns ? (
            <label className="settings__row bingolobby__row">
              <span className="settings__label">Time to call a number</span>
              <select
                className="spytimes__select"
                value={settings.turnSeconds}
                disabled={!isHost}
                onChange={(e) => socket.emit('bingo:settings', { turnSeconds: Number(e.target.value) })}
              >
                {TURN_TIMES.map((t) => <option key={t} value={t}>{t ? `${t}s` : 'No limit'}</option>)}
              </select>
            </label>
          ) : (
            <>
              <div className="settings__modes">
                <span className="settings__label">To win</span>
                <div className="modes">
                  {PATTERNS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      className={`mode ${settings.pattern === m.value ? 'is-active' : ''}`}
                      disabled={!isHost}
                      aria-pressed={settings.pattern === m.value}
                      onClick={() => socket.emit('bingo:settings', { pattern: m.value })}
                    >
                      <strong>{m.name}</strong>
                      <span>{m.blurb}</span>
                    </button>
                  ))}
                </div>
              </div>
              <label className="settings__row bingolobby__row">
                <span className="settings__label">A new ball every</span>
                <select
                  className="spytimes__select"
                  value={settings.callSeconds}
                  disabled={!isHost}
                  onChange={(e) => socket.emit('bingo:settings', { callSeconds: Number(e.target.value) })}
                >
                  {CALL_TIMES.map((t) => <option key={t} value={t}>{t ? `${t}s` : 'Host calls'}</option>)}
                </select>
              </label>
              <label className="settings__row bingolobby__row">
                <span className="settings__label">Daub cards for everyone</span>
                <input
                  type="checkbox"
                  className="bingolobby__check"
                  checked={settings.autoDaub}
                  disabled={!isHost}
                  onChange={(e) => socket.emit('bingo:settings', { autoDaub: e.target.checked })}
                />
              </label>
            </>
          )}

          <p className="settings__note settings__note--left">
            {turns
              ? 'Each full row, column or diagonal crosses out a letter. First to five lines wins; finish together and you share it.'
              : settings.autoDaub
                ? 'The app marks your card, but you still have to shout BINGO first.'
                : 'Tap called numbers to daub them. A BINGO that is not there locks you out for a few seconds.'}
          </p>

          {isHost ? (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={!enough}
              onClick={() => socket.emit('game:start')}
            >
              {enough ? (turns ? 'Hand out the grids' : 'Eyes down') : 'Needs two players'}
            </button>
          ) : (
            <p className="settings__note">Waiting for the host to start…</p>
          )}
        </div>
      </div>

    </div>
  );
}
