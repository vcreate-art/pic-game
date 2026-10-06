import { useEffect, useMemo, useState } from 'react';
import {
  BINGO_LETTERS, BINGO_LINES, CALLER_MAX, CELLS, FREE, LINES_TO_WIN, TURNS_MAX, ballLetter,
  randomTurnsCard, type BingoPublic,
} from '@pic-game/shared';
import { msUntil } from '../../net/clock.js';
import { getSocket } from '../../net/socket.js';
import { selectBingo, selectIsHost, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { Chat } from '../Chat.js';
import { BingoLobby } from './BingoLobby.js';

function useTick(on: boolean): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [on]);
}

/** Squares that sit on a finished line, to light them up. */
function onLines(marked: readonly boolean[]): Set<number> {
  const out = new Set<number>();
  for (const line of BINGO_LINES) if (line.every((i) => marked[i])) line.forEach((i) => out.add(i));
  return out;
}

const markedFrom = (numbers: readonly number[], called: readonly number[]) =>
  numbers.map((n) => n === 0 || called.includes(n));

/** A 75-ball number as it is called: the column letter and the number. */
function Ball({ n, size = 'md' }: { n: number; size?: 'sm' | 'md' | 'lg' }) {
  const letter = ballLetter(n);
  return (
    <span className={`bball bball--${size} bball--${letter}`}>
      <span className="bball__letter">{letter}</span>
      <span className="bball__num">{n}</span>
    </span>
  );
}

/**
 * The letters over a card. In the turns game they are the score: each
 * finished line crosses one out. In the hall game they head the columns.
 */
function Letters({ crossed }: { crossed: number | null }) {
  return (
    <div className="bletters">
      {BINGO_LETTERS.map((l, i) => (
        <span key={l} className={`bletters__l ${crossed !== null && i < crossed ? 'is-crossed' : ''}`}>{l}</span>
      ))}
    </div>
  );
}

interface CellView {
  label: string;
  marked: boolean;
  lit: boolean;
  onClick?: () => void;
  hint?: boolean;
}

