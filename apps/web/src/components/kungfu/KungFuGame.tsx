import { CLASSIC, sideLabel, type Side } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectKungFu, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { Chat } from '../Chat.js';
import { ChessBoard } from './ChessBoard.js';
import { KungFuLobby } from './KungFuLobby.js';



export function KungFuGame({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectKungFu);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  if (!room || !me) return null;

  const { game } = room;
  // Setting up is its own screen. An empty board behind an overlay was
  // decoration standing where the settings should be.
  if (game.phase === 'lobby') return <KungFuLobby onLeave={onLeave} />;

  const mySide: Side | null = game.seats.w === me ? 'w' : game.seats.b === me ? 'b' : null;
  const playing = game.phase === 'playing';
  const nameOf = (id: string | null) =>
    id ? room.players.find((p) => p.id === id)?.name ?? 'someone' : null;

  return (
    <div className="game game--chess">
      <div className="game__body">
        <div className="chess__side">
        <section className="scores card">
          <h2 className="card__title">
            {playing ? (mySide ? `You are ${sideLabel(CLASSIC, mySide)}` : 'Spectating') : 'Sides'}
          </h2>
          <div className="seats">
            {(['w', 'b'] as Side[]).map((side) => {
              const holder = game.seats[side];
              const mine = holder === me;
              return (
                <div key={side} className={`seat ${mine ? 'is-mine' : ''}`}>
                  <span className={`seat__chip seat__chip--${side}`}>{sideLabel(CLASSIC, side)}</span>
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

          <p className="settings__note">
            No turns. Move whenever you like — each piece rests after it moves.
            Take the king to win.
          </p>
          <button className="btn btn--danger" type="button" onClick={onLeave}>
            Leave room
          </button>
        </section>
        </div>

        <div className="game__stage">
          <div className="board__wrap">
            <ChessBoard
              pieces={game.pieces}
              mySide={mySide}
              live={playing}
              cooldownMs={game.settings.cooldownMs}
              onMove={(pieceId, to) => socket.emit('chess:move', { pieceId, to })}
            />
            {game.phase === 'ended' && (
              <div className="overlay">
                <div className="overlay__card">
                  <p className="overlay__kicker">
                    {game.reason === 'opponent-left' ? 'Opponent left' : 'King taken'}
                  </p>
                  <h3 className="overlay__title">
                    {game.winner ? `${sideLabel(CLASSIC, game.winner)} wins` : 'Game over'}
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
          </div>
        </div>

        <Chat />
      </div>
    </div>
  );
}
