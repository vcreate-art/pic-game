import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CLUE_GROUPS, HEXES, SEAT_COLORS, allClues, clueMask, clueText, hasHex, hexLabel,
  type CryptidAction, type CryptidBoard, type CryptidPublic,
} from '@pic-game/shared';
import { getSocket } from '../../net/socket.js';
import { selectCryptid, selectIsHost, useGame } from '../../store/game.js';
import { Avatar } from '../Avatar.js';
import { Chat } from '../Chat.js';
import { KickButton } from '../KickButton.js';
import { CryptidLobby } from './CryptidLobby.js';
import { HexMap, StructureGlyph, TERRAIN_NAMES } from './HexMap.js';

const SHADE_KEY = 'cryptid:shade';

function loadShade(): boolean {
  try {
    return localStorage.getItem(SHADE_KEY) === '1';
  } catch {
    return false;
  }
}

/** What is on a space, in words: terrain, territory, structure. */
function describe(board: CryptidBoard, hex: number): string {
  const parts = [TERRAIN_NAMES[board.terrain[hex]!]];
  const a = board.animal[hex];
  if (a) parts.push(`${a} territory`);
  const s = board.structures.find((x) => x.hex === hex);
  if (s) parts.push(`${s.color} ${s.shape === 'stone' ? 'standing stone' : 'shack'}`);
  return parts.join(' · ');
}

function Disk({ color }: { color: string }) {
  return <span className="cpiece cpiece--disk" style={{ background: color }} />;
}
function Cube({ color }: { color: string }) {
  return <span className="cpiece cpiece--cube" style={{ background: color }} />;
}

