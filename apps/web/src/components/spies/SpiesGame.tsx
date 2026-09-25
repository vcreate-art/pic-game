import { useEffect, useState } from 'react';
import {
  MAX_CLUE_COUNT, SPY_TEAMS, UNLIMITED, clueProblem, type CardColor, type SpiesGame as Engine,
  type SpyTeam,
} from '@pic-game/shared';
import { msUntil } from '../../net/clock.js';
import { getSocket } from '../../net/socket.js';
import { selectIsHost, selectSpies, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { Chat } from '../Chat.js';
import { SpiesLobby, TEAM_NAME } from './SpiesLobby.js';

const countLabel = (n: number) => (n === UNLIMITED ? '∞' : String(n));
const COUNTS = [...Array.from({ length: MAX_CLUE_COUNT + 1 }, (_, i) => i), UNLIMITED];

function useTick(on: boolean): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [on]);
}

export function SpiesGame({ onLeave }: { onLeave: () => void }) {
  const room = useGame(selectSpies);
  const me = useGame((s) => s.me);
  const key = useGame((s) => s.spiesKey);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  const [word, setWord] = useState('');
  const [count, setCount] = useState(1);
  /** Spoken games: this device has asked to see the key (a spymaster's phone). */
  const [peeking, setPeeking] = useState(false);
  const [confirmPeek, setConfirmPeek] = useState(false);
  useTick(!!room?.game.endsAt);
  const phase = room?.game.phase;
  useEffect(() => {
    if (phase === 'lobby' || phase === 'ended') setPeeking(false);
  }, [phase]);

  const turnKey = `${room?.game.turn}:${room?.game.log.length}`;
  useEffect(() => setWord(''), [turnKey]);

  if (!room || !me) return null;
  const { game } = room;
  if (game.phase === 'lobby') return <SpiesLobby onLeave={onLeave} />;

  const player = (id: string) => room.players.find((p) => p.id === id);
  const myTeam = SPY_TEAMS.find((t) => game.teams[t].spymaster === me || game.teams[t].operatives.includes(me)) ?? null;
  const spoken = game.settings.clueMode === 'spoken';
  const amSpymaster = !!myTeam && game.teams[myTeam].spymaster === me;
  const myTurn = myTeam === game.turn;
  // At a real table anyone may turn a card over; in the app, only the guessers
  // of the team whose turn it is.
  const guessing = game.phase === 'guess' && (spoken || (myTurn && !amSpymaster));
  const seesKey = amSpymaster || (spoken && peeking && !!key);
  // Spoken, anyone at the table taps in the number the spymaster said.
  const giving = game.phase === 'clue' && (spoken || (myTurn && amSpymaster));
  const ended = game.phase === 'ended';
  // What each card is, as far as this screen may know: spymasters see the
  // whole key; everyone sees it at the end; guessers see only what is turned.
  const truth = (i: number): CardColor | null => game.key?.[i] ?? key?.[i] ?? null;

  const typed = game.settings.clueMode === 'typed';
  // Checked here too for instant feedback; the server has the final say.
  const problem = typed && word ? clueProblem({ words: game.board.map((b) => b.word), revealed: game.board.map((b) => b.revealed) } as Engine, word) : null;
  const secs = game.endsAt ? Math.ceil(msUntil(game.endsAt) / 1000) : null;

  const status = (() => {
    const team = TEAM_NAME[game.turn];
    if (ended) return game.winner ? `${TEAM_NAME[game.winner]} wins${game.reason === 'assassin' ? ': the assassin was found' : ''}!` : 'Game over';
    if (spoken && game.phase === 'clue') return `${team}'s turn: say the clue, then tap its number`;
    if (game.phase === 'clue') return giving ? 'Your clue' : `${team} spymaster is thinking…`;
    const left = game.guessesLeft === UNLIMITED ? 'no limit' : `${game.guessesLeft} guess${game.guessesLeft === 1 ? '' : 'es'} left`;
    return `${guessing && !spoken ? 'Your team is' : `${team} is`} guessing · ${left}`;
  })();

  // What this player can do right now, shown at the top of the right column.
  const hasControls = giving || guessing || (ended && isHost);

  const give = () => {
    if (!word.trim() || problem) return;
    socket.emit('spies:clue', { word: word.trim(), count });
  };

  return (
    <div className={`game game--spies turn--${game.turn}`}>
      <div className="spies">
        <aside className="spies__teams">
          {SPY_TEAMS.map((team: SpyTeam) => {
            const t = game.teams[team];
            return (
              <section key={team} className={`card spyteam spyteam--${team} ${game.turn === team && !ended ? 'is-turn' : ''}`}>
                <header className="spyteam__head">
                  <h2 className="spyteam__title">{TEAM_NAME[team]}</h2>
                  <span className="spyteam__left" title="Agents still to find">{game.remaining[team]}</span>
                </header>
                <ul className="spyteam__list">
                  {[t.spymaster, ...t.operatives].filter(Boolean).map((id) => {
                    const p = player(id!);
                    return p ? (
                      <li key={id} className={`spyteam__member ${id === me ? 'is-me' : ''} ${p.connected ? '' : 'is-away'}`}>
                        <Avatar data={p.avatar} size={22} />
                        <span>{p.name}</span>
                        {id === t.spymaster && <span className="spyteam__tag">Spymaster</span>}
                      </li>
                    ) : null;
                  })}
                </ul>
              </section>
            );
          })}
          {!myTeam && !ended && !spoken && (
            <div className="card spyteam__watch">
              <p className="settings__note settings__note--left">You are watching. Join a team as a guesser:</p>
              <div className="spyteam__actions">
                {SPY_TEAMS.map((team) => (
                  <button key={team} type="button" className="tool" onClick={() => socket.emit('spies:join', { team, role: 'operative' })}>
                    {TEAM_NAME[team]}
                  </button>
                ))}
              </div>
            </div>
          )}
          {spoken && !ended && !amSpymaster && (
            <div className="card spypeek">
              {peeking ? (
                <button type="button" className="btn" onClick={() => setPeeking(false)}>Hide the key</button>
              ) : confirmPeek ? (
                <>
                  <span className="settings__note">Only a spymaster should look. Sure?</span>
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={() => {
                      socket.emit('spies:peek');
                      setPeeking(true);
                      setConfirmPeek(false);
                    }}
                  >
                    Show me the key
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setConfirmPeek(false)}>Cancel</button>
                </>
              ) : (
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmPeek(true)}>
                  Spymaster? Show the key
                </button>
              )}
            </div>
          )}
          <button className="btn btn--danger" type="button" onClick={onLeave}>Leave room</button>
        </aside>

        <main className="spies__main">
          <header className={`spybar spybar--${ended ? game.winner ?? 'none' : game.turn}`}>
            <span className="spybar__status">{status}</span>
            {game.clue && !ended && (
              <span className="spybar__clue">
                {game.clue.word ?? 'Spoken clue'} <b>{countLabel(game.clue.count)}</b>
              </span>
            )}
            {secs !== null && !ended && <span className={`spybar__time ${secs <= 10 ? 'is-low' : ''}`}>{secs}s</span>}
          </header>

          <div className={`spyboard ${seesKey ? 'is-master' : ''} ${guessing ? 'is-guessing' : ''}`}>
            {game.board.map((card, i) => {
              const color = card.revealed ?? (seesKey || ended ? truth(i) : null);
              const marks = game.marks[i] ?? [];
              const mine = marks.includes(me);
              return (
                <div
                  key={i}
                  className={[
                    'spycard',
                    card.revealed ? `is-revealed is-${card.revealed}` : '',
                    !card.revealed && color ? `hint-${color}` : '',
                    mine ? 'is-marked' : '',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    className="spycard__face"
                    disabled={!guessing || !!card.revealed}
                    onClick={() => socket.emit('spies:mark', { index: i })}
                  >
                    <span className="spycard__word">{card.word}</span>
                  </button>
                  {marks.length > 0 && !card.revealed && (
                    <span className="spycard__marks">
                      {marks.map((id) => {
                        const p = player(id);
                        return p ? <Avatar key={id} data={p.avatar} size={18} /> : null;
                      })}
                    </span>
                  )}
                  {guessing && mine && !card.revealed && (
                    <button type="button" className="spycard__reveal" onClick={() => socket.emit('spies:reveal', { index: i })}>
                      Reveal
                    </button>
                  )}
                </div>
              );
            })}
          </div>

        </main>

        <aside className="spies__side">
          {hasControls && (
            <section className="card spyctl">
              {giving && spoken && (
                <div className="spycount">
                  <span className="spyclue__say">The spymaster said…</span>
                  <div className="spycount__nums">
                    {COUNTS.map((n) => (
                      <button key={n} type="button" className="tool" onClick={() => socket.emit('spies:clue', { word: null, count: n })}>
                        {countLabel(n)}
                      </button>
                    ))}
                  </div>
                  <span className="settings__note settings__note--left">That many guesses plus one; 0 or ∞ for no limit.</span>
                </div>
              )}
              {giving && !spoken && (
                <form
                  className="spyclue"
                  onSubmit={(e) => {
                    e.preventDefault();
                    give();
                  }}
                >
                  <input
                    className="field__input spyclue__word"
                    value={word}
                    maxLength={20}
                    placeholder="One-word clue"
                    autoFocus
                    onChange={(e) => setWord(e.target.value)}
                  />
                  <select className="spyclue__count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                    {COUNTS.map((n) => <option key={n} value={n}>{countLabel(n)}</option>)}
                  </select>
                  <button type="submit" className="btn btn--primary" disabled={!word.trim() || !!problem}>
                    Give clue
                  </button>
                  {problem && <span className="spyclue__problem">{problem}</span>}
                </form>
              )}
              {guessing && (
                <div className="spyguess">
                  <span className="settings__note">Tap a card to point at it; tap Reveal to turn it over.</span>
                  <button type="button" className="btn" onClick={() => socket.emit('spies:pass')}>End turn</button>
                </div>
              )}
              {ended && isHost && (
                <div className="spyguess">
                  <button type="button" className="btn btn--primary" onClick={() => socket.emit('spies:rematch')}>New board, same teams</button>
                  <button type="button" className="btn" onClick={() => socket.emit('spies:toLobby')}>Change teams</button>
                </div>
              )}
            </section>
          )}
          <section className="card spylog">
            <h2 className="card__title">{spoken ? 'Turns' : 'Clues'}</h2>
            {game.log.length === 0 ? (
              <p className="settings__note settings__note--left">No clues yet.</p>
            ) : (
              <ol className="spylog__list">
                {[...game.log].reverse().map((c, i) => (
                  <li key={game.log.length - i} className={`spylog__item spylog__item--${c.team}`}>
                    <span className="spylog__clue">
                      {c.word ?? `${TEAM_NAME[c.team]}'s turn`}
                      <b>{countLabel(c.count)}</b>
                    </span>
                    <span className="spylog__guesses">
                      {c.guesses.map((g, j) => (
                        <span key={j} className={`spylog__g is-${g.color}`}>{g.word}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {/* In person, everyone is in the same room: there is nobody to type to. */}
          {!spoken && <Chat />}
        </aside>
      </div>
    </div>
  );
}
