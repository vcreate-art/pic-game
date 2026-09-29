import { useEffect, useState, type CSSProperties } from 'react';
import {
  FLIP7_SET, roundScore,
  type Avatar as AvatarData, type Flip7Card, type Flip7Event, type Flip7Face, type Flip7Hand, type Flip7Public,
} from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectFlip7, selectIsHost, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { Chat } from '../Chat.js';
import { Flip7Lobby } from './Flip7Lobby.js';

const ODDS_KEY = 'flip7:odds';

function loadOdds(): boolean {
  try {
    return localStorage.getItem(ODDS_KEY) === '1';
  } catch {
    return false;
  }
}

const ACTION_NAME = { freeze: 'Freeze', flip3: 'Flip Three', second: 'Second Chance' } as const;

/**
 * Each number's hue: thirteen evenly spaced, dealt out five apart, so any two
 * numbers are at least a thirteenth of the wheel apart and neighbours (a 6
 * next to a 7) are far apart.
 */
const numberHue = (n: number) => `${((n * 5) % 13) * (360 / 13) + 20}deg`;

/** A card's words, for sentences and screen readers. */
function faceName(f: Flip7Face): string {
  switch (f.kind) {
    case 'number': return String(f.value);
    case 'plus': return `+${f.value}`;
    case 'times2': return '×2';
    default: return ACTION_NAME[f.kind];
  }
}

/**
 * One card. Numbers each have their own colour, as in the box, so a pair
 * stands out before you read it. `delay` staggers cards that arrived together.
 */
export function Card({ card, fresh, delay = 0, size = 'md', dupe }: {
  card: Flip7Card;
  fresh?: boolean;
  delay?: number;
  size?: 'sm' | 'md';
  dupe?: boolean;
}) {
  const f = card.face;
  const cls = ['f7card', `f7card--${size}`, `f7card--${f.kind}`, fresh ? 'is-fresh' : '', dupe ? 'is-dupe' : ''].join(' ');
  const style = { animationDelay: `${delay}ms`, ...(f.kind === 'number' ? { '--hue': numberHue(f.value) } : {}) } as CSSProperties;
  return (
    <span className={cls} style={style} aria-label={faceName(f)} title={faceName(f)}>
      {f.kind === 'number' && <b>{f.value}</b>}
      {f.kind === 'plus' && <b>+{f.value}</b>}
      {f.kind === 'times2' && <b>×2</b>}
      {f.kind === 'freeze' && <><i aria-hidden="true">❄</i><small>Freeze</small></>}
      {f.kind === 'flip3' && <><b>3</b><small>Flip</small></>}
      {f.kind === 'second' && <><i aria-hidden="true">♥</i><small>2nd</small></>}
    </span>
  );
}

const STATUS_LABEL: Record<Flip7Hand['status'], string> = {
  active: '', stayed: 'Stayed', frozen: 'Frozen', bust: 'Bust', flip7: 'Flip 7!',
};

