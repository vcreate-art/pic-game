import { SPECS, sideLabel, type Side } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectKungFu, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { Chat } from '../Chat.js';
import { ChessBoard } from './ChessBoard.js';
import { KungFuLobby } from './KungFuLobby.js';

export function KungFuGame() {
  const room = useGame(selectKungFu);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  if (!room || !me) return null;

  const { game } = room;
  // Setting up is its own screen. An empty board behind an overlay was
  // decoration standing where the settings should be.
  if (game.phase === 'lobby') return <KungFuLobby />;

  const spec = SPECS[game.settings.variant];
  const mySide: Side | null = spec.sides.find((s) => game.seats[s] === me) ?? null;
  const playing = game.phase === 'playing';
  const iAmOut = !!mySide && game.eliminated.includes(mySide);
  const nameOf = (id: string | null | undefined) =>
    id ? room.players.find((p) => p.id === id)?.name ?? 'someone' : null;

  const status = !mySide
    ? 'Spectating'
    : iAmOut
      ? 'You are out'
      : `You are ${sideLabel(spec, mySide)}`;

  return (
    <div className={`game game--chess v--${spec.variant}`}>
      <div className="game__body">
        <div className="chess__side">
          <section className="scores card">
            <h2 className="card__title">{playing ? status : 'Game over'}</h2>
            <div className="seats">
              {spec.sides.map((side) => {
                const holder = game.seats[side] ?? null;
                const out = game.eliminated.includes(side);
                return (
                  <div
                    key={side}
                    className={`seat ${holder === me ? 'is-mine' : ''} ${out ? 'is-out' : ''}`}
                  >
                    <span className={`seat__chip seat__chip--${side}`}>
                      {sideLabel(spec, side)}
                    </span>
                    <span className={holder ? 'seat__who' : 'seat__open'}>
                      {holder ? (
                        <>
                          <Avatar
                            data={
                              room.players.find((p) => p.id === holder)?.avatar ?? {
                                color: 0,
                                face: 0,
                              }
                            }
                            size={24}
                          />
                          {nameOf(holder)}
                        </>
                      ) : (
                        'empty'
                      )}
                    </span>
                    {out && <span className="seat__out">out</span>}
                  </div>
                );
              })}
            </div>

            <p className="settings__note">
              No turns. Move whenever you like — each piece rests after it moves.
              Take a king to knock that player out.
            </p>
          </section>
        </div>

        <div className="game__stage">
          <div className="board__wrap">
            <ChessBoard
              spec={spec}
              pieces={game.pieces}
              mySide={mySide}
              live={playing}
              cooldownMs={game.settings.cooldownMs}
              eliminated={game.eliminated}
              onMove={(pieceId, to) => socket.emit('chess:move', { pieceId, to })}
            />
            {game.phase === 'ended' && (
              <div className="overlay">
                <div className="overlay__card">
                  <p className="overlay__kicker">
                    {game.reason === 'opponent-left' ? 'Nobody left to play' : 'King taken'}
                  </p>
                  <h3 className="overlay__title">
                    {game.winner
                      ? `${sideLabel(spec, game.winner)} wins${spec.sides.length > 2 ? ' — last one standing' : ''}`
                      : 'Game over'}
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
