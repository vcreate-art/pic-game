import { GAME_LABELS, type Side } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectKungFu, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { Chat } from '../Chat.js';
import { InviteCard } from '../InviteCard.js';
import { ChessBoard } from './ChessBoard.js';

const SIDE_NAME: Record<Side, string> = { w: 'White', b: 'Black' };

export function KungFuGame({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectKungFu);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  if (!room || !me) return null;

  const { game } = room;
  const mySide: Side | null = game.seats.w === me ? 'w' : game.seats.b === me ? 'b' : null;
  const playing = game.phase === 'playing';
  const nameOf = (id: string | null) =>
    id ? room.players.find((p) => p.id === id)?.name ?? 'someone' : null;

  return (
    <div className="game">
      <div className="game__head">
        <div className="game__head-side">
          <span className="game__round">{GAME_LABELS.kungfu.name}</span>
        </div>
        <div className="wordmask">
          <span className="wordmask__label">
            {playing
              ? mySide
                ? `You are ${SIDE_NAME[mySide]}`
                : 'Spectating'
              : game.phase === 'ended'
                ? 'Game over'
                : 'Pick a side'}
          </span>
          {playing && (
            <span className="chess__vs">
              {nameOf(game.seats.w)} <em>vs</em> {nameOf(game.seats.b)}
            </span>
          )}
        </div>
        <div className="game__head-side game__head-side--end">
          <button className="tool tool--leave" type="button" onClick={onLeave}>
            Leave
          </button>
        </div>
      </div>

      <div className="game__body">
        <div className="chess__side">
        {!playing && <InviteCard />}
        <section className="scores card">
          <h2 className="card__title">Sides</h2>
          <div className="seats">
            {(['w', 'b'] as Side[]).map((side) => {
              const holder = game.seats[side];
              const mine = holder === me;
              return (
                <div key={side} className={`seat ${mine ? 'is-mine' : ''}`}>
                  <span className={`seat__chip seat__chip--${side}`}>{SIDE_NAME[side]}</span>
                  {holder ? (
                    <span className="seat__who">
                      <Avatar
                        data={room.players.find((p) => p.id === holder)?.avatar ?? { color: 0, face: 0 }}
                        size={26}
                      />
                      {nameOf(holder)}
                    </span>
                  ) : (
                    <span className="seat__open">open</span>
                  )}
                  {!playing && (
                    <button
                      type="button"
                      className="tool"
                      onClick={() => socket.emit('chess:seat', { side: mine ? null : side })}
                      disabled={!!holder && !mine}
                    >
                      {mine ? 'Leave' : 'Sit'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {!playing && isHost && (
            <button
              type="button"
              className="btn btn--primary btn--lg"
              disabled={!game.seats.w || !game.seats.b}
              onClick={() => socket.emit(game.phase === 'ended' ? 'chess:rematch' : 'game:start')}
            >
              {!game.seats.w || !game.seats.b
                ? 'Both sides needed'
                : game.phase === 'ended'
                  ? 'Play again'
                  : 'Start game'}
            </button>
          )}
          {!playing && !isHost && (
            <p className="settings__note">Waiting for the host to start…</p>
          )}

          <p className="settings__note">
            No turns. Move whenever you like — each piece rests after it moves.
            Take the king to win.
          </p>
        </section>
        </div>

        <div className="game__stage">
          <div className="board__wrap">
            <ChessBoard
              pieces={game.pieces}
              mySide={mySide}
              live={playing}
              onMove={(pieceId, to) => socket.emit('chess:move', { pieceId, to })}
            />
            {game.phase === 'ended' && (
              <div className="overlay">
                <div className="overlay__card">
                  <p className="overlay__kicker">
                    {game.reason === 'opponent-left' ? 'Opponent left' : 'King taken'}
                  </p>
                  <h3 className="overlay__title">
                    {game.winner ? `${SIDE_NAME[game.winner]} wins` : 'Game over'}
                  </h3>
                  {(isHost || mySide) && (
                    <button
                      className="btn btn--primary"
                      type="button"
                      onClick={() => socket.emit('chess:rematch')}
                    >
                      Play again
                    </button>
                  )}
                </div>
              </div>
            )}
            {game.phase === 'lobby' && (
              <div className="overlay">
                <div className="overlay__card">
                  <p className="overlay__kicker">Kung Fu Chess</p>
                  <h3 className="overlay__title">Take a side to begin</h3>
                  <p className="overlay__hint">{GAME_LABELS.kungfu.blurb}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <Chat />
      </div>
    </div>
  );
}
