import { useEffect, useState, type CSSProperties } from 'react';
import { GAME_LABELS, PLAYABLE_KINDS, type GameKind, type JoinAck } from '@pic-game/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import {
  ChessKnight, Crosshair, Footprints, Grid3x3, PawPrint, Pencil, Rocket, Spade, Swords, Trophy, VenetianMask, X,
  type LucideIcon,
} from 'lucide-react';
import { JoinPanel, initialIdentity, type Identity } from '../components/JoinPanel.js';
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

function Landing() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  // The game whose Create card is open, if any.
  const [game, setGame] = useState<GameKind | null>(null);
  // One name and avatar for both cards, so a name typed to join carries over
  // when the player picks a game instead.
  const [draft, setDraft] = useState(initialIdentity);

  const open = (k: GameKind) => {
    setError(null);
    setGame(k);
  };
  const close = () => {
    if (busy) return;
    setError(null);
    setGame(null);
  };

  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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

  const create = (id: Identity) => {
    if (!game) return;
    setBusy(true);
    setError(null);
    getSocket().emit('room:create', { name: id.name, avatar: id.avatar, game }, enter);
  };

  const join = (id: Identity) => {
    const wanted = code.trim().toUpperCase();
    if (!wanted) {
      setError('Enter a room code, or pick a game below to start one.');
      return;
    }
    setBusy(true);
    setError(null);
    // Preflight over HTTP so a typo gives a clear message instead of a silent failure.
    peekRoom(wanted)
      .then((peek) => {
        if (!peek.exists) {
          setBusy(false);
          setError('No room with that code.');
          return;
        }
        getSocket().emit('room:join', { code: wanted, name: id.name, avatar: id.avatar }, enter);
      })
      .catch(() => {
        setBusy(false);
        setError('Could not reach the server.');
      });
  };

  const picked = game && GAME_ICONS[game];

  return (
    <div className="landing">
      <div className="landing__hero">
        <h1 className="landing__title">Let's play.</h1>
        <p className="landing__sub">Grab some friends. One link, everyone's in.</p>
      </div>

      <section className="landing__section landing__join">
        <h2 className="landing__heading">Join a room</h2>
        <div className="card landing__card">
          <JoinPanel
            submitLabel="Join room"
            busy={busy && !game}
            error={game ? null : error}
            onSubmit={join}
            draft={draft}
            onDraft={setDraft}
          >
            <label className="field">
              <span className="field__label">Room code</span>
              <input
                className="field__input field__input--code"
                value={code}
                maxLength={6}
                placeholder="ABC123"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </label>
          </JoinPanel>
        </div>
      </section>

      <section className="landing__section">
        <h2 className="landing__heading">Start a new game</h2>
        <div className="card">
          <div className="picker">
            {PLAYABLE_KINDS.map((k) => {
              const { icon: Icon, color } = GAME_ICONS[k];
              return (
                <button
                  key={k}
                  type="button"
                  className={`pick ${game === k ? 'is-active' : ''}`}
                  onClick={() => open(k)}
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
        </div>
      </section>

      {game && picked && (
        <div className="sheet" onClick={close}>
          <div
            className="card landing__card sheet__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
            style={{ '--game': picked.color } as CSSProperties}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet__head">
              <span className="pick__tile" aria-hidden="true">
                <picked.icon className="pick__art" strokeWidth={2} />
              </span>
              <div className="sheet__titles">
                <p className="sheet__kicker">New room</p>
                <h2 id="create-title" className="sheet__title">{GAME_LABELS[game].name}</h2>
              </div>
              <button type="button" className="sheet__close" aria-label="Close" onClick={close}>
                <X aria-hidden="true" />
              </button>
            </div>
            <p className="sheet__blurb">{GAME_LABELS[game].blurb}</p>
            <JoinPanel
              submitLabel={`Create ${GAME_LABELS[game].name}`}
              busy={busy}
              error={error}
              onSubmit={create}
              draft={draft}
              onDraft={setDraft}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Landing,
});
