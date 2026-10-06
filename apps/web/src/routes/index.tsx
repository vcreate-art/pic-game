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
 *  neighbours in the grid don't blur together, and each one is dark enough
 *  to carry white text (4.5:1 or better). */
const GAME_ICONS: Record<GameKind, { icon: LucideIcon; color: string }> = {
  skribbl: { icon: Pencil, color: '#b3245f' },
  kungfu: { icon: ChessKnight, color: '#0f6e66' },
  realms: { icon: Rocket, color: '#4b2fa8' },
  fight: { icon: Swords, color: '#b8231f' },
  race: { icon: Footprints, color: '#c4501a' },
  spies: { icon: VenetianMask, color: '#1d4f86' },
  bingo: { icon: Grid3x3, color: '#23803f' },
  cryptid: { icon: PawPrint, color: '#5a6b1f' },
  flip7: { icon: Spade, color: '#9a2a8f' },
  maze: { icon: Crosshair, color: '#2b3fbf' },
  tourney: { icon: Trophy, color: '#9a6a00' },
};

/** While a phone's on-screen keyboard is up, `top` and `bottom` that fit a
 *  fixed overlay into the space above it. Mobile browsers don't shrink the
 *  layout for the keyboard, so a sheet pinned to the bottom would sit under
 *  it. With no keyboard this returns nothing and CSS's `inset: 0` does the
 *  job, which also follows the address bar as it shows and hides. */
function useKeyboardInset(active: boolean): CSSProperties | undefined {
  const [inset, setInset] = useState<CSSProperties>();
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const update = () => {
      const below = window.innerHeight - vv.offsetTop - vv.height;
      // The address bar moves things by well under this; a keyboard by more.
      setInset(below > 100 ? { top: vv.offsetTop, bottom: below } : undefined);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setInset(undefined);
    };
  }, [active]);
  return inset;
}

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
      setError('Enter a room code, or pick a game to start one.');
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
  const inset = useKeyboardInset(!!game);

  return (
    <div className="landing landing--home">

      <div className="landing__cols">
        {/* Its own row, so the join card's top edge lines up with the first
            row of covers rather than with this heading. */}
        <div className="landing__intro">
          <h1 className="landing__title">Pick a game</h1>
          <p className="landing__sub">Start a room, then send friends the code.</p>
        </div>

        <section className="landing__section landing__join" aria-label="Join a room">
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
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                />
              </label>
            </JoinPanel>
          </div>
        </section>

        <section className="landing__section landing__start">
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
                  <span className="pick__cover">
                    <span className="pick__flip">
                      <span className="pick__face">
                        <Icon className="pick__art" strokeWidth={1.75} aria-hidden="true" />
                        <strong className="pick__name">{GAME_LABELS[k].name}</strong>
                      </span>
                      <span className="pick__face pick__face--back">{GAME_LABELS[k].blurb}</span>
                    </span>
                  </span>
                  {/* Where there's no hover to turn the cover over, the blurb
                      sits under it instead. The back face already reads it out. */}
                  <span className="pick__blurb" aria-hidden="true">{GAME_LABELS[k].blurb}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {game && picked && (
        <div className="sheet" style={inset} onClick={close}>
          <div
            className="card landing__card sheet__card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
            style={{ '--game': picked.color } as CSSProperties}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet__head">
              <span className="sheet__tile" aria-hidden="true">
                <picked.icon strokeWidth={2} />
              </span>
              <h2 id="create-title" className="sheet__title">{GAME_LABELS[game].name}</h2>
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
