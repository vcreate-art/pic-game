import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  GAME_LABELS, GOD_MAX_STEP, GOD_NAMESPACE, GOD_SPEEDS,
  type GodAction, type GodClientEvents, type GodRoom, type GodRoomSummary, type GodTimelineEntry,
} from '@pic-game/shared';

/**
 * God mode: every live room, and for the one picked, its whole state as the
 * server holds it (the secret word included), its timeline, and controls,
 * the room's clock among them. One tick is a second of the room's time.
 *
 * Talks to the server's /god namespace, which wants the GOD_KEY; the key is
 * kept in this browser once it has worked.
 */

type GodSocket = Socket<Record<string, never>, GodClientEvents>;

const KEY_STORE = 'pic-game:god-key';
const ROOMS_POLL_MS = 2000;
const ROOM_POLL_MS = 400;
const TIMELINE_SHOWN = 300;

function loadKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

function saveKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORE, key);
  } catch {
    /* private mode: asked again next time */
  }
}

const secs = (ms: number) => (ms >= 10_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);
const speedLabel = (s: number) => (s === 0 ? 'Freeze' : s === 0.5 ? '×½' : `×${s}`);

/** The god socket, connected with the key; null until it is, with the
 *  server's reason when it refuses. */
function useGodSocket(key: string): { socket: GodSocket | null; error: string | null } {
  const [socket, setSocket] = useState<GodSocket | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const s: GodSocket = io(GOD_NAMESPACE, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { key },
      forceNew: true,
    });
    s.on('connect', () => {
      setError(null);
      setSocket(s);
      if (key) saveKey(key);
    });
    s.on('connect_error', (e) => {
      setSocket(null);
      setError(e.message);
    });
    s.on('disconnect', () => setSocket(null));
    return () => {
      s.close();
    };
  }, [key]);
  return { socket, error };
}

function KeyForm({ error, onKey }: { error: string; onKey: (k: string) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <form
      className="card god__key"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) onKey(draft.trim());
      }}
    >
      <h2 className="card__title">God mode</h2>
      <p className="god__muted">{error}</p>
      <input
        className="god__input"
        type="password"
        autoFocus
        placeholder="GOD_KEY"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button className="btn btn--primary" type="submit">Open</button>
    </form>
  );
}

export default function GodView() {
  const [key, setKey] = useState(loadKey);
  const { socket, error } = useGodSocket(key);
  const [rooms, setRooms] = useState<GodRoomSummary[]>([]);
  // ?room=CODE opens that room straight away.
  const [code, setCode] = useState<string | null>(() => new URLSearchParams(location.search).get('room')?.toUpperCase() || null);

  useEffect(() => {
    if (!socket) return;
    const poll = () => socket.emit('god:rooms', setRooms);
    poll();
    const t = setInterval(poll, ROOMS_POLL_MS);
    return () => clearInterval(t);
  }, [socket]);

  if (error && !socket) return <div className="god"><KeyForm error={error} onKey={setKey} /></div>;
  if (!socket) return <div className="god"><p className="god__muted">Connecting…</p></div>;

  return (
    <div className="god">
      <header className="god__head">
        <h1 className="god__title">God mode</h1>
        <span className="god__muted">{rooms.length} room{rooms.length === 1 ? '' : 's'} live · 1 tick = 1s of room time</span>
      </header>
      <div className="god__layout">
        <nav className="god__rooms">
          {rooms.length === 0 && <p className="god__muted">No rooms right now.</p>}
          {rooms.map((r) => (
            <button
              key={r.code}
              className={`god__room${r.code === code ? ' is-on' : ''}`}
              onClick={() => setCode(r.code)}
            >
              <strong>{r.code}</strong>
              <span>{GAME_LABELS[r.kind].name}</span>
              <span className="god__muted">{r.phase} · {r.connected}/{r.players} here</span>
            </button>
          ))}
        </nav>
        {code ? <RoomPanel key={code} socket={socket} code={code} /> : <p className="god__muted">Pick a room.</p>}
      </div>
    </div>
  );
}