export function CryptidGame() {
  const room = useGame(selectCryptid);
  const me = useGame((s) => s.me);
  const myClue = useGame((s) => s.cryptidClue);
  const isHost = useGame(selectIsHost);
  const socket = getSocket();
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [shadeOn, setShadeOn] = useState(loadShade);
  const game = room?.game;
  const board = game?.board ?? null;

  // A new map clears whatever was picked on the old one.
  useEffect(() => setSelected(null), [board]);
  useEffect(() => {
    try {
      localStorage.setItem(SHADE_KEY, shadeOn ? '1' : '0');
    } catch {
      /* private mode: the toggle just is not remembered */
    }
  }, [shadeOn]);

  const myMask = useMemo(() => (board && myClue ? clueMask(board, myClue) : null), [board, myClue]);
  const shade = useMemo(() => {
    if (!shadeOn || myMask === null) return null;
    const out = new Set<number>();
    for (let h = 0; h < HEXES; h++) if (!hasHex(myMask, h)) out.add(h);
    return out;
  }, [shadeOn, myMask]);

  if (!room || !me || !game) return null;
  if (game.phase === 'lobby' || !board) return <CryptidLobby />;

  const seatOf = (id: string) => Math.max(0, game.players.indexOf(id));
  const colorOf = (id: string) => SEAT_COLORS[seatOf(id) % SEAT_COLORS.length]!;
  const name = (id: string | null) =>
    (id && (room.players.find((p) => p.id === id)?.name ?? game.departed[id])) || 'Someone';

  const playing = game.players.includes(me);
  const watchers = room.players.filter((p) => !game.players.includes(p.id));
  const myTurn = game.turn === me;
  const ended = game.phase === 'ended';
  const last = game.log.at(-1) ?? null;
  // A penalty cube is the end of the move that earned it: show them together.
  const prev = game.log.at(-2) ?? null;
  const cause = last?.kind === 'cube' && last.why !== 'setup' && prev && prev.by === last.by
    && (prev.kind === 'question' || prev.kind === 'search') ? prev : null;
  const lastRing = last && last.kind !== 'skip'
    ? { hexes: cause ? [cause.hex, last.hex] : [last.hex], color: colorOf(last.by), key: game.log.length }
    : null;

  const status = (() => {
    if (ended) return game.winner === me ? 'You found it!' : `${name(game.winner)} found the creature!`;
    const who = name(game.turn);
    if (game.phase === 'setup') {
      return myTurn
        ? `Put down a cube where your clue rules the creature out (${game.setupLeft} to go)`
        : `${who} is putting down a setup cube…`;
    }
    if (game.phase === 'penalty') {
      return myTurn ? 'Told no! Now put down a cube of your own where your clue rules it out' : `${who} owes a cube…`;
    }
    return myTurn ? 'Your turn: pick a space, then question someone or search it' : `${who}'s turn`;
  })();

  return (
    <div className="game game--cryptid">
      <div className="cryptid">
        <aside className="cryptid__people">
          <section className="card">
            <h2 className="card__title">Expedition</h2>
            <ul className="cplayers">
              {game.players.map((id) => {
                const p = room.players.find((x) => x.id === id);
                const gone = id in game.departed;
                const open = game.openClues[id];
                const nDisks = game.disks.reduce((n, d) => n + (d.includes(id) ? 1 : 0), 0);
                const nCubes = game.cubes.filter((c) => c === id).length;
                return (
                  <li
                    key={id}
                    className={[
                      'cplayer',
                      id === me ? 'is-me' : '',
                      game.turn === id ? 'is-turn' : '',
                      game.winner === id ? 'is-winner' : '',
                      gone || !p?.connected ? 'is-away' : '',
                    ].join(' ')}
                  >
                    <div className="cplayer__row">
                      <span className="cplayer__seat" style={{ background: colorOf(id) }} />
                      {p && <Avatar data={p.avatar} size={24} host={id === room.hostId} />}
                      <span className="cplayer__name">{name(id)}{gone ? ' (out)' : ''}</span>
                      <span className="cplayer__count" title={`${nDisks} disks, ${nCubes} cubes`}>
                        <Disk color={colorOf(id)} />{nDisks}
                        <Cube color={colorOf(id)} />{nCubes}
                      </span>
                      {isHost && p && id !== room.hostId && <KickButton playerId={id} name={p.name} />}
                    </div>
                    {open && <p className="cplayer__clue">{clueText(open)}</p>}
                  </li>
                );
              })}
            </ul>
            {watchers.length > 0 && (
              <>
                <h3 className="cwatchers__title">Watching</h3>
                <ul className="cwatchers">
                  {watchers.map((p) => (
                    <li key={p.id} className={p.connected ? '' : 'is-away'}>
                      <Avatar data={p.avatar} size={20} host={p.id === room.hostId} />
                      <span className="cplayer__name">{p.name}</span>
                      {isHost && p.id !== room.hostId && <KickButton playerId={p.id} name={p.name} />}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {playing && myClue && (
            <section className="card cclue">
              <h2 className="card__title">Your clue</h2>
              <p className="cclue__text">{clueText(myClue)}</p>
              <label className="cclue__shade">
                <input type="checkbox" checked={shadeOn} onChange={(e) => setShadeOn(e.target.checked)} />
                Fade out the spaces it rules out
              </label>
              {!ended && <p className="settings__note settings__note--left">Keep it to yourself.</p>}
            </section>
          )}

          {!playing && !ended && (
            <p className="card cwatch">You arrived mid-game, so you are watching this one. You are in the next.</p>
          )}

        </aside>

        <main className="cryptid__main">
          {/* Keyed on whose go it is, so the bar flashes each time the turn moves. */}
          <header
            key={`${game.turn}-${game.phase}`}
            className={`cbar ${ended ? 'is-ended' : myTurn ? 'is-mine' : ''} ${game.phase === 'penalty' && myTurn ? 'is-penalty' : ''}`}
          >
            {!ended && game.turn && <span className="cbar__seat" style={{ background: colorOf(game.turn) }} />}
            <span className="cbar__status">{status}</span>
            {!ended && (
              <ol className="ctrack" aria-label="Turn order">
                {game.players.filter((id) => !(id in game.departed)).map((id) => (
                  <li key={id} className={game.turn === id ? 'is-on' : ''} style={{ '--seat': colorOf(id) } as CSSProperties}>
                    <span className="ctrack__dot" />
                    <span className="ctrack__name">{id === me ? 'You' : name(id)}</span>
                  </li>
                ))}
              </ol>
            )}
          </header>
          {last && <LastMove key={game.log.length} action={last} cause={cause} name={name} me={me} colorOf={colorOf} />}

          <div className="cmapwrap">
            <HexMap
              board={board}
              colorOf={colorOf}
              seatOf={seatOf}
              disks={game.disks}
              cubes={game.cubes}
              selected={selected}
              focus={hover}
              last={lastRing}
              shade={shade}
              answer={game.answer}
              onPick={ended ? undefined : (h) => setSelected((s) => (s === h ? null : h))}
              onHover={setHover}
            />
          </div>
          <Legend advanced={game.settings.advanced} />
        </main>

        <aside className="cryptid__side">
          {ended ? (
            isHost && (
              <section className="card cactions">
                <button type="button" className="btn btn--primary" onClick={() => socket.emit('cryptid:rematch')}>
                  New map, play again
                </button>
                <button type="button" className="btn" onClick={() => socket.emit('cryptid:toLobby')}>
                  Back to the lobby
                </button>
              </section>
            )
          ) : (
            <Actions
              game={game}
              board={board}
              me={me}
              selected={selected}
              myMask={myMask}
              name={name}
              colorOf={colorOf}
              onDone={() => setSelected(null)}
            />
          )}

          <History log={game.log} name={name} colorOf={colorOf} onHover={setHover} />
          <ClueBook advanced={game.settings.advanced} />
          <Chat />
        </aside>
      </div>
    </div>
  );
}

/**
 * What this phase is for and what you can do in it, shown before a space is
 * picked. Questions and searches only exist on a normal turn, so setup says
 * so rather than leaving them to be discovered.
 */
function Guide({ game, myTurn, turnName }: { game: CryptidPublic; myTurn: boolean; turnName: string }) {
  if (game.phase === 'setup') {
    return (
      <>
        <strong className="cguide__title">Setup · {game.setupLeft} cube{game.setupLeft === 1 ? '' : 's'} to go</strong>
        <p className="cactions__hint">
          Everyone puts down two cubes first, each on a space their own clue rules out.
          Questions and searches start once setup is done.
        </p>
        {myTurn && <p className="cactions__hint"><b>Your go:</b> tap a space your clue rules out.</p>}
      </>
    );
  }
  if (game.phase === 'penalty' && myTurn) {
    return (
      <>
        <strong className="cguide__title">You owe a cube</strong>
        <p className="cactions__hint">You were told no, so tap a space your own clue rules out and put a cube there.</p>
      </>
    );
  }
  if (game.phase === 'turn' && myTurn) {
    return (
      <>
        <strong className="cguide__title">Your turn: do one of these</strong>
        <ul className="cguide__list">
          <li><b>Question</b>: tap a space, then pick a player. Their clue answers: a disk for could be, a cube for no.</li>
          <li><b>Search</b>: tap a space your clue allows. Everyone answers in turn; all yes and you have found it.</li>
        </ul>
      </>
    );
  }
  return <p className="cactions__hint">Waiting for {turnName}. Tap any space to see what is on it.</p>;
}

/** What the selected space allows the player to do right now. */
function Actions(props: {
  game: CryptidPublic;
  board: CryptidBoard;
  me: string;
  selected: number | null;
  myMask: bigint | null;
  name: (id: string) => string;
  colorOf: (id: string) => string;
  onDone: () => void;
}) {
  const { game, board, me, selected, myMask, name, colorOf, onDone } = props;
  const socket = getSocket();
  const myTurn = game.turn === me;
  const h = selected;

  if (h === null) {
    return (
      <section className="card cactions">
        <Guide game={game} myTurn={myTurn} turnName={game.turn ? name(game.turn) : 'Someone'} />
      </section>
    );
  }

  const closed = game.cubes[h] !== null;
  const allowed = myMask !== null && hasHex(myMask, h);
  const emit = (fn: () => void) => () => {
    fn();
    onDone();
  };

  let body: ReactNode = null;
  if (myTurn && (game.phase === 'setup' || game.phase === 'penalty')) {
    const why = closed
      ? 'That space already has a cube.'
      : game.phase === 'setup' && game.disks[h]!.length
        ? 'Setup cubes go on empty spaces.'
        : allowed
          ? 'Your clue allows the creature here. Pick a space it rules out.'
          : null;
    body = (
      <>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!!why}
          onClick={emit(() => socket.emit('cryptid:cube', { hex: h }))}
        >
          <Cube color={colorOf(me)} /> Put a cube on {hexLabel(h)}
        </button>
        {why && <p className="cactions__why">{why}</p>}
      </>
    );
  } else if (myTurn && game.phase === 'turn') {
    const others = game.players.filter((id) => id !== me);
    body = closed ? (
      <p className="cactions__why">That space is closed: a cube is on it.</p>
    ) : (
      <>
        <span className="settings__label">Question</span>
        <div className="cactions__ask">
          {others.map((id) => {
            const said = game.disks[h]!.includes(id);
            return (
              <button
                key={id}
                type="button"
                className="btn cask"
                disabled={said}
                title={said ? 'They already said it could be here' : undefined}
                onClick={emit(() => socket.emit('cryptid:question', { target: id, hex: h }))}
              >
                <span className="cplayer__seat" style={{ background: colorOf(id) }} />
                {name(id)}
                {said && <span className="cask__said">said yes</span>}
              </button>
            );
          })}
        </div>
        <span className="settings__label">or</span>
        <button
          type="button"
          className="btn btn--primary csearch"
          disabled={!allowed}
          onClick={emit(() => socket.emit('cryptid:search', { hex: h }))}
        >
          Search {hexLabel(h)}
        </button>
        {!allowed && <p className="cactions__why">You can only search where your own clue allows the creature.</p>}
      </>
    );
  }

  const here = game.disks[h]!;
  return (
    <section className="card cactions">
      <div className="cactions__space">
        <strong>{hexLabel(h)}</strong>
        <span>{describe(board, h)}</span>
      </div>
      {(here.length > 0 || closed) && (
        <p className="cactions__pieces">
          {here.map((id) => (
            <span key={id}><Disk color={colorOf(id)} /> {name(id)}</span>
          ))}
          {closed && <span><Cube color={colorOf(game.cubes[h]!)} /> {name(game.cubes[h]!)}: not here</span>}
        </p>
      )}
      {body}
    </section>
  );
}

function actionText(a: CryptidAction, name: (id: string) => string): string {
  switch (a.kind) {
    case 'cube':
      return a.why === 'penalty'
        ? `${name(a.by)} put a cube on ${hexLabel(a.hex)}`
        : a.why === 'auto'
          ? `A cube went on ${hexLabel(a.hex)} for ${name(a.by)}`
          : `${name(a.by)} set a cube on ${hexLabel(a.hex)}`;
    case 'question':
      return `${name(a.by)} asked ${name(a.target)} about ${hexLabel(a.hex)}: ${a.yes ? 'could be' : 'no'}`;
    case 'search':
      return a.found
        ? `${name(a.by)} searched ${hexLabel(a.hex)} and found it`
        : `${name(a.by)} searched ${hexLabel(a.hex)}: ${name(a.answers.at(-1)!.id)} said no`;
    case 'skip':
      return `${name(a.by)} was away and missed a turn`;
  }
}

/** A player, as the banner names them: their seat colour, then their name. */
function Who({ id, name, me, colorOf }: { id: string; name: (id: string) => string; me: string; colorOf: (id: string) => string }) {
  return (
    <span className="cwho">
      <span className="cplayer__seat" style={{ background: colorOf(id) }} />
      <b>{id === me ? 'You' : name(id)}</b>
    </span>
  );
}

/**
 * The banner under the status: the move just made, as a sentence with the
 * answer set apart in green or red. Keyed on the move, so it animates in
 * fresh each time, and edged in the colour of whoever made it.
 */
function LastMove({ action, cause, name, me, colorOf }: {
  action: CryptidAction;
  /** The question or search that earned this penalty cube, if it is one. */
  cause?: Extract<CryptidAction, { kind: 'question' | 'search' }> | null;
  name: (id: string) => string;
  me: string;
  colorOf: (id: string) => string;
}) {
  const who = (id: string) => <Who id={id} name={name} me={me} colorOf={colorOf} />;
  const space = (h: number) => <span className="clast__hex">{hexLabel(h)}</span>;
  if (cause && action.kind === 'cube') {
    // Whoever said no: the one asked, or the last to answer the search.
    const naysayer = cause.kind === 'question' ? cause.target : cause.answers.at(-1)!.id;
    const verdict = (
      <span className="clast__verdict is-no"><Cube color={colorOf(naysayer)} />{naysayer === me ? 'You' : name(naysayer)}: no</span>
    );
    return (
      <div className="clast is-no" style={{ '--actor': colorOf(action.by) } as CSSProperties}>
        <span className="clast__tag">Just now</span>
        <span className="clast__what">
          {who(action.by)} {cause.kind === 'question' ? <>asked {who(cause.target)} about</> : 'searched'} {space(cause.hex)}
          {verdict}
          <span className="clast__then">so paid a cube on</span> {space(action.hex)}
        </span>
      </div>
    );
  }
  let body: ReactNode;
  let tone = '';
  switch (action.kind) {
    case 'question':
      tone = action.yes ? 'is-yes' : 'is-no';
      body = (
        <>
          {who(action.by)} asked {who(action.target)} about {space(action.hex)}
          <span className={`clast__verdict ${tone}`}>
            {action.yes ? <Disk color={colorOf(action.target)} /> : <Cube color={colorOf(action.target)} />}
            {action.yes ? 'Could be' : 'No'}
          </span>
          {!action.yes && <span className="clast__then">{action.by === me ? 'You owe' : `${name(action.by)} owes`} a cube</span>}
        </>
      );
      break;
    case 'search': {
      const no = action.answers.find((a) => !a.yes);
      tone = action.found ? 'is-found' : 'is-no';
      body = (
        <>
          {who(action.by)} searched {space(action.hex)}
          {action.answers.map((a, i) => (
            <span
              key={a.id}
              className={`clast__verdict ${a.yes ? 'is-yes' : 'is-no'} is-step`}
              style={{ animationDelay: `${(i + 1) * 450}ms` }}
            >
              {a.yes ? <Disk color={colorOf(a.id)} /> : <Cube color={colorOf(a.id)} />}
              {a.id === me ? 'You' : name(a.id)}: {a.yes ? 'yes' : 'no'}
            </span>
          ))}
          {action.found && <span className="clast__verdict is-found is-step" style={{ animationDelay: `${(action.answers.length + 1) * 450}ms` }}>Found it 🐾</span>}
          {no && <span className="clast__then is-step" style={{ animationDelay: `${(action.answers.length + 1) * 450}ms` }}>{action.by === me ? 'You owe' : `${name(action.by)} owes`} a cube</span>}
        </>
      );
      break;
    }
    case 'cube':
      body = (
        <>
          {who(action.by)} {action.why === 'setup' ? 'set a cube on' : action.why === 'auto' ? 'was away; a cube went on' : 'paid a cube on'} {space(action.hex)}
        </>
      );
      break;
    case 'skip':
      body = <>{who(action.by)} was away, so their turn passed</>;
      break;
  }
  return (
    <div className={`clast ${tone}`} style={{ '--actor': colorOf(action.by) } as CSSProperties}>
      <span className="clast__tag">Just now</span>
      <span className="clast__what">{body}</span>
    </div>
  );
}

function History({ log, name, colorOf, onHover }: {
  log: CryptidAction[];
  name: (id: string) => string;
  colorOf: (id: string) => string;
  onHover: (hex: number | null) => void;
}) {
  if (!log.length) return null;
  return (
    <section className="card chistory">
      <h2 className="card__title">Field notes · {log.length}</h2>
      <ol className="chistory__list" onPointerLeave={() => onHover(null)}>
        {[...log].reverse().map((a, i) => (
          <li
            key={log.length - i}
            className={`chistory__item chistory__item--${a.kind} ${a.kind === 'question' && !a.yes ? 'is-no' : ''}`}
            onPointerEnter={() => onHover(a.kind === 'skip' ? null : a.hex)}
          >
            <span className="cplayer__seat" style={{ background: colorOf(a.by) }} />
            {actionText(a, name)}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Every clue that could be in play, to reason about what the others hold. */
function ClueBook({ advanced }: { advanced: boolean }) {
  const clues = useMemo(() => allClues(advanced).filter((c) => !c.not), [advanced]);
  return (
    <details className="card cbook">
      <summary className="card__title">Every possible clue</summary>
      {CLUE_GROUPS.map((g) => (
        <div key={g.title} className="cbook__group">
          <h3>{g.title}</h3>
          <ul>
            {clues.filter((c) => g.kinds.includes(c.kind)).map((c) => (
              <li key={clueText(c)}>{clueText(c).replace('The habitat is ', '')}</li>
            ))}
          </ul>
        </div>
      ))}
      {advanced && <p className="settings__note settings__note--left">Advanced: any of these may also come as a NOT clue.</p>}
    </details>
  );
}

const STRUCT_COLORS_SHOWN = ['white', 'green', 'blue', 'black'] as const;

function Legend({ advanced }: { advanced: boolean }) {
  const colors = STRUCT_COLORS_SHOWN.filter((c) => advanced || c !== 'black');
  return (
    <div className="clegend">
      <div className="clegend__group">
        {(['forest', 'desert', 'water', 'swamp', 'mountain'] as const).map((t) => (
          <span key={t} className="clegend__item"><i className={`clegend__sw clegend__sw--${t}`} />{TERRAIN_NAMES[t]}</span>
        ))}
      </div>
      <div className="clegend__group">
        <span className="clegend__item"><i className="clegend__fence clegend__fence--bear" />Bear land</span>
        <span className="clegend__item"><i className="clegend__fence clegend__fence--cougar" />Cougar land</span>
      </div>
      <div className="clegend__group">
        <span className="clegend__item">
          <svg viewBox="-9 -11 18 20" className="clegend__glyph"><StructureGlyph s={{ shape: 'stone', color: 'white' }} x={0} y={0} u={28} /></svg>
          Standing stone
        </span>
        <span className="clegend__item">
          <svg viewBox="-9 -11 18 20" className="clegend__glyph"><StructureGlyph s={{ shape: 'shack', color: 'white' }} x={0} y={0} u={28} /></svg>
          Shack
        </span>
        <span className="clegend__item clegend__colors" title="Structure colours">
          {colors.map((c) => <i key={c} className={`clegend__dot cstruct--${c}`} title={c} />)}
          {colors.join(', ')}
        </span>
      </div>
      <div className="clegend__group">
        <span className="clegend__item"><Disk color="#fff" />could be</span>
        <span className="clegend__item"><Cube color="#fff" />cannot be</span>
      </div>
    </div>
  );
}
