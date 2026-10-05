import { useState, useSyncExternalStore, type CSSProperties } from 'react';
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
 *  until it has an icon and a color. Colors are spread around the wheel so
 *  neighbours in the grid don't blur together. */
const GAME_ICONS: Record<GameKind, { icon: LucideIcon; color: string }> = {
  skribbl: { icon: Pencil, color: '#db2777' },
  kungfu: { icon: ChessKnight, color: '#0d9488' },
  realms: { icon: Rocket, color: '#7c3aed' },
  fight: { icon: Swords, color: '#dc2626' },
  race: { icon: Footprints, color: '#ea580c' },
  spies: { icon: VenetianMask, color: '#0284c7' },
  bingo: { icon: Grid3x3, color: '#16a34a' },
  cryptid: { icon: PawPrint, color: '#65a30d' },
  flip7: { icon: Spade, color: '#c026d3' },
  maze: { icon: Crosshair, color: '#2563eb' },
  tourney: { icon: Trophy, color: '#ca8a04' },
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
        const { icon: Icon, color } = GAME_ICONS[k];
        return (
          <button
            key={k}
            type="button"
            className={`pick ${game === k ? 'is-active' : ''}`}
            aria-pressed={game === k}
            onClick={() => setGame(k)}
            style={{ '--game': color } as CSSProperties}
          >
            <span className="pick__tile" aria-hidden="true">
              <Icon className="pick__art" strokeWidth={2} />
            </span>
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
