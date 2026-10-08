import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  DEFAULT_SETTINGS, quantize, type CanvasOp, type ChatMessage, type Phase, type Player, type SkribblRoomState,
} from '@pic-game/shared';
import { SkribblGame } from '../components/skribbl/SkribblGame.js';
import { getEngine } from '../canvas/engineInstance.js';
import { getSocket } from '../net/socket.js';
import { useGame } from '../store/game.js';

/**
 * Draw & Guess with a made-up room, for working on its screens without
 * playing a game: no server, no second player. Development only.
 *
 * ?as=guesser|drawer and ?phase=choosing|drawing|turnEnd set the scene,
 * ?players=N (up to 16) fills the room, and
 * the panel in the corner changes them, adds guesses, or keeps a stream of
 * them coming. Guesses you type show up locally, since nothing is listening.
 */

const ME = 'me';
const WORD = 'penguin';
const PEOPLE: Player[] = [
  { id: ME, name: 'You', avatar: { color: 2, face: 3 }, score: 120, connected: true },
  { id: 'ana', name: 'Ana', avatar: { color: 5, face: 1 }, score: 340, connected: true },
  { id: 'ben', name: 'Ben', avatar: { color: 8, face: 6 }, score: 90, connected: true },
  { id: 'cat', name: 'Priya', avatar: { color: 11, face: 4 }, score: 0, connected: true },
];
const GUESSES = ['bird?', 'a duck', 'is it an owl', 'snowman', 'pingu!!', 'tuxedo', 'a fish', 'orca', 'puffin', 'nun'];

/** A penguin-ish drawing, so the canvas isn't blank. */
function sampleOps(): CanvasOp[] {
  const stroke = (id: string, color: string, size: number, pts: [number, number][]): CanvasOp => ({
    kind: 'stroke', id, by: 'ana', tool: 'pen', color, size, pts: pts.flatMap(([x, y]) => quantize(x, y)),
  });
  const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
    Array.from({ length: 41 }, (_, i) => [cx + rx * Math.cos((i / 40) * 2 * Math.PI), cy + ry * Math.sin((i / 40) * 2 * Math.PI)] as [number, number]);
  return [
    stroke('body', '#000000', 8, ellipse(400, 330, 130, 190)),
    stroke('belly', '#000000', 6, ellipse(400, 370, 80, 130)),
    stroke('eye1', '#000000', 14, [[365, 220], [366, 221]]),
    stroke('eye2', '#000000', 14, [[435, 220], [436, 221]]),
    stroke('beak', '#f97316', 10, [[380, 250], [420, 250], [400, 278], [380, 250]]),
    stroke('feet', '#f97316', 12, [[340, 525], [380, 525]]),
    stroke('feet2', '#f97316', 12, [[420, 525], [460, 525]]),
  ];
}

/** The four regulars, then made-up others up to `count`, for a crowded room. */
function people(count: number): Player[] {
  const extra = Array.from({ length: Math.max(0, count - PEOPLE.length) }, (_, i) => ({
    id: `p${i}`, name: `Player ${i + PEOPLE.length + 1}`, avatar: { color: i % 12, face: i % 8 }, score: 5 * i, connected: true,
  }));
  return [...PEOPLE, ...extra];
}

function room(phase: Phase, drawer: string, count: number): SkribblRoomState {
  const now = Date.now();
  return {
    kind: 'skribbl',
    code: 'DEVDEV',
    players: people(count),
    hostId: ME,
    serverTime: now,
    meta: {
      stage: 'playing', paused: null, countdown: null, wins: {}, winsByGame: {}, played: {}, games: 0,
      can: { pause: false, restart: true, toLobby: true, switch: true },
    },
    phase,
    settings: DEFAULT_SETTINGS,
    round: 1,
    turn: {
      drawerId: drawer, round: 1, turnIndex: 0,
      mask: WORD.replace(/./g, '_'), revealed: { 2: 'n' },
      endsAt: now + 70_000, guessed: ['ben'], likes: [], dislikes: [],
    },
    ops: sampleOps(),
    gallery: [],
  };
}

