import { useEffect, useRef } from 'react';
import { MAZE_COLORS } from '@pic-game/shared';
import { getMazeClient } from '../../maze/client.js';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectMaze, useGame } from '../../store/game.js';
import { Chat } from '../Chat.js';
import { MazeLobby } from './MazeLobby.js';
import { CONTROL_HELP, ControlsPicker, useMazeControls } from './controls.js';

const touchOnly = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

export function MazeGame({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectMaze);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const ref = useRef<HTMLCanvasElement>(null);
  const [controls, setControls] = useMazeControls();
  const game = room?.game;
  const playing = game?.phase === 'playing';

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !playing) return;
    const socket = getSocket();
    const client = getMazeClient();
    // Volatile: a lost input is replaced by the next a tick later, and one
    // queued behind a stall would only arrive stale.
    client.attach(canvas, (i) => socket.volatile.emit('maze:input', i));
    return () => client.detach();
  }, [playing]);

  const names = game?.players.map((id) => room?.players.find((p) => p.id === id)?.name ?? 'Gone') ?? [];
  const mySeat = me && game ? game.players.indexOf(me) : -1;
  useEffect(() => {
    if (!game || game.phase === 'lobby') return;
    getMazeClient().setMeta({
      seed: game.seed,
      cols: game.cols,
      rows: game.rows,
      mySeat,
      names,
      radar: game.settings.radar,
      endsAt: game.endsAt,
      live: game.phase === 'playing',
    });
  }, [game?.seed, game?.cols, game?.rows, mySeat, names.join('|'), game?.settings.radar, game?.endsAt, game?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!room || !me || !game) return null;
  if (game.phase === 'lobby') return <MazeLobby onLeave={onLeave} />;

  const ranked = game.players
    .map((id, seat) => ({ id, seat, ...(game.scores[id] ?? { kills: 0, deaths: 0 }) }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const name = (id: string) => (id === me ? 'You' : room.players.find((p) => p.id === id)?.name ?? 'Gone');

  return (
    <div className="game game--maze">
      <div className="mz">
        <div className="mz__stage">
          <canvas ref={ref} className="mz__canvas" />
          {game.phase === 'ended' && (
            <div className="mz__over">
              <h2>{game.winners.includes(me) ? 'You win!' : game.winners.length ? `${game.winners.map(name).join(' and ')} wins!` : 'Time!'}</h2>
              {isHost ? (
                <div className="mz__again">
                  <button type="button" className="btn btn--primary btn--lg" onClick={() => getSocket().emit('maze:rematch')}>
                    New maze, go again
                  </button>
                  <button type="button" className="btn" onClick={() => getSocket().emit('maze:toLobby')}>Back to the lobby</button>
                </div>
              ) : (
                <p>Waiting for the host…</p>
              )}
            </div>
          )}
          {mySeat >= 0 && playing && touchOnly() && (
            <p className="fstage__note">Maze Wars needs a keyboard.</p>
          )}
        </div>

        <aside className="mz__side">
          <section className="card mzscores">
            <h2 className="card__title">
              {game.settings.killLimit ? `First to ${game.settings.killLimit}` : 'Most kills'}
            </h2>
            <ol className="mzscores__list">
              {ranked.map((r, i) => (
                <li key={r.id} className={`${r.id === me ? 'is-me' : ''} ${game.winners.includes(r.id) ? 'is-winner' : ''}`}>
                  <span className="mzscores__rank">{i + 1}</span>
                  <span className="mzscores__dot" style={{ background: MAZE_COLORS[r.seat % MAZE_COLORS.length] }} />
                  <span className="mzscores__name">{name(r.id)}</span>
                  <span className="mzscores__k" title="Kills">{r.kills}</span>
                  <span className="mzscores__d" title="Deaths">{r.deaths}</span>
                </li>
              ))}
            </ol>
            <p className="settings__note settings__note--left">Kills · deaths.</p>
          </section>
          {mySeat >= 0 && (
            <section className="card mzside__controls">
              <h2 className="card__title">Controls</h2>
              <ControlsPicker value={controls} onChange={setControls} />
              <p className="settings__note settings__note--left">{CONTROL_HELP[controls]}</p>
            </section>
          )}
          <Chat />
          <button className="btn btn--danger" type="button" onClick={onLeave}>Leave room</button>
        </aside>
      </div>
    </div>
  );
}
