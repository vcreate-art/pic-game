import { useEffect, useState } from 'react';
import {
  SPIES_BOUNDS, SPY_TEAMS, SPY_WORDS, type ClueMode, type SpyTeam, type WordSource,
} from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectSpies, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { KickButton } from '../KickButton.js';
import { InviteCard } from '../InviteCard.js';
import { SettingsTitle } from '../SettingsTitle.js';
import { WinsByGame } from '../WinsByGame.js';
import { Dots } from '../Dots.js';

export const TEAM_NAME: Record<SpyTeam, string> = { red: 'Red', blue: 'Blue' };

const TIMES = [0, 30, 60, 90, 120, 180];
const timeLabel = (s: number) => (s ? `${s}s` : 'Off');

const MODES: { value: ClueMode; name: string; blurb: string }[] = [
  { value: 'typed', name: 'Typed', blurb: 'Spymasters type the clue into the app.' },
  { value: 'spoken', name: 'In person', blurb: 'Play at a real table: clues out loud, anyone taps the cards.' },
];

const SOURCES: { value: WordSource; name: string; blurb: string }[] = [
  { value: 'builtin', name: 'Built-in', blurb: `${SPY_WORDS.length} words.` },
  { value: 'mixed', name: 'Mixed', blurb: 'Built-in plus yours.' },
  { value: 'custom', name: 'Only mine', blurb: `Needs ${SPIES_BOUNDS.customWords.minForGame} or more.` },
];

export function SpiesLobby() {
  const room = useGame(selectSpies);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  const saved = room?.game.settings.customWords ?? [];
  const [draft, setDraft] = useState(saved.join(', '));
  // Pick up the saved list when it changes elsewhere (another host, a reload).
  useEffect(() => setDraft(saved.join(', ')), [saved.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!room || !me) return null;
  const { game } = room;
  const { settings } = game;
  const seated = new Set(SPY_TEAMS.flatMap((t) => [game.teams[t].spymaster, ...game.teams[t].operatives]));
  const unassigned = room.players.filter((p) => !seated.has(p.id));
  const player = (id: string) => room.players.find((p) => p.id === id);
  const spoken = settings.clueMode === 'spoken';
  // At a real table the app is only the board, so nobody needs a seat in it.
  const ready = spoken || SPY_TEAMS.every((t) => game.teams[t].spymaster && game.teams[t].operatives.length > 0);
  const fewWords = settings.wordSource === 'custom' && settings.customWords.length < SPIES_BOUNDS.customWords.minForGame;

  const Member = ({ id, spy }: { id: string; spy?: boolean }) => {
    const p = player(id);
    if (!p) return null;
    return (
      <li className={`spyteam__member ${id === me ? 'is-me' : ''}`}>
        <Avatar data={p.avatar} size={26} host={p.id === room.hostId} />
        <span>{p.name}</span>
        <WinsByGame wins={room.meta.winsByGame[p.id]} />
        {spy && <span className="spyteam__tag">Spymaster</span>}
        {isHost && p.id !== room.hostId && <KickButton playerId={p.id} name={p.name} />}
      </li>
    );
  };

  return (
    <div className="lobbyscreen">
      <div className="spylobby">
        <InviteCard />

        <div className="spylobby__teams">
          {spoken && (
            <p className="settings__note settings__note--left spylobby__optional">
              Playing in person: sort out teams in the room. Seats here are optional; a
              spymaster can also call up the key on their phone once the board is dealt.
            </p>
          )}
          {SPY_TEAMS.map((team) => {
            const t = game.teams[team];
            const iAmSpy = t.spymaster === me;
            const iAmOp = t.operatives.includes(me);
            return (
              <section key={team} className={`card spyteam spyteam--${team}`}>
                <h2 className="spyteam__title">{TEAM_NAME[team]} team</h2>
                <ul className="spyteam__list">
                  {t.spymaster ? <Member id={t.spymaster} spy /> : <li className="spyteam__open">No spymaster yet</li>}
                  {t.operatives.map((id) => <Member key={id} id={id} />)}
                </ul>
                <div className="spyteam__actions">
                  {!t.spymaster && (
                    <button type="button" className="tool" onClick={() => socket.emit('spies:join', { team, role: 'spymaster' })}>
                      Be spymaster
                    </button>
                  )}
                  {!iAmOp && (
                    <button type="button" className="tool" onClick={() => socket.emit('spies:join', { team, role: 'operative' })}>
                      {iAmSpy ? 'Guess instead' : 'Join to guess'}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <section className="card spylobby__settings">
          <SettingsTitle>Game settings</SettingsTitle>

          {unassigned.length > 0 && (
            <p className="settings__note settings__note--left">
              Not on a team: {unassigned.map((p) => p.name).join(', ')}
            </p>
          )}
          {isHost && (
            <button type="button" className="btn" onClick={() => socket.emit('spies:shuffle')}>
              Shuffle everyone into teams
            </button>
          )}

          <div className="settings__modes">
            <span className="settings__label">Clues</span>
            <div className="modes">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  className={`mode ${settings.clueMode === m.value ? 'is-active' : ''}`}
                  disabled={!isHost}
                  aria-pressed={settings.clueMode === m.value}
                  onClick={() => socket.emit('spies:settings', { clueMode: m.value })}
                >
                  <strong>{m.name}</strong>
                  <span>{m.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings__modes">
            <span className="settings__label">Words</span>
            <div className="modes modes--3">
              {SOURCES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  className={`mode ${settings.wordSource === m.value ? 'is-active' : ''}`}
                  disabled={!isHost}
                  aria-pressed={settings.wordSource === m.value}
                  onClick={() => socket.emit('spies:settings', { wordSource: m.value })}
                >
                  <strong>{m.name}</strong>
                  <span>{m.blurb}</span>
                </button>
              ))}
            </div>
            {settings.wordSource !== 'builtin' && (
              <div className="wordbox">
                <textarea
                  className="wordbox__box"
                  value={draft}
                  readOnly={!isHost}
                  placeholder="Your words, separated by commas or new lines: inside jokes, a theme, anything."
                  onChange={(e) => setDraft(e.target.value)}
                  rows={4}
                />
                <div className="wordbox__foot">
                  <span className={fewWords ? 'wordbox__count is-low' : 'wordbox__count'}>
                    {settings.customWords.length} saved
                  </span>
                  {isHost && (
                    <button type="button" className="tool" onClick={() => socket.emit('spies:words', { text: draft })}>
                      Save words
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="spytimes">
            {(spoken
              ? ([['guessSeconds', 'Time per turn']] as const)
              : ([['clueSeconds', 'Time to give a clue'], ['guessSeconds', 'Time to guess']] as const)
            ).map(([k, label]) => (
              <label key={k} className="settings__row">
                <span className="settings__label">{label}</span>
                <select
                  className="spytimes__select"
                  value={settings[k]}
                  disabled={!isHost}
                  onChange={(e) => socket.emit('spies:settings', { [k]: Number(e.target.value) })}
                >
                  {TIMES.map((t) => <option key={t} value={t}>{timeLabel(t)}</option>)}
                </select>
              </label>
            ))}
          </div>

          {isHost ? (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={!ready || fewWords}
              onClick={() => socket.emit('game:start')}
            >
              {!ready ? 'Each team needs a spymaster and a guesser' : fewWords ? 'Add more of your words' : 'Deal the board'}
            </button>
          ) : (
            <p className="settings__note">
              {spoken ? <>Waiting for the host to deal<Dots /></> : 'Pick a team. The host deals when both are ready.'}
            </p>
          )}
        </section>
      </div>

    </div>
  );
}
