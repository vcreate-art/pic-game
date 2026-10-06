import { useEffect, useState, type CSSProperties } from 'react';
import { serverNow } from '../net/clock.js';
import { getSocket } from '../net/socket.js';
import { selectIsHost, useGame } from '../store/game.js';
import { Avatar } from './Avatar.js';
import { GAME_ICONS } from './gameIcons.js';

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Covers the game in its own colour while the host has it paused, so
 * nobody plays on by mistake, counts how long it has been, and shows how
 * tonight is going while everyone waits. The header stays usable above it.
 */
export function PausedOverlay() {
  // The countdown has the screen to itself while it runs.
  const paused = useGame((s) => (s.room?.meta.countdown ? null : s.room?.meta.paused ?? null));
  const meta = useGame((s) => s.room?.meta);
  const kind = useGame((s) => s.room?.kind);
  const players = useGame((s) => s.room?.players);
  const hostId = useGame((s) => s.room?.hostId);
  const isHost = useGame(selectIsHost);
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    if (!paused) return;
    setNow(serverNow());
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, [paused]);

  if (!paused || !kind || !meta || !players) return null;
  const nameOf = (id?: string) => players.find((p) => p.id === id)?.name ?? 'the host';
  const wins = meta.wins;
  // Most wins first; otherwise the order people arrived in.
  const board = [...players].sort((a, b) => (wins[b.id] ?? 0) - (wins[a.id] ?? 0));
  const shown = board.slice(0, 8);

  return (
    <div
      className="paused"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paused-title"
      style={{ '--game': GAME_ICONS[kind].color } as CSSProperties}
    >
      <div className="paused__inner">
        <h2 id="paused-title" className="paused__word">Paused</h2>
        <p className="paused__line">
          {isHost ? 'You paused the game' : `${nameOf(paused.by)} paused the game`}{' '}
          <span className="paused__time">{elapsed(now - paused.at)} ago</span>
        </p>
        {isHost ? (
          <button type="button" className="paused__resume" onClick={() => getSocket().emit('room:resume')}>
            Resume
          </button>
        ) : (
          <p className="paused__wait">Waiting for {nameOf(hostId)} to carry on.</p>
        )}

        <section className="paused__board" aria-labelledby="paused-board">
          <h3 id="paused-board" className="paused__boardh">
            Tonight
            <span className="paused__boardnote">
              {meta.games ? `${meta.games} ${meta.games === 1 ? 'game' : 'games'} played` : 'No games finished yet'}
            </span>
          </h3>
          <ol className="paused__rows">
            {shown.map((p) => {
              const n = wins[p.id] ?? 0;
              return (
                <li key={p.id} className={p.connected ? '' : 'is-away'}>
                  <Avatar data={p.avatar} size={26} host={p.id === hostId} />
                  <span className="paused__name">{p.name}</span>
                  <span className="paused__wins">{n ? `${n} ${n === 1 ? 'win' : 'wins'}` : ''}</span>
                </li>
              );
            })}
          </ol>
          {board.length > shown.length && (
            <p className="paused__more">and {board.length - shown.length} more</p>
          )}
        </section>
      </div>
    </div>
  );
}
