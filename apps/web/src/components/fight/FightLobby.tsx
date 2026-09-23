import { useState } from 'react';
import {
  FIGHTER_IDS, FIGHT_BOUNDS, FIGHT_SIDES, FIGHTERS, type FightSide, type FighterId,
} from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectFight, selectIsHost, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { InviteCard } from '../InviteCard.js';
import { FighterCard } from './FighterCard.js';
import { Controls, MoveList } from './MoveList.js';

export const SIDE_LABEL: Record<FightSide, string> = { a: 'Player 1', b: 'Player 2' };

const ROUND_MODES = [
  { value: 1, name: 'One round', blurb: 'Sudden death.' },
  { value: 2, name: 'Best of 3', blurb: 'The standard match.' },
  { value: 3, name: 'Best of 5', blurb: 'For a grudge.' },
];

export function FightLobby({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectFight);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  const [hovered, setHovered] = useState<FighterId | null>(null);
  if (!room || !me) return null;

  const { game } = room;
  const mySide = FIGHT_SIDES.find((s) => game.seats[s] === me) ?? null;
  const myPick = mySide ? game.picks[mySide] ?? null : null;
  const look = hovered ?? myPick ?? 'ember';
  const nameOf = (id: string | null | undefined) =>
    id ? room.players.find((p) => p.id === id)?.name : null;
  const missing = FIGHT_SIDES.filter((s) => !game.seats[s] || !game.picks[s]).length;

  return (
    <div className="lobbyscreen">
      <div className="lobby lobby--fight">
        <InviteCard />

        <div className="lobby__settings card">
          <h2 className="card__title">Match settings</h2>

          <div className="seats">
            {FIGHT_SIDES.map((side) => {
              const holder = game.seats[side] ?? null;
              const mine = holder === me;
              const pick = game.picks[side];
              return (
                <div key={side} className={`seat ${mine ? 'is-mine' : ''}`}>
                  <span className={`seat__chip seat__chip--${side === 'a' ? 'p1' : 'p2'}`}>{SIDE_LABEL[side]}</span>
                  <span className={holder ? 'seat__who' : 'seat__open'}>
                    {holder ? (
                      <>
                        {nameOf(holder)}
                        <span className="seat__pick" style={{ color: pick ? FIGHTERS[pick].color : undefined }}>
                          {pick ? FIGHTERS[pick].name : 'choosing…'}
                        </span>
                      </>
                    ) : (
                      'open'
                    )}
                  </span>
                  {(!holder || mine) && (
                    <button
                      type="button"
                      className="tool"
                      onClick={() => socket.emit('fight:seat', { side: mine ? null : side })}
                    >
                      {mine ? 'Leave' : 'Sit'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="settings__modes">
            <span className="settings__label">Rounds</span>
            <div className="modes modes--3">
              {ROUND_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  className={`mode ${game.settings.roundsToWin === m.value ? 'is-active' : ''}`}
                  disabled={!isHost}
                  aria-pressed={game.settings.roundsToWin === m.value}
                  onClick={() => socket.emit('fight:settings', { roundsToWin: m.value })}
                >
                  <strong>{m.name}</strong>
                  <span>{m.blurb}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings">
            <label className="settings__row">
              <span className="settings__label">Round time</span>
              <input
                type="range"
                min={FIGHT_BOUNDS.roundSeconds.min}
                max={FIGHT_BOUNDS.roundSeconds.max}
                step={1}
                value={game.settings.roundSeconds}
                disabled={!isHost}
                onChange={(e) => socket.emit('fight:settings', { roundSeconds: Number(e.target.value) })}
              />
              <span className="settings__value">{game.settings.roundSeconds}s</span>
            </label>
          </div>

          <div className="settings__modes">
            <span className="settings__label">Blood</span>
            <div className="modes">
              {[true, false].map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  className={`mode ${game.settings.blood === on ? 'is-active' : ''}`}
                  disabled={!isHost}
                  aria-pressed={game.settings.blood === on}
                  onClick={() => socket.emit('fight:settings', { blood: on })}
                >
                  <strong>{on ? 'On' : 'Off'}</strong>
                  <span>{on ? 'Sprays, splats and gore.' : 'Hit sparks. Fatalities stay bloodless.'}</span>
                </button>
              ))}
            </div>
          </div>

          {isHost ? (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={missing > 0}
              onClick={() => socket.emit('game:start')}
            >
              {missing > 0 ? 'Both fighters need a seat and a pick' : 'Fight!'}
            </button>
          ) : (
            <p className="settings__note">
              {!mySide ? 'Take a side to fight, or stay and watch.' : missing > 0 ? 'Waiting for both picks…' : 'Waiting for the host to start…'}
            </p>
          )}
        </div>

        <div className="lobby__players card">
          <h2 className="card__title">In the room · {room.players.length}</h2>
          <ul className="lobby__grid">
            {room.players.map((p) => {
              const side = FIGHT_SIDES.find((s) => game.seats[s] === p.id) ?? null;
              return (
                <li key={p.id} className="lobby__player">
                  <Avatar data={p.avatar} size={44} host={p.id === room.hostId} />
                  <span>{p.name}</span>
                  {side && (
                    <span className={`seat__chip seat__chip--${side === 'a' ? 'p1' : 'p2'}`}>{SIDE_LABEL[side]}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="roster card">
          <h2 className="card__title">Choose your fighter</h2>
          <div className="roster__grid" onMouseLeave={() => setHovered(null)}>
            {FIGHTER_IDS.map((id) => (
              <FighterCard
                key={id}
                id={id}
                pickedBy={FIGHT_SIDES.filter((s) => game.picks[s] === id)}
                mine={myPick === id}
                disabled={!mySide}
                onPick={() => socket.emit('fight:pick', { fighter: id })}
                onLook={() => setHovered(id)}
              />
            ))}
          </div>
          {!mySide && <p className="settings__note">Sit on a side to pick. Hover a fighter to see their moves.</p>}
          <div className="roster__info">
            <MoveList id={look} />
            <Controls />
          </div>
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
