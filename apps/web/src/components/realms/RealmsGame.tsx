import { cardDef, EXPLORER, type RealmsSide } from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectRealms, useGame } from '../../store/game.js';
import { Chat } from '../Chat.js';
import { Card, CardStack } from './Card.js';
import { RealmsLobby } from './RealmsLobby.js';

export function RealmsGame({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectRealms);
  const me = useGame((s) => s.me);
  const hand = useGame((s) => s.realmsHand);
  const owed = useGame((s) => s.realmsOwed);
  const socket = getSocket();
  if (!room || !me) return null;

  const { game } = room;
  if (game.phase === 'lobby') return <RealmsLobby onLeave={onLeave} />;

  const mySide: RealmsSide | null = game.seats.a === me ? 'a' : game.seats.b === me ? 'b' : null;
  const foeSide: RealmsSide = mySide === 'b' ? 'a' : 'b';
  const mine = game.players[mySide ?? 'a'];
  const foe = game.players[foeSide];
  const myTurn = !!mySide && game.turn === mySide && game.phase === 'playing';
  const nameOf = (id: string | null | undefined) =>
    id ? room.players.find((p) => p.id === id)?.name ?? 'someone' : 'nobody';

  const foeOutposts = foe.bases.filter((b) => cardDef(b.key).type === 'outpost');
  const mustClearOutposts = foeOutposts.length > 0;

  return (
    <div className="game game--realms">
      <div className="realms">
        {/* ---- opponent ---- */}
        <section className="rside rside--foe card">
          <header className="rside__head">
            <span className="rside__who">{nameOf(game.seats[foeSide])}</span>
            <span className="rside__auth">{foe.authority}</span>
          </header>
          <div className="rrow">
            <CardStack label="deck" count={foe.deckCount} />
            <CardStack label="hand" count={foe.handCount} />
            <CardStack label="discard" count={foe.discardCount} />
            {foe.bases.map((b) => (
              <Card
                key={b.id}
                card={b}
                dim={b.used}
                footer={cardDef(b.key).type === 'outpost' ? 'outpost' : undefined}
                onClick={
                  myTurn ? () => socket.emit('realms:attack', { target: { kind: 'base', cardId: b.id } }) : undefined
                }
              />
            ))}
            {foe.inPlay.map((c) => <Card key={c.id} card={c} dim />)}
          </div>
          <button
            type="button"
            className="btn btn--danger"
            disabled={!myTurn || game.combat <= 0 || mustClearOutposts}
            onClick={() => socket.emit('realms:attack', { target: { kind: 'player' } })}
          >
            {mustClearOutposts
              ? 'Outposts first'
              : game.combat > 0
                ? `Attack for ${game.combat}`
                : 'Attack'}
          </button>
        </section>

        {/* ---- the market ---- */}
        <section className="rmarket card">
          <h2 className="card__title">Trade row · {game.tradeDeckCount} left</h2>
          <div className="rrow">
            {game.tradeRow.map((c) => (
              <Card
                key={c.id}
                card={c}
                dim={game.trade < cardDef(c.key).cost}
                onClick={myTurn ? () => socket.emit('realms:buy', { cardId: c.id }) : undefined}
              />
            ))}
            <div className="rexplorer">
              <Card
                card={{ id: 'explorer', key: EXPLORER.key }}
                dim={game.trade < EXPLORER.cost || game.explorersLeft === 0}
                onClick={myTurn ? () => socket.emit('realms:buy', { cardId: 'explorer' }) : undefined}
                footer={`${game.explorersLeft} left`}
              />
            </div>
          </div>
        </section>

        {/* ---- you ---- */}
        <section className="rside rside--me card">
          <header className="rside__head">
            <span className="rside__who">
              {mySide ? 'You' : 'Watching'}
              {myTurn && <span className="rside__turn">your turn</span>}
            </span>
            <span className="rpools">
              <span className="rpool rpool--trade">{game.trade} trade</span>
              <span className="rpool rpool--combat">{game.combat} combat</span>
            </span>
            <span className="rside__auth">{mine.authority}</span>
          </header>

          <div className="rrow">
            <CardStack label="deck" count={mine.deckCount} />
            <CardStack label="discard" count={mine.discardCount} />
            {mine.bases.map((b) => (
              <Card
                key={b.id}
                card={b}
                dim={b.used}
                onOption={myTurn && !b.used ? (i) => socket.emit('realms:use', { cardId: b.id, option: i }) : undefined}
                onScrap={myTurn && cardDef(b.key).scrap ? () => socket.emit('realms:scrap', { cardId: b.id }) : undefined}
              />
            ))}
            {mine.inPlay.map((c) => (
              <Card
                key={c.id}
                card={c}
                onScrap={myTurn && cardDef(c.key).scrap ? () => socket.emit('realms:scrap', { cardId: c.id }) : undefined}
              />
            ))}
          </div>

          <div className="rhand">
            <h3 className="rhand__title">
              {owed > 0 ? `Discard ${owed} card${owed > 1 ? 's' : ''} to continue` : 'Your hand'}
            </h3>
            <div className="rrow">
              {hand.map((c) => (
                <Card
                  key={c.id}
                  card={c}
                  onClick={
                    !myTurn
                      ? undefined
                      : owed > 0
                        ? () => socket.emit('realms:discard', { cardId: c.id })
                        : () => socket.emit('realms:play', { cardId: c.id })
                  }
                />
              ))}
              {hand.length === 0 && <p className="chat__empty">Nothing in hand.</p>}
            </div>
          </div>

          <div className="rbar">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!myTurn || owed > 0}
              onClick={() => socket.emit('realms:end')}
            >
              End turn
            </button>
            <button className="btn btn--danger" type="button" onClick={onLeave}>
              Leave room
            </button>
          </div>
        </section>

        <Chat />
      </div>

      {game.phase === 'ended' && (
        <div className="overlay overlay--page">
          <div className="overlay__card">
            <p className="overlay__kicker">Game over</p>
            <h3 className="overlay__title">
              {game.winner ? `${nameOf(game.seats[game.winner])} wins` : 'Nobody wins'}
            </h3>
            <button className="btn btn--primary" type="button" onClick={() => socket.emit('realms:rematch')}>
              Play again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
