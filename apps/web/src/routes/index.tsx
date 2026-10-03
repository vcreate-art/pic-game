import { useState, useSyncExternalStore } from 'react';
import { GAME_LABELS, PLAYABLE_KINDS, type GameKind, type JoinAck } from '@pic-game/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import {
  ChessKnight, Crosshair, Footprints, Grid3x3, PawPrint, Pencil, Rocket, Spade, Swords, Trophy, VenetianMask,
  type LucideIcon,
} from 'lucide-react';
import { JoinPanel, type Identity } from '../components/JoinPanel.js';
import { peekRoom } from '../api/client.js';
import { getSocket, saveSeat } from '../net/socket.js';
import { useGame } from '../store/game.js';
import { Route as rootRoute } from './__root.js';

/** A Record rather than a lookup chain, so a new GameKind fails to compile
 *  until it has an icon. */
const GAME_ICONS: Record<GameKind, LucideIcon> = {
  skribbl: Pencil,
  kungfu: ChessKnight,
  realms: Rocket,
  fight: Swords,
  race: Footprints,
  spies: VenetianMask,
  bingo: Grid3x3,
  cryptid: PawPrint,
  flip7: Spade,
  maze: Crosshair,
  tourney: Trophy,
};

/** Matches the breakpoint where .landing__cols stacks. */
const NARROW = '(max-width: 900px)';
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const useNarrow = () => useSyncExternalStore(subscribe, () => window.matchMedia(NARROW).matches);

function Landing() {
  const navigate = useNavigate();
  const narrow = useNarrow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [game, setGame] = useState<GameKind>('skribbl');
  const joining = code.trim().length > 0;

  /** Join and create both land here: take the seat and go to the room. */
  const enter = (res: JoinAck) => {
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    useGame.getState().setMe(res.playerId);
    useGame.getState().sync(res.state);
    saveSeat({ code: res.state.code, playerId: res.playerId, token: res.token });
    void navigate({ to: '/room/$code', params: { code: res.state.code } });
  };

  const go = (id: Identity) => {
    setBusy(true);
    setError(null);
    const socket = getSocket();
    const wanted = code.trim().toUpperCase();

    if (!wanted) {
      socket.emit('room:create', { name: id.name, avatar: id.avatar, game }, enter);
      return;
    }

    // Preflight over HTTP so a typo gives a clear message instead of a silent failure.
    peekRoom(wanted)
      .then((peek) => {
        if (!peek.exists) {
          setBusy(false);
          setError('No room with that code.');
          return;
        }
        socket.emit('room:join', { code: wanted, name: id.name, avatar: id.avatar }, enter);
      })
      .catch(() => {
        setBusy(false);
        setError('Could not reach the server.');
      });
  };

  // Hidden once a code is typed: joining an existing room inherits whichever
  // game that room was created with.
  const picker = !joining && (
    <div className="picker">
      {PLAYABLE_KINDS.map((k) => {
        const Icon = GAME_ICONS[k];
        return (
          <button
            key={k}
            type="button"
            className={`pick ${game === k ? 'is-active' : ''}`}
            aria-pressed={game === k}
            onClick={() => setGame(k)}
          >
            <Icon className="pick__art" aria-hidden="true" strokeWidth={1.75} />
            <strong>{GAME_LABELS[k].name}</strong>
            <span>{GAME_LABELS[k].blurb}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="landing">
      <div className="landing__hero">
        <h1 className="landing__title">Pick your game.</h1>
        <p className="landing__sub">Grab some friends. One link, everyone's in.</p>
      </div>

      <div className={`landing__cols ${joining ? 'is-single' : ''}`}>
        {!narrow && picker}

        <div className="card landing__card">
          <JoinPanel
            submitLabel={joining ? 'Join room' : `Create ${GAME_LABELS[game].name}`}
            busy={busy}
            error={error}
            onSubmit={go}
          >
            <label className="field">
              <span className="field__label">Room code <em>— leave blank to start a new one</em></span>
              <input
                className="field__input field__input--code"
                value={code}
                maxLength={6}
                placeholder="ABC123"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </label>
            {/* On a phone, joining comes first: name and code at the top, and
                the games sit between the code and the button so a host picks
                one right above where they tap Create. */}
            {narrow && picker && (
              <div className="field">
                <span className="field__label">Or start a new game</span>
                {picker}
              </div>
            )}
          </JoinPanel>
        </div>
      </div>
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Landing,
});
