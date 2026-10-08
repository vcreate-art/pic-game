import { useEffect, useMemo, useRef, useState } from 'react';
import { AVATAR_COLORS, LEVELS, type Player } from '@pic-game/shared';
import { msUntil } from '../../net/clock.js';
import { getSocket } from '../../net/socket.js';
import { getRaceView } from '../../race/instance.js';
import { VIEW_H, VIEW_W, ordinal, type RaceMeta } from '../../race/view.js';
import { selectIsHost, selectRace, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { Chat } from '../Chat.js';
import { FullscreenButton } from '../FullscreenButton.js';
import { RaceControls, RaceLobby } from './RaceLobby.js';
import { Dots } from '../Dots.js';

const colorOf = (p: Player) => AVATAR_COLORS[p.avatar.color] ?? '#ef4444';

function useTick(ms: number, on: boolean): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms, on]);
}

function RaceStage({ meta }: { meta: RaceMeta }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const socket = getSocket();
    const view = getRaceView();
    view.attach(canvas, {
      pos: (seq, g) => socket.emit('race:pos', { seq, g }),
      checkpoint: (n) => socket.emit('race:checkpoint', { n }),
      died: (cause) => socket.emit('race:died', { cause }),
      finish: () => socket.emit('race:finish'),
      caught: () => socket.emit('race:caught'),
    });
    return () => view.detach();
  }, []);

  useEffect(() => {
    getRaceView().setMeta(meta);
  }, [meta]);

  return (
    <div className="fstage race__stage" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
      <canvas ref={ref} className="fstage__canvas" />
    </div>
  );
}

export function RaceGame() {
  const room = useGame(selectRace);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  const game = room?.game;
  const players = room?.players;

  useTick(250, game?.phase === 'results' || game?.phase === 'countdown');
  const stageRef = useRef<HTMLDivElement>(null);

  const meta = useMemo<RaceMeta | null>(() => {
    if (!game || !players) return null;
    const racing = !!me && game.racers.includes(me) && (game.phase === 'countdown' || game.phase === 'racing');
    return {
      me,
      level: game.level,
      startAt: game.startAt,
      pace: game.settings.chaser,
      racing,
      racers: players.map((p) => ({ id: p.id, name: p.name, color: colorOf(p) })),
    };
  }, [game, players, me]);

  if (!room || !game || !meta) return null;
  if (game.phase === 'lobby') return <RaceLobby />;

  const nameOf = (id: string) => room.players.find((p) => p.id === id);
  const standings = [...room.players].sort((a, b) => (game.points[b.id] ?? 0) - (game.points[a.id] ?? 0));
  const lastLeg = game.leg >= Math.min(game.settings.levels, LEVELS.length);
  const levelRows = Object.entries(game.results).sort(([, a], [, b]) => (a.place ?? 99) - (b.place ?? 99));

  return (
    <div className="game game--race">
      <div className="fight">
        <div className="fight__main">
          <div className="fight__stage" ref={stageRef} style={{ ['--ar' as string]: VIEW_W / VIEW_H }}>
            <RaceStage meta={meta} />

            {game.phase === 'results' && (
              <div className="overlay overlay--soft">
                <div className="overlay__card overlay__card--wide">
                  <p className="overlay__kicker">Level {game.leg} of {Math.min(game.settings.levels, LEVELS.length)}</p>
                  <h3 className="overlay__title">{LEVELS[game.level]?.name}</h3>
                  <table className="race__table">
                    <tbody>
                      {levelRows.map(([id, r]) => {
                        const p = nameOf(id);
                        return (
                          <tr key={id} className={id === me ? 'is-me' : ''}>
                            <td>{r.place ? ordinal(r.place) : '—'}</td>
                            <td className="race__who">{p && <Avatar data={p.avatar} size={22} />}{p?.name ?? 'Gone'}</td>
                            <td>{r.time !== null ? `${(r.time / 1000).toFixed(2)}s` : r.caught ? 'caught' : 'DNF'}</td>
                            <td>☠ {r.deaths}</td>
                            <td className="race__pts">+{r.points}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="overlay__hint">
                    {lastLeg ? 'Final standings' : 'Next level'} in {Math.ceil(msUntil(game.nextAt) / 1000)}s
                  </p>
                </div>
              </div>
            )}

            {game.phase === 'podium' && (
              <div className="overlay">
                <div className="overlay__card overlay__card--wide">
                  <p className="overlay__kicker">Cup over</p>
                  <h3 className="overlay__title">{standings[0] ? `${standings[0].name} wins the cup!` : 'Cup over'}</h3>
                  <div className="podium">
                    {[standings[1], standings[0], standings[2]].map((p, i) =>
                      p ? (
                        <div key={p.id} className={`podium__slot podium__slot--${[2, 1, 3][i]}`}>
                          <Avatar data={p.avatar} size={48} />
                          <span className="podium__name">{p.name}</span>
                          <span className="podium__score">{game.points[p.id] ?? 0}</span>
                          <div className="podium__block">{[2, 1, 3][i]}</div>
                        </div>
                      ) : (
                        <div key={i} className="podium__slot podium__slot--empty" />
                      ),
                    )}
                  </div>
                  {isHost ? (
                    <div className="overlay__actions">
                      <button className="btn btn--primary" type="button" onClick={() => socket.emit('game:start')}>
                        Run it back
                      </button>
                      <button className="btn" type="button" onClick={() => socket.emit('race:again')}>
                        Change the cup
                      </button>
                    </div>
                  ) : (
                    <p className="overlay__hint">Waiting for the host<Dots /></p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="stagebar">
            <FullscreenButton target={stageRef} />
          </div>
          <div className="card roster fight__moves">
            <RaceControls />
          </div>
        </div>

        <div className="fight__side">
          <section className="card fight__card">
            <h2 className="card__title">
              Level {game.leg} of {Math.min(game.settings.levels, LEVELS.length)}
            </h2>
            <ol className="race__standings">
              {standings.map((p) => (
                <li key={p.id} className={p.id === me ? 'is-me' : ''}>
                  <span className="race__dot" style={{ background: colorOf(p) }} />
                  <span className="race__name">{p.name}</span>
                  <strong>{game.points[p.id] ?? 0}</strong>
                </li>
              ))}
            </ol>
          </section>
          <Chat />
        </div>
      </div>
    </div>
  );
}
