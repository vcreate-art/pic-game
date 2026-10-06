import { useState } from 'react';
import { TOURNEY_BOUNDS, feeFor, type TourneyBonuses, type TourneySettings } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectTourney, useGame } from '../../store/game.js';
import { InviteCard } from '../InviteCard.js';
import { MainSelect, NumberField, forgetBackup, loadBackup, pts } from './common.js';

const BONUS_LABELS: { key: keyof TourneyBonuses; name: string; note: string }[] = [
  { key: 'clean', name: 'Clean 2-0', note: 'automatic' },
  { key: 'streak', name: 'Win streak', note: 'per win in a row, from the 2nd' },
  { key: 'flawless', name: 'Flawless Victory', note: 'host ticks it' },
  { key: 'fatality', name: 'Fatality', note: 'host ticks it' },
  { key: 'brutality', name: 'Brutality', note: 'host ticks it' },
];

const RISE_EVERY = [0, 1, 2, 3, 4, 5, 6, 8, 10];
const RISE_BY = [10, 25, 50, 75, 100];

export function TourneyLobby() {
  const room = useGame(selectTourney);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  const [name, setName] = useState('');
  const [main, setMain] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [backup, setBackup] = useState(() => loadBackup());
  if (!room || !me) return null;

  const t = room.game;
  const s = t.settings;
  const mine = t.entrants.find((e) => e.playerId === me);
  const full = t.entrants.length >= TOURNEY_BOUNDS.entrants.max;
  const set = (patch: Partial<Omit<TourneySettings, 'bonuses'>> & { bonuses?: Partial<TourneyBonuses> }) =>
    socket.emit('tourney:settings', patch);
  const add = () => {
    if (!name.trim()) return;
    socket.emit('tourney:add', { name: name.trim(), main });
    setName('');
    setMain(null);
  };
  const preview = [1, 1 + s.riseEvery, 1 + 2 * s.riseEvery, 1 + 3 * s.riseEvery]
    .filter((n, i, all) => s.riseEvery > 0 || i === 0 || n !== all[0]);
  const showRestore = isHost && backup && backup.state.phase !== 'setup' && backup.code !== room.code;

  return (
    <div className="lobbyscreen">
      <div className="lobby tlobby">
        <InviteCard />

        <section className="lobby__players card tentrants">
          <h2 className="card__title">Players · {t.entrants.length}/{TOURNEY_BOUNDS.entrants.max}</h2>

          {isHost ? (
            <>
              <form
                className="tentrants__add"
                onSubmit={(e) => {
                  e.preventDefault();
                  add();
                }}
              >
                <input
                  className="field__input"
                  value={name}
                  maxLength={20}
                  placeholder="Add a player by name"
                  aria-label="Player name"
                  disabled={full}
                  onChange={(e) => setName(e.target.value)}
                />
                <MainSelect value={main} onChange={setMain} disabled={full} />
                <button type="submit" className="btn btn--primary" disabled={!name.trim() || full}>Add</button>
              </form>
              <button type="button" className="btn btn--ghost" disabled={full} onClick={() => socket.emit('tourney:addRoom')}>
                Add everyone in the room
              </button>
            </>
          ) : mine ? (
            <button type="button" className="btn" onClick={() => socket.emit('tourney:withdraw')}>Take me out</button>
          ) : (
            <button type="button" className="btn btn--primary" disabled={full} onClick={() => socket.emit('tourney:signUp')}>
              Sign me up
            </button>
          )}

          {t.entrants.length === 0 ? (
            <p className="settings__note settings__note--left">
              Nobody yet. Players with the app can sign themselves up; add everyone else by name.
            </p>
          ) : (
            <ol className="tentrants__list">
              {t.entrants.map((e, i) => (
                <li key={e.id} className={`tentrants__row ${e.playerId === me ? 'is-me' : ''}`}>
                  <span className="tentrants__n">{i + 1}</span>
                  <span className="tentrants__name">
                    {e.name}
                    {e.playerId && <span className="tentrants__app" title="Has the app open">📱</span>}
                  </span>
                  {isHost || e.playerId === me ? (
                    <MainSelect value={e.main} onChange={(m) => socket.emit('tourney:main', { id: e.id, main: m })} />
                  ) : (
                    <span className="tentrants__main">{e.main ?? '—'}</span>
                  )}
                  {isHost && (
                    <button
                      type="button"
                      className="kick"
                      aria-label={`Remove ${e.name}`}
                      onClick={() => socket.emit('tourney:remove', { id: e.id })}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="lobby__settings card tsettings">
          <h2 className="card__title">The rules</h2>

          {showRestore && (
            <div className="trestore">
              <span>
                Saved on this device: <b>{backup.state.settings.name}</b>, turn {backup.state.turn},{' '}
                {new Date(backup.savedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.
              </span>
              <div className="trestore__actions">
                <button type="button" className="btn btn--primary" onClick={() => socket.emit('tourney:restore', { state: backup.state })}>
                  Restore it
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => { forgetBackup(); setBackup(null); }}>
                  Forget it
                </button>
              </div>
            </div>
          )}

          <label className="tfield">
            <span className="settings__label">Name</span>
            <input
              className="field__input"
              value={title ?? s.name}
              maxLength={TOURNEY_BOUNDS.name.max}
              disabled={!isHost}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title !== null && title.trim() && title !== s.name) set({ name: title });
                setTitle(null);
              }}
            />
          </label>

          <div className="tgrid">
            <label className="tfield">
              <span className="settings__label">Starting points</span>
              <NumberField label="Starting points" value={s.startPoints} disabled={!isHost} step={100}
                {...TOURNEY_BOUNDS.startPoints} onCommit={(n) => set({ startPoints: n })} />
            </label>
            <label className="tfield">
              <span className="settings__label">Entry fee to start</span>
              <NumberField label="Entry fee" value={s.entryFee} disabled={!isHost}
                {...TOURNEY_BOUNDS.entryFee} onCommit={(n) => set({ entryFee: n })} />
            </label>
            <label className="tfield">
              <span className="settings__label">Fee goes up every</span>
              <select className="spytimes__select" value={s.riseEvery} disabled={!isHost}
                onChange={(e) => set({ riseEvery: Number(e.target.value) })}>
                {RISE_EVERY.map((n) => <option key={n} value={n}>{n ? `${n} turn${n === 1 ? '' : 's'}` : 'Never'}</option>)}
              </select>
            </label>
            <label className="tfield">
              <span className="settings__label">By</span>
              <select className="spytimes__select" value={s.risePercent} disabled={!isHost || !s.riseEvery}
                onChange={(e) => set({ risePercent: Number(e.target.value) })}>
                {[...new Set([...RISE_BY, s.risePercent])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>+{n}%</option>)}
              </select>
            </label>
          </div>
          <p className="tfees">
            {preview.map((n) => (
              <span key={n}>Turn {n}: <b>{pts(feeFor(s, n))}</b></span>
            ))}
            {s.riseEvery > 0 && <span>…</span>}
          </p>

          <div className="tbonuses">
            <span className="settings__label">Bonuses for the winner (0 turns one off)</span>
            {BONUS_LABELS.map((b) => (
              <label key={b.key} className="tbonus">
                <span className="tbonus__name">{b.name}<small>{b.note}</small></span>
                <NumberField label={b.name} value={s.bonuses[b.key]} disabled={!isHost}
                  {...TOURNEY_BOUNDS.bonus} onCommit={(n) => set({ bonuses: { [b.key]: n } })} />
              </label>
            ))}
          </div>

          <p className="settings__note settings__note--left">
            Players sit in a random circle and fight both neighbours, so everyone plays twice a lap.
            Each match is best of 3 on MK11; both players pay the entry and the winner takes the pot.
            Last one with points wins, or the host calls it and the leader does.
          </p>

          {isHost ? (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={t.entrants.length < TOURNEY_BOUNDS.entrants.min}
              onClick={() => socket.emit('game:start')}
            >
              {t.entrants.length < TOURNEY_BOUNDS.entrants.min ? 'Needs two players' : `Start: ${t.entrants.length} players`}
            </button>
          ) : (
            <p className="settings__note">Waiting for the host to start…</p>
          )}
        </section>
      </div>

    </div>
  );
}
