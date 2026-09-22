import { KUNGFU_BOUNDS, cooldownFor, type PieceType, type Side } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectKungFu, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { InviteCard } from '../InviteCard.js';

const SIDE_NAME: Record<Side, string> = { w: 'White', b: 'Black' };
/** Every piece, shortest rest first, so the slider means something concrete and
 *  the spread between light and heavy pieces is visible at a glance. */
const PIECE_ROWS: Array<[PieceType, string]> = [
  ['p', 'Pawn'],
  ['k', 'King'],
  ['n', 'Knight'],
  ['b', 'Bishop'],
  ['r', 'Rook'],
  ['q', 'Queen'],
];

export function KungFuLobby({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectKungFu);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  if (!room || !me) return null;

  const { game } = room;
  const bothSeated = !!game.seats.w && !!game.seats.b;
  const nameOf = (id: string | null) => (id ? room.players.find((p) => p.id === id)?.name : null);

  return (
    <div className="lobbyscreen">
      <div className="lobby">
        <InviteCard />

        <div className="lobby__players card">
          <h2 className="card__title">In the room · {room.players.length}</h2>
          <ul className="lobby__grid">
            {room.players.map((p) => {
              const side = game.seats.w === p.id ? 'w' : game.seats.b === p.id ? 'b' : null;
              return (
                <li key={p.id} className="lobby__player">
                  <Avatar data={p.avatar} size={44} host={p.id === room.hostId} />
                  <span>{p.name}</span>
                  {side && <span className={`seat__chip seat__chip--${side}`}>{SIDE_NAME[side]}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="lobby__settings card">
          <h2 className="card__title">Game settings</h2>

          <div className="seats">
            {(['w', 'b'] as Side[]).map((side) => {
              const holder = game.seats[side];
              const mine = holder === me;
              return (
                <div key={side} className={`seat ${mine ? 'is-mine' : ''}`}>
                  <span className={`seat__chip seat__chip--${side}`}>{SIDE_NAME[side]}</span>
                  <span className={holder ? 'seat__who' : 'seat__open'}>
                    {holder ? nameOf(holder) : 'open'}
                  </span>
                  <button
                    type="button"
                    className="tool"
                    onClick={() => socket.emit('chess:seat', { side: mine ? null : side })}
                    disabled={!!holder && !mine}
                  >
                    {mine ? 'Leave' : 'Sit'}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="settings">
            <label className="settings__row">
              <span className="settings__label">Cooldown</span>
              <input
                type="range"
                min={KUNGFU_BOUNDS.cooldownMs.min}
                max={KUNGFU_BOUNDS.cooldownMs.max}
                step={500}
                value={game.settings.cooldownMs}
                disabled={!isHost}
                onChange={(e) => socket.emit('chess:settings', { cooldownMs: Number(e.target.value) })}
              />
              <span className="settings__value">{(game.settings.cooldownMs / 1000).toFixed(1)}s</span>
            </label>

            {/* The slider sets a base; each piece scales off it, so show the
                spread rather than a single number that is true of nothing. */}
            <ul className="cooldowns">
              {PIECE_ROWS.map(([t, label]) => (
                <li key={t} className="cd-chip">
                  <span>{label}</span>
                  <strong>{(cooldownFor(t, game.settings.cooldownMs) / 1000).toFixed(1)}s</strong>
                </li>
              ))}
            </ul>

          </div>

          {isHost ? (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={!bothSeated}
              onClick={() => socket.emit('game:start')}
            >
              {bothSeated ? 'Start game' : 'Both sides needed'}
            </button>
          ) : (
            <p className="settings__note">
              {bothSeated ? 'Waiting for the host to start…' : 'Take a side to play.'}
            </p>
          )}
        </div>
      </div>

      <div className="leavebar">
        <button className="btn btn--danger" type="button" onClick={onLeave}>
          Leave room
        </button>
      </div>
    </div>
  );
}
