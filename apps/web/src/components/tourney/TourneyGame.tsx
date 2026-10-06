import { useEffect, useState } from 'react';
import { feeFor, riseAfter, standings, type Entrant, type TourneyState } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectTourney, useGame } from '../../store/game.js';
import { Chat } from '../Chat.js';
import { Circle } from './Circle.js';
import { Who, pts, saveBackup } from './common.js';
import { BONUS_SHORT, ReportSheet } from './ReportSheet.js';
import { Results } from './Results.js';
import { TourneyLobby } from './TourneyLobby.js';

/** What the last match did to each player's stack, for the leaderboard arrows. */
function lastChange(t: TourneyState): Map<string, number> {
  const h = t.history.at(-1);
  const out = new Map<string, number>();
  if (!h) return out;
  const stake = h.pot / 2;
  out.set(h.winner, stake + h.bonuses.reduce((s, b) => s + b.points, 0));
  out.set(h.winner === h.a ? h.b : h.a, -stake);
  return out;
}

function Fighter({ e, side }: { e: Entrant; side: 'a' | 'b' }) {
  return (
    <div className={`tfight__side tfight__side--${side}`}>
      <strong className="tfight__name">{e.name}</strong>
      <span className="tfight__main">{e.main ?? 'No main'}</span>
      <span className="tfight__stack">{pts(e.points)}</span>
      {e.streak >= 2 && <span className="tfight__streak">🔥 {e.streak} in a row</span>}
    </div>
  );
}