export function Flip7Game({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectFlip7);
  const me = useGame((s) => s.me);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  const [odds, setOdds] = useState(loadOdds);

  useEffect(() => {
    try {
      localStorage.setItem(ODDS_KEY, odds ? '1' : '0');
    } catch {
      /* private mode: just not remembered */
    }
  }, [odds]);

  if (!room || !me) return null;
  const game = room.game;
  if (game.phase === 'lobby') return <Flip7Lobby onLeave={onLeave} />;

  const name = (id: string | null) => (id && room.players.find((p) => p.id === id)?.name) || 'Someone';
  const you = (id: string) => (id === me ? 'You' : name(id));
  const playing = game.players.includes(me);
  const myTurn = game.turn === me && game.phase === 'turn';
  const choosing = game.pending?.by === me;
  const between = game.phase === 'roundEnd' || game.phase === 'ended';

  // The cards that arrived with the last move, in order, to flip them in one by one.
  const fresh = new Map<number, number>();
  game.events.forEach((e) => {
    if (e.kind === 'draw' || e.kind === 'action') fresh.set(e.card.id, fresh.size);
  });

  const status = (() => {
    if (game.phase === 'ended') return game.winners.includes(me) ? 'You win!' : `${game.winners.map(name).join(' and ')} wins!`;
    if (game.phase === 'roundEnd') return `Round ${game.round} is over`;
    if (game.pending) {
      const what = ACTION_NAME[game.pending.card.face.kind as keyof typeof ACTION_NAME];
      return choosing ? `You drew ${what}: who gets it?` : `${name(game.pending.by)} is choosing who gets ${what}…`;
    }
    if (myTurn) return 'Your turn: hit or stay';
    return `${name(game.turn)}'s turn`;
  })();

  return (
    <div className="game game--flip7">
      <div className="f7">
        <main className="f7__main">
          <header className={`f7bar ${myTurn || choosing ? 'is-mine' : ''} ${game.phase === 'ended' ? 'is-ended' : ''}`} key={`${game.turn}-${game.phase}-${game.pending?.card.id}`}>
            <span className="f7bar__round">Round {game.round}</span>
            <span className="f7bar__status">{status}</span>
            <span className="f7bar__deck" title="Cards left in the deck">🂠 {game.deckCount}</span>
          </header>

          {game.events.length > 0 && <LastMove events={game.events} you={you} />}

          {choosing && game.pending && (
            <section className="card f7choose">
              <div className="f7choose__card"><Card card={game.pending.card} /></div>
              <div className="f7choose__body">
                <strong>{ACTION_NAME[game.pending.card.face.kind as keyof typeof ACTION_NAME]}: pick who gets it</strong>
                <span className="settings__note settings__note--left">
                  {game.pending.card.face.kind === 'freeze' && 'They bank what they have and are out of the round.'}
                  {game.pending.card.face.kind === 'flip3' && 'They must take the next three cards, one at a time.'}
                  {game.pending.card.face.kind === 'second' && 'You already have one, so it goes to someone without.'}
                </span>
                <div className="f7choose__opts">
                  {game.pending.options.map((id) => (
                    <button key={id} type="button" className="btn" onClick={() => socket.emit('flip7:choose', { target: id })}>
                      {you(id)}
                      <span className="f7choose__pts">{roundScore(game.hands[id]!)} pts</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          <ol className="f7seats">
            {game.players.map((id) => (
              <Seat
                key={id}
                id={id}
                game={game}
                me={me}
                name={you(id)}
                avatar={room.players.find((p) => p.id === id)?.avatar ?? null}
                connected={room.players.find((p) => p.id === id)?.connected ?? false}
                fresh={fresh}
              />
            ))}
          </ol>

          {playing && !between && (
            <div className="f7controls">
              <button type="button" className="f7btn f7btn--hit" disabled={!myTurn} onClick={() => socket.emit('flip7:hit')}>
                Hit
              </button>
              <button type="button" className="f7btn f7btn--stay" disabled={!myTurn} onClick={() => socket.emit('flip7:stay')}>
                Stay
                <small>bank {roundScore(game.hands[me]!)}</small>
              </button>
              {odds && game.hands[me]?.status === 'active' && <BustOdds game={game} me={me} />}
            </div>
          )}

          {between && (
            <RoundSummary
              game={game}
              me={me}
              you={you}
              canDeal={playing && game.phase === 'roundEnd'}
              isHost={isHost}
            />
          )}
        </main>

        <aside className="f7__side">
          <DeckTracker game={game} odds={odds} setOdds={setOdds} />
          <Chat />
          <button className="btn btn--danger" type="button" onClick={onLeave}>Leave room</button>
        </aside>
      </div>
    </div>
  );
}

function Seat({ id, game, me, name, avatar, connected, fresh }: {
  id: string;
  game: Flip7Public;
  me: string;
  name: string;
  avatar: AvatarData | null;
  connected: boolean;
  fresh: Map<number, number>;
}) {
  const h = game.hands[id];
  if (!h) return null;
  const total = game.totals[id] ?? 0;
  const pts = roundScore(h);
  const turn = game.turn === id && game.phase === 'turn';
  const cards = [...h.numbers, ...h.modifiers, ...(h.second ? [h.second] : [])];
  // The card that busted them: the second of a pair.
  const dupe = h.status === 'bust' ? h.numbers.at(-1)?.id : undefined;
  const pct = Math.min(100, (total / game.settings.target) * 100);
  return (
    <li
      className={['f7seat', `is-${h.status}`, id === me ? 'is-me' : '', turn ? 'is-turn' : '', connected ? '' : 'is-away'].join(' ')}
    >
      <div className="f7seat__who">
        {avatar && <Avatar data={avatar} size={30} />}
        <div className="f7seat__name">
          <strong>{name}</strong>
          <span>
            {game.dealer === id && <em className="f7seat__dealer" title="Dealer">D</em>}
            {h.numbers.filter((c) => c.face.kind === 'number').length}/{FLIP7_SET} numbers
          </span>
        </div>
      </div>
      <div className="f7seat__cards">
        {cards.length ? cards.map((c) => (
          <Card
            key={c.id}
            card={c}
            size="sm"
            fresh={fresh.has(c.id)}
            delay={(fresh.get(c.id) ?? 0) * 350}
            dupe={c.id === dupe}
          />
        )) : <span className="f7seat__empty">No cards yet</span>}
      </div>
      <div className="f7seat__score">
        {h.status !== 'active' && <span className={`f7chip f7chip--${h.status}`}>{STATUS_LABEL[h.status]}</span>}
        <span className="f7seat__pts">{h.status === 'bust' ? '0' : pts}<small>this round</small></span>
      </div>
      <div className="f7seat__total" title={`${total} of ${game.settings.target}`}>
        <span>{total}</span>
        <span className="f7seat__bar"><i style={{ width: `${pct}%` }} /></span>
      </div>
    </li>
  );
}

/** The last move as a line of events, the new cards flipping in turn. */
function LastMove({ events, you }: { events: Flip7Event[]; you: (id: string) => string }) {
  const bits = events.filter((e) => e.kind !== 'round');
  if (!bits.length) return null;
  return (
    <div className="f7last" key={events.map((e) => ('card' in e ? e.card.id : e.kind)).join('-')}>
      <span className="clast__tag">Just now</span>
      {bits.map((e, i) => {
        const delay = { animationDelay: `${i * 350}ms` };
        switch (e.kind) {
          case 'draw':
            return (
              <span key={i} className={`f7last__bit ${e.bust ? 'is-bust' : e.flip7 ? 'is-flip7' : ''}`} style={delay}>
                {you(e.to)} <Card card={e.card} size="sm" />
                {e.bust && <b>bust!</b>}
                {e.saved && <b>saved by Second Chance</b>}
                {e.flip7 && <b>FLIP 7!</b>}
              </span>
            );
          case 'stay':
            return <span key={i} className="f7last__bit" style={delay}>{you(e.by)} stayed</span>;
          case 'action':
            return (
              <span key={i} className="f7last__bit is-action" style={delay}>
                {you(e.by)} <Card card={e.card} size="sm" /> → {you(e.on)}
              </span>
            );
          case 'discard':
            return <span key={i} className="f7last__bit" style={delay}>{you(e.by)}'s spare Second Chance had nowhere to go</span>;
          default:
            return null;
        }
      })}
    </div>
  );
}

/** Your chance of a duplicate on the next card, from what is left in the deck. */
function BustOdds({ game, me }: { game: Flip7Public; me: string }) {
  const h = game.hands[me]!;
  if (!game.deckCount) return <span className="f7odds">The discards get shuffled back in next.</span>;
  const risky = h.numbers.reduce((n, c) => n + (c.face.kind === 'number' ? game.remaining[`n${c.face.value}`] ?? 0 : 0), 0);
  const pct = Math.round((risky / game.deckCount) * 100);
  return (
    <span className={`f7odds ${pct >= 40 ? 'is-high' : pct >= 20 ? 'is-mid' : ''}`}>
      {pct}% bust risk{h.second ? ', but your Second Chance covers one' : ''}
    </span>
  );
}

function RoundSummary({ game, me, you, canDeal, isHost }: {
  game: Flip7Public;
  me: string;
  you: (id: string) => string;
  canDeal: boolean;
  isHost: boolean;
}) {
  const socket = getSocket();
  const ranked = [...game.players].sort((a, b) => (game.totals[b] ?? 0) - (game.totals[a] ?? 0));
  const ended = game.phase === 'ended';
  return (
    <section className={`card f7sum ${ended ? 'is-ended' : ''}`}>
      <h2 className="card__title">{ended ? 'Final scores' : `After round ${game.round}`}</h2>
      <ol className="f7sum__list">
        {ranked.map((id, i) => {
          const r = game.lastRound?.[id] ?? 0;
          const bust = game.hands[id]?.status === 'bust';
          return (
            <li key={id} className={`${id === me ? 'is-me' : ''} ${game.winners.includes(id) ? 'is-winner' : ''}`}>
              <span className="f7sum__rank">{i + 1}</span>
              <span className="f7sum__name">{you(id)}</span>
              <span className={`f7sum__round ${bust ? 'is-bust' : ''}`}>{bust ? 'bust' : `+${r}`}</span>
              <span className="f7sum__total">{game.totals[id] ?? 0}</span>
            </li>
          );
        })}
      </ol>
      {canDeal && (
        <button type="button" className="btn btn--primary btn--lg" onClick={() => socket.emit('flip7:next')}>
          Deal round {game.round + 1}
        </button>
      )}
      {ended && isHost && (
        <div className="f7sum__again">
          <button type="button" className="btn btn--primary" onClick={() => socket.emit('flip7:rematch')}>Play again</button>
          <button type="button" className="btn" onClick={() => socket.emit('flip7:toLobby')}>Back to the lobby</button>
        </div>
      )}
      {!ended && <p className="settings__note">First past {game.settings.target} wins.</p>}
    </section>
  );
}

/** What is left in the deck, by card. Everything here could be counted from
 *  the table; this saves doing the sums. */
function DeckTracker({ game, odds, setOdds }: { game: Flip7Public; odds: boolean; setOdds: (on: boolean) => void }) {
  const left = (k: string) => game.remaining[k] ?? 0;
  return (
    <section className="card f7deck">
      <h2 className="card__title">Deck · {game.deckCount} left</h2>
      <div className="f7deck__nums">
        {Array.from({ length: 13 }, (_, n) => (
          <span key={n} className={`f7deck__n ${left(`n${n}`) ? '' : 'is-out'}`} style={{ '--hue': numberHue(n) } as CSSProperties}>
            <b>{n}</b>
            <small>×{left(`n${n}`)}</small>
          </span>
        ))}
      </div>
      <div className="f7deck__rest">
        {(['p2', 'p4', 'p6', 'p8', 'p10', 'x2'] as const).map((k) => (
          <span key={k} className={left(k) ? '' : 'is-out'}>{k === 'x2' ? '×2' : `+${k.slice(1)}`}</span>
        ))}
        {(['freeze', 'flip3', 'second'] as const).map((k) => (
          <span key={k} className={left(k) ? '' : 'is-out'}>{ACTION_NAME[k]} ×{left(k)}</span>
        ))}
      </div>
      <label className="f7deck__odds">
        <input type="checkbox" checked={odds} onChange={(e) => setOdds(e.target.checked)} />
        Show my bust risk
      </label>
      <p className="settings__note settings__note--left">{game.discardCount} in the discards, shuffled back in when the deck runs out.</p>
    </section>
  );
}