let nextId = 0;
const say = (name: string, text: string, kind: ChatMessage['kind'] = 'chat'): ChatMessage => ({
  id: `dev-${nextId++}`, kind, name, playerId: PEOPLE.find((p) => p.name === name)?.id, text, at: Date.now(),
});

export default function DrawGuessPreview() {
  const search = useSearch({ strict: false }) as { as?: string; phase?: string; players?: string };
  const navigate = useNavigate();
  const as = search.as === 'drawer' ? 'drawer' : 'guesser';
  const phase = (['choosing', 'drawing', 'turnEnd'].includes(search.phase ?? '') ? search.phase : 'drawing') as Phase;
  const [stream, setStream] = useState(false);
  const [open, setOpen] = useState(false);
  const count = Math.min(16, Math.max(PEOPLE.length, Number(search.players) || PEOPLE.length));
  const state = useMemo(() => room(phase, as === 'drawer' ? ME : 'ana', count), [as, phase, count]);

  // The scene: the room, who we are, what's been said, and the word if ours.
  useEffect(() => {
    const g = useGame.getState();
    // No real room is connected; without this the header says "Reconnecting".
    g.setConnected(true);
    g.setMe(ME);
    g.sync(state);
    if (as === 'drawer') g.setSecret(WORD);
    if (!g.messages.length) {
      for (const m of [say('', 'Ana is drawing', 'divider'), say('Ben', 'a bird'), say('Priya', 'is it a duck?'), say('Ben', 'Ben guessed the word!', 'correct')]) {
        g.pushMessage(m);
      }
    }
    // The canvas attaches when the game mounts; draw once it has.
    const t = setTimeout(() => getEngine().replay(state.ops), 50);
    return () => clearTimeout(t);
  }, [state, as]);

  useEffect(() => () => useGame.getState().reset(), []);

  // Nobody's listening to the socket here: show our own guesses ourselves.
  useEffect(() => {
    const socket = getSocket();
    const emit = socket.emit.bind(socket);
    (socket as unknown as { emit: (...a: unknown[]) => unknown }).emit = (ev: unknown, ...rest: unknown[]) => {
      if (ev === 'chat:guess') {
        useGame.getState().pushMessage(say('You', (rest[0] as { text: string }).text));
        return socket;
      }
      return (emit as (...a: unknown[]) => unknown)(ev, ...rest);
    };
    return () => {
      (socket as unknown as { emit: unknown }).emit = emit;
    };
  }, []);

  useEffect(() => {
    if (!stream) return;
    const t = setInterval(() => {
      const who = PEOPLE[1 + Math.floor(Math.random() * 3)]!;
      useGame.getState().pushMessage(say(who.name, GUESSES[Math.floor(Math.random() * GUESSES.length)]!));
    }, 900);
    return () => clearInterval(t);
  }, [stream]);

  const go = (patch: Record<string, string>) =>
    void navigate({ to: '/dev/draw-guess', search: { as, phase, ...(count > PEOPLE.length ? { players: String(count) } : {}), ...patch } as never });

  return (
    <>
      <SkribblGame />
      <div className={`devpanel ${open ? '' : 'is-closed'}`}>
        <button type="button" className="devpanel__toggle" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Dev'}
        </button>
        {open && (
          <>
            <div className="devpanel__row">
              {(['guesser', 'drawer'] as const).map((a) => (
                <button key={a} type="button" className={a === as ? 'is-on' : ''} onClick={() => go({ as: a })}>
                  {a}
                </button>
              ))}
            </div>
            <div className="devpanel__row">
              {(['choosing', 'drawing', 'turnEnd'] as const).map((p) => (
                <button key={p} type="button" className={p === phase ? 'is-on' : ''} onClick={() => go({ phase: p })}>
                  {p}
                </button>
              ))}
            </div>
            <div className="devpanel__row">
              <button type="button" onClick={() => useGame.getState().pushMessage(say('Ana', GUESSES[nextId % GUESSES.length]!))}>
                + guess
              </button>
              <button type="button" className={stream ? 'is-on' : ''} onClick={() => setStream((s) => !s)}>
                stream
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
