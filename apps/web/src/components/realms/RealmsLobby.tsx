import { REALMS_BOUNDS, REALMS_SIDES, type RealmsSide } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectRealms, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { KickButton } from '../KickButton.js';
import { InviteCard } from '../InviteCard.js';
import { SettingsTitle } from '../SettingsTitle.js';

const SEAT_LABEL: Record<RealmsSide, string> = { a: 'First player', b: 'Second player' };

export function RealmsLobby() {
  const room = useGame(selectRealms);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  if (!room || !me) return null;

  const { game } = room;
  const open = REALMS_SIDES.filter((s) => !game.seats[s]).length;
  const nameOf = (id: string | null | undefined) =>
    id ? room.players.find((p) => p.id === id)?.name : null;

  return (
    <div className="lobbyscreen">
      <div className="lobby">
        <InviteCard />

        <div className="lobby__players card">
          <h2 className="card__title">In the room · {room.players.length}</h2>
          <ul className="lobby__grid">
            {room.players.map((p) => {
              const side = REALMS_SIDES.find((s) => game.seats[s] === p.id) ?? null;
              return (
                <li key={p.id} className="lobby__player">
                  <Avatar data={p.avatar} size={44} host={p.id === room.hostId} />
                  <span>{p.name}</span>
                  {isHost && p.id !== room.hostId && <KickButton playerId={p.id} name={p.name} />}
                  {side && <span className="seat__chip seat__chip--w">{SEAT_LABEL[side]}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="lobby__settings card">
          <SettingsTitle>Game settings</SettingsTitle>

          <div className="seats">
            {REALMS_SIDES.map((side) => {
              const holder = game.seats[side] ?? null;
              const mine = holder === me;
              return (
                <div key={side} className={`seat ${mine ? 'is-mine' : ''}`}>
                  <span className="seat__chip seat__chip--w">{SEAT_LABEL[side]}</span>
                  <span className={holder ? 'seat__who' : 'seat__open'}>
                    {holder ? nameOf(holder) : 'open'}
                  </span>
                  {(!holder || mine) && (
                    <button
                      type="button"
                      className="tool"
                      onClick={() => socket.emit('realms:seat', { side: mine ? null : side })}
                    >
                      {mine ? 'Leave' : 'Sit'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="settings">
            <label className="settings__row">
              <span className="settings__label">Authority</span>
              <input
                type="range"
                min={REALMS_BOUNDS.startingAuthority.min}
                max={REALMS_BOUNDS.startingAuthority.max}
                step={5}
                value={game.settings.startingAuthority}
                disabled={!isHost}
                onChange={(e) =>
                  socket.emit('realms:settings', { startingAuthority: Number(e.target.value) })
                }
              />
              <span className="settings__value">{game.settings.startingAuthority}</span>
            </label>
            <p className="settings__note settings__note--left">
              Starting health. 50 is the standard game; drop it for a quicker one.
            </p>
          </div>

          {isHost ? (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={open > 0}
              onClick={() => socket.emit('game:start')}
            >
              {open > 0 ? `${open} more player${open > 1 ? 's' : ''} needed` : 'Start game'}
            </button>
          ) : (
            <p className="settings__note">
              {open > 0 ? 'Take a seat to play.' : 'Waiting for the host to start…'}
            </p>
          )}
        </div>
      </div>

    </div>
  );
}
