import { useEffect, useMemo, useRef, useState } from 'react';
import { FIGHTERS, FIGHT_SIDES, type FightEnding, type FightSide } from '@pic-game/shared';
import { getFightView } from '../../fight/instance.js';
import type { FightMeta } from '../../fight/renderer.js';
import { msUntil } from '../../net/clock.js';
import { getSocket } from '../../net/socket.js';
import { selectFight, selectIsHost, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { Chat } from '../Chat.js';
import { FightLobby, SIDE_LABEL } from './FightLobby.js';
import { FightStage } from './FightStage.js';
import { Controls, MoveList } from './MoveList.js';

const ENDING: Record<NonNullable<FightEnding>, string> = {
  ko: 'Knockout',
  fatality: 'Fatality',
  timeout: 'Time',
  rounds: 'Five rounds, no decider',
  forfeit: 'Forfeit',
};

/** Re-renders on an interval, for countdowns. */
function useTick(ms: number, on: boolean): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms, on]);
}

export function FightGame({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectFight);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  const phase = room?.game.phase;

  // A new match starts from a clean picture, not the last one's blood.
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (phase === 'playing' && lastPhase.current !== 'playing') {
      getFightView().reset();
      // The lobby is long; the Fight button is usually below the fold.
      window.scrollTo({ top: 0 });
    }
    lastPhase.current = phase;
  }, [phase]);

  useTick(250, !!room?.game.paused);

  const players = room?.players;
  const game = room?.game;
  const meta = useMemo<FightMeta | null>(() => {
    if (!game || !players) return null;
    const { a, b } = game.picks;
    if (!a || !b) return null;
    const nameOf = (s: FightSide) => players.find((p) => p.id === game.seats[s])?.name ?? 'Gone';
    return {
      picks: { a, b },
      names: { a: nameOf('a'), b: nameOf('b') },
      blood: game.settings.blood,
      roundsToWin: game.settings.roundsToWin,
    };
  }, [game, players]);

  if (!room || !me || !game) return null;
  if (game.phase === 'lobby') return <FightLobby onLeave={onLeave} />;

  const mySide = FIGHT_SIDES.find((s) => game.seats[s] === me) ?? null;
  const playerOf = (s: FightSide) => room.players.find((p) => p.id === game.seats[s]) ?? null;
  const watching = room.players.filter((p) => !FIGHT_SIDES.some((s) => game.seats[s] === p.id));
  const paused = game.paused;
  const pausedName = paused ? playerOf(paused.side)?.name ?? SIDE_LABEL[paused.side] : '';
  const winnerPick = game.winner ? game.picks[game.winner] : null;
  const myPick = mySide ? game.picks[mySide] ?? null : null;

  return (
    <div className="game game--fight">
      <div className="fight">
        <div className="fight__main">
          <div className="fight__stage">
            {meta ? <FightStage meta={meta} mySide={mySide} live={game.phase === 'playing'} /> : null}

            {paused && game.phase === 'playing' && (
              <div className="overlay overlay--soft">
                <div className="overlay__card">
                  <p className="overlay__kicker">{paused.resuming ? 'Back in' : 'Connection lost'}</p>
                  <h3 className="overlay__title">
                    {paused.resuming
                      ? `Fight resumes in ${Math.ceil(msUntil(paused.until) / 1000)}`
                      : `Waiting for ${pausedName}`}
                  </h3>
                  {!paused.resuming && (
                    <p className="overlay__hint">
                      They forfeit in {Math.ceil(msUntil(paused.until) / 1000)}s if they don't return.
                    </p>
                  )}
                </div>
              </div>
            )}

            {game.phase === 'ended' && (
              <div className="overlay">
                <div className="overlay__card">
                  <p className="overlay__kicker">{game.reason ? ENDING[game.reason] : 'Match over'}</p>
                  <h3 className="overlay__title">
                    {winnerPick ? `${FIGHTERS[winnerPick].name} wins` : 'A draw'}
                  </h3>
                  {game.winner && (
                    <p className="overlay__hint">
                      {playerOf(game.winner)?.name ?? SIDE_LABEL[game.winner]} takes it{' '}
                      {game.wins.a}–{game.wins.b}
                    </p>
                  )}
                  <div className="overlay__actions">
                    {(isHost || mySide) && (
                      <button className="btn btn--primary" type="button" onClick={() => socket.emit('fight:rematch')}>
                        Rematch
                      </button>
                    )}
                    {isHost && (
                      <button className="btn" type="button" onClick={() => socket.emit('fight:toSelect')}>
                        Change fighters
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          <p className="fight__keys">
            <kbd>WASD</kbd> move · <kbd>U</kbd> <kbd>I</kbd> <kbd>J</kbd> <kbd>K</kbd> punch, punch, kick, kick ·{' '}
            <kbd>L</kbd>/<kbd>Space</kbd> block · <kbd>H</kbd> throw · <kbd>O</kbd> Fatal Blow ·{' '}
            <kbd>F2</kbd> hitboxes
          </p>

          {/* The move list stays in reach mid-fight: nobody remembers a
              fatality from the select screen. */}
          <section className="card roster fight__moves">
            {myPick ? (
              <div className="roster__info">
                <MoveList id={myPick} />
                <Controls />
              </div>
            ) : (
              <div className="roster__info roster__info--even">
                {FIGHT_SIDES.map((s) => {
                  const pick = game.picks[s];
                  return pick ? <MoveList key={s} id={pick} /> : null;
                })}
              </div>
            )}
          </section>
        </div>

        <div className="fight__side">
          <section className="card fight__card">
            <h2 className="card__title">{mySide ? `You are ${SIDE_LABEL[mySide]}` : 'Spectating'}</h2>
            <div className="seats">
              {FIGHT_SIDES.map((side) => {
                const p = playerOf(side);
                const pick = game.picks[side];
                return (
                  <div key={side} className={`seat ${game.seats[side] === me ? 'is-mine' : ''}`}>
                    <span className={`seat__chip seat__chip--${side === 'a' ? 'p1' : 'p2'}`}>{SIDE_LABEL[side]}</span>
                    <span className={p ? 'seat__who' : 'seat__open'}>
                      {p ? (
                        <>
                          <Avatar data={p.avatar} size={24} />
                          {p.name}
                          {pick && (
                            <span className="seat__pick" style={{ color: FIGHTERS[pick].color }}>
                              {FIGHTERS[pick].name}
                            </span>
                          )}
                        </>
                      ) : (
                        'left'
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {watching.length > 0 && (
              <p className="settings__note settings__note--left">
                Watching: {watching.map((p) => p.name).join(', ')}
              </p>
            )}
            <button className="btn btn--danger" type="button" onClick={onLeave}>
              Leave room
            </button>
          </section>
          <Chat />
        </div>
      </div>
    </div>
  );
}