function Grid({ cells, small, tone }: { cells: CellView[]; small?: boolean; tone: 'turns' | 'caller' }) {
  return (
    <div className={`bgrid bgrid--${tone} ${small ? 'bgrid--small' : ''}`}>
      {cells.map((c, i) => (
        <button
          key={i}
          type="button"
          className={[
            'bcell',
            c.marked ? 'is-marked' : '',
            c.lit ? 'is-lit' : '',
            c.onClick ? 'is-live' : '',
            c.hint ? 'is-hint' : '',
            c.label === '' ? 'is-empty' : '',
            i === FREE && c.label === '★' ? 'is-free' : '',
          ].join(' ')}
          disabled={!c.onClick}
          onClick={c.onClick}
        >
          <span className="bcell__n">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Turns, before play: write 1 to 25 onto the grid, one tap at a time. */
function Arrange({ game }: { game: BingoPublic }) {
  const me = useGame((s) => s.me);
  const sent = useGame((s) => s.bingoCard);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  const [draft, setDraft] = useState<number[]>(() => Array(CELLS).fill(0));
  const ready = !!me && game.ready.includes(me);
  const playing = !!me && game.players.includes(me);
  // Coming back to a grid already sent: pick up where it was.
  useEffect(() => {
    if (sent) setDraft(sent.numbers);
  }, [sent]);

  const used = new Set(draft.filter(Boolean));
  const nextNum = Array.from({ length: TURNS_MAX }, (_, i) => i + 1).find((n) => !used.has(n)) ?? null;
  const full = used.size === TURNS_MAX;
  const waiting = game.players.length - game.ready.length;

  const tap = (i: number) =>
    setDraft((d) => {
      const out = [...d];
      if (out[i]) out[i] = 0;
      else if (nextNum) out[i] = nextNum;
      return out;
    });
  const fillRest = () =>
    setDraft((d) => {
      const left = randomTurnsCard(Math.random).filter((n) => !d.includes(n));
      return d.map((n) => n || left.shift()!);
    });

  if (!playing) {
    return <p className="bingo__watch card">Everyone is filling in their grids. You are watching this one; you are in the next.</p>;
  }

  return (
    <div className="barrange">
      <div className="bcardwrap">
        <Letters crossed={null} />
        <Grid
          tone="turns"
          cells={draft.map((n, i) => ({
            label: n ? String(n) : '',
            marked: false,
            lit: false,
            onClick: ready ? undefined : () => tap(i),
          }))}
        />
      </div>
      <div className="barrange__ctl card">
        {ready ? (
          <>
            <p className="barrange__next">Grid sent.</p>
            <p className="settings__note settings__note--left">
              {waiting ? `Waiting for ${waiting} more…` : 'Starting…'}
            </p>
            <button type="button" className="btn" onClick={() => socket.emit('bingo:ready', { card: null })}>
              Change it
            </button>
          </>
        ) : (
          <>
            <p className="barrange__next">
              {nextNum ? <>Tap a square to write <b>{nextNum}</b></> : 'All 25 are in.'}
            </p>
            <p className="settings__note settings__note--left">Tap a number again to rub it out. Keep your grid to yourself.</p>
            <div className="barrange__row">
              <button type="button" className="tool" disabled={full} onClick={fillRest}>Fill the rest</button>
              <button type="button" className="tool" onClick={() => setDraft(randomTurnsCard(Math.random))}>Shuffle</button>
              <button type="button" className="tool" disabled={!used.size} onClick={() => setDraft(Array(CELLS).fill(0))}>Clear</button>
            </div>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!full}
              onClick={() => socket.emit('bingo:ready', { card: draft })}
            >
              Done
            </button>
          </>
        )}
        {isHost && waiting > 0 && (
          <button type="button" className="btn btn--ghost" onClick={() => socket.emit('bingo:begin')}>
            Start now (fill in grids for the {waiting} still going)
          </button>
        )}
      </div>
    </div>
  );
}

export function BingoGame() {
  const room = useGame(selectBingo);
  const me = useGame((s) => s.me);
  const card = useGame((s) => s.bingoCard);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  useTick(!!room?.game.endsAt);
  const called = room?.game.called;
  const calledSet = useMemo(() => new Set(called), [called]);

  if (!room || !me) return null;
  const { game } = room;
  if (game.phase === 'lobby') return <BingoLobby />;

  const turns = game.settings.mode === 'turns';
  const ended = game.phase === 'ended';
  const playing = game.players.includes(me);
  const myTurn = game.turn === me;
  const last = game.called.at(-1) ?? null;
  const secs = game.endsAt ? Math.max(0, Math.ceil(msUntil(game.endsAt) / 1000)) : null;
  const player = (id: string) => room.players.find((p) => p.id === id);
  const name = (id: string | null) => (id && player(id)?.name) || 'Someone';
  const myLines = game.lines[me] ?? 0;
  const iWon = game.winners.includes(me);

  const status = (() => {
    if (game.phase === 'arrange') return 'Fill in your grid';
    if (ended) {
      const names = game.winners.map(name);
      if (iWon) return names.length > 1 ? `BINGO! You share it with ${names.filter((n) => n !== player(me)?.name).join(', ')}` : 'BINGO! You win!';
      return names.length ? `BINGO for ${names.join(' and ')}` : 'Game over';
    }
    if (turns) return myTurn ? 'Your call: tap a number on your grid' : `${name(game.turn)} is calling…`;
    if (game.paused) return 'The draw is on hold';
    if (game.called.length >= CALLER_MAX) return 'All the balls are out';
    return last ? `Ball ${game.called.length} of ${CALLER_MAX}` : 'Eyes down…';
  })();

  const marked = card?.marked ?? [];
  const lit = onLines(marked);
  const myCells: CellView[] | null = card
    ? card.numbers.map((n, i) => {
        const done = marked[i] ?? false;
        let onClick: (() => void) | undefined;
        if (!ended && game.phase === 'play') {
          if (turns && myTurn && !done) onClick = () => socket.emit('bingo:call', { n });
          if (!turns && !game.settings.autoDaub && n !== 0 && (done || calledSet.has(n))) {
            onClick = () => socket.emit('bingo:daub', { index: i });
          }
        }
        return { label: n === 0 ? '★' : String(n), marked: done, lit: lit.has(i), onClick };
      })
    : null;

  return (
    <div className="game game--bingo">
      <div className="bingo">
        <aside className="bingo__people">
          <section className="card">
            <h2 className="card__title">{game.phase === 'arrange' ? 'Filling in' : 'Players'}</h2>
            <ul className="bplayers">
              {game.players.map((id) => {
                const p = player(id);
                if (!p) return null;
                const n = game.lines[id] ?? 0;
                return (
                  <li
                    key={id}
                    className={[
                      'bplayer',
                      id === me ? 'is-me' : '',
                      game.turn === id ? 'is-turn' : '',
                      game.winners.includes(id) ? 'is-winner' : '',
                      p.connected ? '' : 'is-away',
                    ].join(' ')}
                  >
                    <Avatar data={p.avatar} size={26} host={id === room.hostId} />
                    <span className="bplayer__name">{p.name}</span>
                    {game.phase === 'arrange' ? (
                      <span className={`bplayer__ready ${game.ready.includes(id) ? 'is-on' : ''}`}>
                        {game.ready.includes(id) ? 'Ready' : '…'}
                      </span>
                    ) : turns ? (
                      <span className="bplayer__letters" title={`${n} line${n === 1 ? '' : 's'}`}>
                        {BINGO_LETTERS.map((l, i) => <b key={l} className={i < n ? 'is-on' : ''}>{l}</b>)}
                      </span>
                    ) : (
                      <span className="bplayer__lines">{n ? `${n} line${n === 1 ? '' : 's'}` : ''}</span>
                    )}
                    {!!room.meta.wins[p.id] && (
                      <span className="bplayer__wins" title="Wins this session">{room.meta.wins[p.id]}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>

        <main className="bingo__main">
          <header className={`bbar ${ended ? 'is-ended' : myTurn ? 'is-mine' : ''}`}>
            <span className="bbar__status">{status}</span>
            {!turns && last !== null && !ended && <Ball n={last} />}
            {turns && last !== null && !ended && <span className="bbar__last">Last: <b>{last}</b></span>}
            {secs !== null && !ended && <span className={`bbar__time ${secs <= 3 ? 'is-low' : ''}`}>{secs}s</span>}
          </header>

          {game.phase === 'arrange' ? (
            <Arrange game={game} />
          ) : myCells ? (
            <div className="bplay">
              <div className="bcardwrap">
                <Letters crossed={turns ? myLines : null} />
                <Grid tone={turns ? 'turns' : 'caller'} cells={myCells} />
              </div>
              {!turns && !ended && (
                <button
                  type="button"
                  className="bshout"
                  onClick={() => socket.emit('bingo:claim')}
                >
                  BINGO!
                </button>
              )}
              {turns && !ended && (
                <p className="settings__note">
                  {myLines >= LINES_TO_WIN - 1 ? 'One more line!' : `${myLines} of ${LINES_TO_WIN} lines`}
                </p>
              )}
            </div>
          ) : (
            <p className="bingo__watch card">You joined mid-game, so you are watching this one. You are in the next.</p>
          )}

          {ended && game.cards && (
            <section className="card bcards">
              <h2 className="card__title">Everyone's cards</h2>
              <div className="bcards__list">
                {Object.entries(game.cards).map(([id, numbers]) => {
                  const m = markedFrom(numbers, game.called);
                  const l = onLines(m);
                  return (
                    <figure key={id} className={`bcards__one ${game.winners.includes(id) ? 'is-winner' : ''}`}>
                      <Grid
                        small
                        tone={turns ? 'turns' : 'caller'}
                        cells={numbers.map((n, i) => ({ label: n === 0 ? '★' : String(n), marked: m[i]!, lit: l.has(i) }))}
                      />
                      <figcaption>{name(id)}</figcaption>
                    </figure>
                  );
                })}
              </div>
            </section>
          )}
        </main>

        <aside className="bingo__side">
          {(ended ? isHost : !turns && isHost && game.phase === 'play') && (
            <section className="card bctl">
              {ended ? (
                <>
                  <button type="button" className="btn btn--primary" onClick={() => socket.emit('bingo:rematch')}>
                    {turns ? 'New grids, play again' : 'New cards, play again'}
                  </button>
                  <button type="button" className="btn" onClick={() => socket.emit('bingo:toLobby')}>Change the game</button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={game.called.length >= CALLER_MAX}
                    onClick={() => socket.emit('bingo:next')}
                  >
                    {game.settings.callSeconds ? 'Next ball now' : 'Call the next ball'}
                  </button>
                  {game.settings.callSeconds > 0 && (
                    <button type="button" className="btn" onClick={() => socket.emit('bingo:pause')}>
                      {game.paused ? 'Resume the draw' : 'Hold the draw'}
                    </button>
                  )}
                </>
              )}
            </section>
          )}

          <section className="card bcalled">
            <h2 className="card__title">Called · {game.called.length}</h2>
            {turns ? (
              game.called.length ? (
                <ol className="bcalled__list">
                  {[...game.called].reverse().map((n, i) => (
                    <li key={n} className={i === 0 ? 'is-last' : ''}>{n}</li>
                  ))}
                </ol>
              ) : (
                <p className="settings__note settings__note--left">Nothing yet.</p>
              )
            ) : (
              <div className="bboard">
                {BINGO_LETTERS.map((l, row) => (
                  <div key={l} className="bboard__row">
                    <span className={`bboard__l bball--${l}`}>{l}</span>
                    {Array.from({ length: 15 }, (_, i) => row * 15 + i + 1).map((n) => (
                      <span key={n} className={`bboard__n ${calledSet.has(n) ? 'is-on' : ''} ${n === last ? 'is-last' : ''}`}>{n}</span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          <Chat />
        </aside>
      </div>
    </div>
  );
}