function RoomPanel({ socket, code }: { socket: GodSocket; code: string }) {
  const [room, setRoom] = useState<GodRoom | null | undefined>(undefined);
  const [timeline, setTimeline] = useState<GodTimelineEntry[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [stepBy, setStepBy] = useState(5);
  const [raw, setRaw] = useState(false);
  const since = useRef(0);

  useEffect(() => {
    let live = true;
    since.current = 0;
    setTimeline([]);
    // Polls can overlap (a slow reply, or several sent at once on reconnect),
    // each asking from the same `since`, so only entries past the newest one
    // shown are kept.
    const poll = () =>
      socket.emit('god:room', { code, since: since.current }, (r) => {
        if (!live) return;
        setRoom(r);
        const fresh = r ? r.timeline.filter((e) => e.seq > since.current) : [];
        if (fresh.length === 0) return;
        since.current = fresh.at(-1)!.seq;
        setTimeline((t) => [...t, ...fresh].slice(-TIMELINE_SHOWN));
      });
    poll();
    const t = setInterval(poll, ROOM_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [socket, code]);

  const act = useCallback(
    (action: GodAction) =>
      socket.emit('god:act', { code, action }, (r) => {
        if (!r.ok) {
          setFlash(r.message);
          setTimeout(() => setFlash(null), 3000);
        }
      }),
    [socket, code],
  );

  if (room === undefined) return <p className="god__muted">Loading {code}…</p>;
  if (room === null) return <p className="god__muted">{code} is gone.</p>;

  const { clock } = room;
  const d = room.details as unknown as DrawGuessDetails;
  const drawGuess = room.kind === 'skribbl';

  return (
    <section className="god__room-view">
      <div className="god__bar">
        <h2 className="god__code">{room.code}</h2>
        <span>{GAME_LABELS[room.kind].name} · {room.stage}{drawGuess ? ` · ${d.phase}` : ''}</span>
        {room.paused && <span className="god__tag">{room.countdown ? `counting in (${room.countdown.kind})` : 'paused'}</span>}
        <a className="god__muted" href={`/room/${room.code}`} target="_blank" rel="noreferrer">open the room ↗</a>
      </div>
      {flash && <p className="god__flash">{flash}</p>}

      <div className="god__grid">
        <div className="card">
          <h3 className="card__title">Clock</h3>
          <div className="god__ticks">
            <span><strong>{clock.tick}</strong> room ticks</span>
            <span><strong>{clock.gameTick ?? '–'}</strong> game ticks</span>
            <span className={clock.speed === 0 ? 'god__tag' : ''}>{clock.speed === 0 ? 'frozen' : `×${clock.speed}`}</span>
          </div>
          {clock.controllable ? (
            <>
              <div className="god__row">
                {GOD_SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={`btn ${clock.speed === s ? 'btn--primary' : ''}`}
                    onClick={() => act({ kind: 'speed', speed: s })}
                  >
                    {speedLabel(s)}
                  </button>
                ))}
              </div>
              <div className="god__row">
                <button className="btn" onClick={() => act({ kind: 'step', ticks: 1 })}>+1 tick</button>
                <input
                  className="god__input god__input--num"
                  type="number"
                  min={1}
                  max={GOD_MAX_STEP}
                  value={stepBy}
                  onChange={(e) => setStepBy(Math.max(1, Math.min(GOD_MAX_STEP, Number(e.target.value) || 1)))}
                />
                <button className="btn" onClick={() => act({ kind: 'step', ticks: stepBy })}>+{stepBy} ticks</button>
                <button className="btn" onClick={() => act({ kind: 'next' })} disabled={clock.pending.length === 0}>
                  Next event
                </button>
              </div>
            </>
          ) : (
            <p className="god__muted">This game runs on its own timers, so its clock can't be steered yet.</p>
          )}
          <ul className="god__list">
            {clock.pending.length === 0 && <li className="god__muted">Nothing due.</li>}
            {clock.pending.map((p, i) => (
              <li key={i}>
                <span>{p.label}{p.every ? ` (every ${secs(p.every)})` : ''}</span>
                <span className="god__muted">in {secs(p.inMs)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3 className="card__title">Controls</h3>
          <div className="god__row">
            {room.paused && !room.countdown
              ? <button className="btn" onClick={() => act({ kind: 'resume' })}>Resume</button>
              : <button className="btn" onClick={() => act({ kind: 'pause' })} disabled={room.stage !== 'playing'}>Pause</button>}
            <button className="btn" onClick={() => act({ kind: 'restart' })} disabled={room.stage === 'lobby'}>Restart</button>
            <button className="btn" onClick={() => act({ kind: 'lobby' })} disabled={room.stage === 'lobby'}>To lobby</button>
          </div>
          {drawGuess && (
            <div className="god__row">
              <button className="btn" onClick={() => act({ kind: 'skipTurn' })} disabled={d.phase !== 'choosing' && d.phase !== 'drawing'}>
                Skip turn
              </button>
              <button className="btn" onClick={() => act({ kind: 'endRound' })} disabled={!inTurns(d.phase)}>End round</button>
              <button className="btn" onClick={() => act({ kind: 'endGame' })} disabled={!inTurns(d.phase)}>End game</button>
            </div>
          )}
          <ul className="god__list">
            {room.players.map((p) => (
              <li key={p.id}>
                <span>
                  <span className={`god__dot${p.connected ? ' is-on' : ''}`} />
                  {p.name}{p.host ? ' (host)' : ''}
                  {p.awayForMs !== null && <span className="god__muted"> · away {secs(p.awayForMs)}</span>}
                </span>
                <span>
                  {p.score}
                  <button className="btn btn--danger god__kick" onClick={() => act({ kind: 'kick', playerId: p.id })}>Kick</button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="card__head">
            <h3 className="card__title">State</h3>
            <button className="btn btn--ghost" onClick={() => setRaw((r) => !r)}>{raw ? 'Summary' : 'Raw'}</button>
          </div>
          {raw || !drawGuess
            ? <pre className="god__raw">{JSON.stringify(room.details, null, 2)}</pre>
            : <DrawGuessState d={d} />}
        </div>

        <div className="card">
          <h3 className="card__title">Timeline</h3>
          <ol className="god__timeline">
            {timeline.length === 0 && <li className="god__muted">Nothing yet.</li>}
            {[...timeline].reverse().map((e) => (
              <li key={e.seq} className={e.text.startsWith('god:') ? 'is-god' : ''}>
                <span className="god__muted">t{e.tick}</span> {e.text}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

interface DrawGuessDetails {
  phase: string;
  round: number;
  rounds: number;
  turnIndex: number;
  order: { index: number; name: string | null; connected: boolean; drawing: boolean }[];
  deferred: string[];
  drawer: string | null;
  word: string | null;
  options: string[];
  mask: string;
  revealed: Record<number, string>;
  hintPositions: number[];
  hintsShown: number;
  endsInMs: number | null;
  guessed: string[];
  ops: number;
}

const inTurns = (phase: string) => phase === 'choosing' || phase === 'drawing' || phase === 'turnEnd';

function DrawGuessState({ d }: { d: DrawGuessDetails }) {
  const shown = d.mask.split('').map((c, i) => d.revealed[i] ?? c).join('');
  return (
    <dl className="god__facts">
      <dt>Phase</dt><dd>{d.phase}{d.endsInMs !== null ? ` · ends in ${secs(d.endsInMs)}` : ''}</dd>
      <dt>Round</dt><dd>{d.round} of {d.rounds}</dd>
      <dt>Drawer</dt><dd>{d.drawer ?? '–'}</dd>
      <dt>Word</dt><dd><strong>{d.word ?? (d.options.length ? `picking: ${d.options.join(', ')}` : '–')}</strong></dd>
      <dt>Players see</dt><dd className="god__mono">{shown || '–'}</dd>
      <dt>Hints</dt><dd>{d.hintsShown} of {d.hintPositions.length}</dd>
      <dt>Guessed</dt><dd>{d.guessed.join(', ') || '–'}</dd>
      <dt>Turn index</dt><dd>{d.turnIndex}{d.turnIndex >= d.order.length ? ' (past the order: those put back)' : ''}</dd>
      <dt>Order</dt>
      <dd>
        <ol className="god__order">
          {d.order.map((o) => (
            <li key={o.index} className={o.index === d.turnIndex ? 'is-at' : ''}>
              <span className={`god__dot${o.connected ? ' is-on' : ''}`} />
              {o.index}. {o.name}{o.drawing ? ' ✎' : ''}
            </li>
          ))}
        </ol>
      </dd>
      <dt>Put back</dt><dd>{d.deferred.join(', ') || '–'}</dd>
      <dt>Canvas</dt><dd>{d.ops} ops</dd>
    </dl>
  );
}
