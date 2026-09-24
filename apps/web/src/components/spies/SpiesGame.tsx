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
  useTick(!!room?.game.endsAt);

  const turnKey = `${room?.game.turn}:${room?.game.log.length}`;
  useEffect(() => setWord(''), [turnKey]);

  if (!room || !me) return null;
  const { game } = room;
  if (game.phase === 'lobby') return <SpiesLobby onLeave={onLeave} />;

  const player = (id: string) => room.players.find((p) => p.id === id);
  const myTeam = SPY_TEAMS.find((t) => game.teams[t].spymaster === me || game.teams[t].operatives.includes(me)) ?? null;
  const amSpymaster = !!myTeam && game.teams[myTeam].spymaster === me;
  const myTurn = myTeam === game.turn;
  const guessing = game.phase === 'guess' && myTurn && !amSpymaster;
  const giving = game.phase === 'clue' && myTurn && amSpymaster;
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
    if (game.phase === 'clue') return giving ? 'Your clue' : `${team} spymaster is thinking…`;
    const left = game.guessesLeft === UNLIMITED ? 'no limit' : `${game.guessesLeft} guess${game.guessesLeft === 1 ? '' : 'es'} left`;
    return `${guessing ? 'Your team is' : `${team} is`} guessing · ${left}`;
  })();

  const give = () => {
    if (typed && (!word.trim() || problem)) return;
    socket.emit('spies:clue', { word: typed ? word.trim() : null, count });
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
          {!myTeam && !ended && (
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

          <div className={`spyboard ${amSpymaster ? 'is-master' : ''} ${guessing ? 'is-guessing' : ''}`}>
            {game.board.map((card, i) => {
              const color = card.revealed ?? (amSpymaster || ended ? truth(i) : null);
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

          <footer className="spyctl">
            {giving && (
              <form
                className="spyclue"
                onSubmit={(e) => {
                  e.preventDefault();
                  give();
                }}
              >
                {typed ? (
                  <input
                    className="field__input spyclue__word"
                    value={word}
                    maxLength={20}
                    placeholder="One-word clue"
                    autoFocus
                    onChange={(e) => setWord(e.target.value)}
                  />
                ) : (
                  <span className="spyclue__say">Say your clue out loud, then set the number:</span>
                )}
                <select className="spyclue__count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {COUNTS.map((n) => <option key={n} value={n}>{countLabel(n)}</option>)}
                </select>
                <button type="submit" className="btn btn--primary" disabled={typed && (!word.trim() || !!problem)}>
                  {typed ? 'Give clue' : 'Clue given'}
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
            {amSpymaster && !ended && !giving && (
              <p className="settings__note">You can see the key. Keep a straight face.</p>
            )}
            {ended && isHost && (
              <div className="spyguess">
                <button type="button" className="btn btn--primary" onClick={() => socket.emit('spies:rematch')}>New board, same teams</button>
                <button type="button" className="btn" onClick={() => socket.emit('spies:toLobby')}>Change teams</button>
              </div>
            )}
          </footer>
        </main>

        <aside className="spies__side">
          <section className="card spylog">
            <h2 className="card__title">Clues</h2>
            {game.log.length === 0 ? (
              <p className="settings__note settings__note--left">No clues yet.</p>
            ) : (
              <ol className="spylog__list">
                {[...game.log].reverse().map((c, i) => (
                  <li key={game.log.length - i} className={`spylog__item spylog__item--${c.team}`}>
                    <span className="spylog__clue">{c.word ?? '(spoken)'} <b>{countLabel(c.count)}</b></span>
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
          <Chat />
        </aside>
      </div>
    </div>
  );
}