export function TourneyGame() {
  const room = useGame(selectTourney);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  const [reporting, setReporting] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const t = room?.game;

  // The host's device keeps a copy, in case the server restarts mid-tournament.
  useEffect(() => {
    if (room && t && isHost && t.phase !== 'setup') saveBackup(room.code, t);
  }, [room?.code, t, isHost]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (t?.phase !== 'fighting') setReporting(false);
    setConfirmEnd(false);
  }, [t?.phase, t?.turn]);

  if (!room || !t) return null;
  if (t.phase === 'setup') return <TourneyLobby />;

  const byId = (id: string) => t.entrants.find((e) => e.id === id)!;
  const ended = t.phase === 'ended';
  const fee = feeFor(t.settings, t.turn);
  const rising = !ended && riseAfter(t.settings, t.turn);
  const next = t.current ? [t.current.a, t.current.b] : t.queue[0];
  const change = lastChange(t);
  const alive = t.entrants.filter((e) => e.outOnTurn === null);
  const top = t.history.length ? Math.max(...alive.map((e) => e.points)) : null;
  /** Who could step into the match up next. */
  const subs = alive.filter((e) => next && !next.includes(e.id));

  return (
    <div className="game game--tourney">
      <header className="tbar">
        <span className="tbar__name">{t.settings.name}</span>
        {!ended && (
          <span className="tbar__meta">
            Lap {t.lap} · Turn {t.turn} · Entry <b>{pts(fee)}</b>
            {rising && <span className="tbar__rise">goes up after this turn</span>}
          </span>
        )}
      </header>

      <div className="tourney">
        <aside className="tourney__board card">
          <h2 className="card__title">Standings</h2>
          <ol className="tstand">
            {standings(t).map((e, i) => {
              const d = change.get(e.id);
              return (
                <li
                  key={e.id}
                  className={`tstand__row ${e.outOnTurn !== null ? 'is-out' : ''} ${e.points === top ? 'is-lead' : ''}`}
                >
                  <span className="tstand__rank">{i + 1}</span>
                  <Who e={e} small />
                  <span className="tstand__wl" title="Wins-losses">{e.wins}-{e.losses}</span>
                  {e.streak >= 2 && <span className="tstand__fire" title={`${e.streak} wins in a row`}>🔥{e.streak}</span>}
                  <span className="tstand__pts">
                    {e.outOnTurn !== null ? `Out T${e.outOnTurn}` : pts(e.points)}
                    {d !== undefined && <small className={d >= 0 ? 'is-up' : 'is-down'}>{d >= 0 ? `+${pts(d)}` : `−${pts(-d)}`}</small>}
                  </span>
                </li>
              );
            })}
          </ol>
        </aside>

        <main className="tourney__main">
          {ended ? (
            <Results t={t} isHost={isHost} />
          ) : next ? (
            <section className={`tfight ${t.phase === 'fighting' ? 'is-live' : ''}`}>
              <p className="tfight__kicker">{t.phase === 'fighting' ? 'Fight!' : 'Up next'}</p>
              <div className="tfight__card">
                <Fighter e={byId(next[0]!)} side="a" />
                <div className="tfight__vs">
                  <span>VS</span>
                  <small>{t.current ? `Pot ${pts(t.current.pot)}` : `Entry ${pts(fee)} each`}</small>
                  {t.current && t.current.stake < t.current.fee && <small className="tfight__allin">All-in!</small>}
                </div>
                <Fighter e={byId(next[1]!)} side="b" />
              </div>

              {isHost ? (
                t.phase === 'ready' ? (
                  <div className="tfight__actions">
                    <button type="button" className="btn btn--primary btn--lg tfight__go" onClick={() => socket.emit('tourney:startMatch')}>
                      Start the match
                    </button>
                    <details className="tswap">
                      <summary>Someone not here? Swap them out</summary>
                      <div className="tswap__row">
                        {([0, 1] as const).map((side) => (
                          <label key={side} className="tfield">
                            <span className="settings__label">Instead of {byId(next[side]!).name}</span>
                            <select
                              className="spytimes__select"
                              value=""
                              onChange={(e) => e.target.value && socket.emit('tourney:swap', { side, id: e.target.value })}
                            >
                              <option value="">Pick someone…</option>
                              {subs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="tfight__actions">
                    <button type="button" className="btn btn--primary btn--lg tfight__go" onClick={() => setReporting(true)}>
                      Report the result
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={() => socket.emit('tourney:cancel')}>
                      Call it off (entries back)
                    </button>
                  </div>
                )
              ) : (
                <p className="tfight__wait">
                  {t.phase === 'fighting' ? 'Best of 3, on the console. The host enters the result.' : 'Waiting for the host to start the match…'}
                </p>
              )}
            </section>
          ) : null}

          {isHost && !ended && (
            <div className="thost">
              <button type="button" className="btn" disabled={!t.canUndo} onClick={() => socket.emit('tourney:undo')}>
                Undo last result
              </button>
              {confirmEnd ? (
                <>
                  <span className="settings__note">End it now? The leader wins.</span>
                  <button type="button" className="btn btn--danger" onClick={() => socket.emit('tourney:end')}>End the tournament</button>
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirmEnd(false)}>Keep going</button>
                </>
              ) : (
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmEnd(true)}>End now…</button>
              )}
            </div>
          )}
          {isHost && ended && t.canUndo && (
            <div className="thost">
              <button type="button" className="btn" onClick={() => socket.emit('tourney:undo')}>Undo last result</button>
            </div>
          )}

          {!ended && (
            <section className="card tlap">
              <h2 className="card__title">Lap {t.lap}: everyone fights both neighbours</h2>
              <div className="tlap__body">
                <Circle t={t} />
                <div className="tlap__queue">
                  <span className="settings__label">Still to come this lap</span>
                  {t.queue.length > (t.phase === 'ready' ? 1 : 0) ? (
                    <ol>
                      {t.queue.slice(t.phase === 'ready' ? 1 : 0).map(([a, b], i) => (
                        <li key={`${a}-${b}-${i}`}>{byId(a).name} <span>vs</span> {byId(b).name}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="settings__note settings__note--left">
                      {t.phase === 'ready' ? 'The match up next ends the lap.' : 'This match ends the lap.'} Then a new circle is drawn.
                    </p>
                  )}
                </div>
              </div>
            </section>
          )}
        </main>

        <aside className="tourney__side">
          <section className="card thistory">
            <h2 className="card__title">Matches · {t.history.length}</h2>
            {t.history.length === 0 ? (
              <p className="settings__note settings__note--left">No results yet.</p>
            ) : (
              <ol className="thistory__list">
                {[...t.history].reverse().map((h) => {
                  const w = byId(h.winner);
                  const l = byId(h.winner === h.a ? h.b : h.a);
                  const extra = h.bonuses.reduce((s, b) => s + b.points, 0);
                  // Who played what, beside each name: the record keeps them by seat.
                  const as = (id: string) => {
                    const c = h.chars?.[id === h.a ? 'a' : 'b'];
                    return c ? <small> ({c})</small> : null;
                  };
                  return (
                    <li key={h.n} className="thistory__item">
                      <span className="thistory__turn">T{h.n}</span>
                      <span className="thistory__text">
                        <b>{w.name}</b>{as(w.id)} beat {l.name}{as(l.id)} {h.score}
                        {h.bonuses.length > 0 && (
                          <span className="thistory__bonus">
                            {h.bonuses.map((b) => <span key={b.kind} className="tchip">{BONUS_SHORT[b.kind]}</span>)}
                          </span>
                        )}
                      </span>
                      <span className="thistory__pts">+{pts(h.pot + extra)}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
          <Chat />
        </aside>
      </div>

      {reporting && t.phase === 'fighting' && <ReportSheet t={t} onClose={() => setReporting(false)} />}
    </div>
  );
}
