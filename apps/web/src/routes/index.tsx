import { useEffect, useState, type CSSProperties } from 'react';
import { GAME_LABELS, type GameKind, type JoinAck } from '@pic-game/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { CategoryLabel } from '../components/CategoryLabel.js';
import { GameCovers } from '../components/GameCovers.js';
import { GAME_ICONS } from '../components/gameIcons.js';
import { JoinPanel, initialIdentity, type Identity } from '../components/JoinPanel.js';
import { SleepingCat } from '../components/SleepingCat.js';
import posthog, { isPostHogEnabled } from '../lib/posthog.js';
import { logGameEntry } from '../lib/posthogLogs.js';
import { peekRoom } from '../api/client.js';
import { getSocket, saveSeat } from '../net/socket.js';
import { useGame } from '../store/game.js';
import { Route as rootRoute } from './__root.js';
import vcreateLogo from '../assets/vcreate-logo.svg';

/** The cat on the join card is a rare find: one page load in fifty. */
const CAT_CHANCE = 0.02;

/** Whether this page load gets the cat. `?cat` in the address always does,
 *  for seeing and testing it. */
function catShows(): boolean {
  return new URLSearchParams(window.location.search).has('cat') || Math.random() < CAT_CHANCE;
}

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
  const [cat] = useState(catShows);

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
  const enter = (res: JoinAck, event: 'game_created' | 'room_joined') => {
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    if (isPostHogEnabled) posthog.capture(event, { game_kind: res.state.kind, entry_point: 'landing' });
    logGameEntry(event === 'game_created' ? 'created' : 'joined', res.state.kind, 'landing');
    useGame.getState().setMe(res.playerId);
    useGame.getState().sync(res.state);
    saveSeat({ code: res.state.code, playerId: res.playerId, token: res.token });
    void navigate({ to: '/room/$code', params: { code: res.state.code } });
  };

  const create = (id: Identity) => {
    if (!game) return;
    setBusy(true);
    setError(null);
    getSocket().emit('room:create', { name: id.name, avatar: id.avatar, game }, (res) => enter(res, 'game_created'));
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
        getSocket().emit('room:join', { code: wanted, name: id.name, avatar: id.avatar }, (res) => enter(res, 'room_joined'));
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

        <section className={`landing__section landing__join ${cat ? 'has-cat' : ''}`} aria-label="Join a room">
          <div className="card landing__card">
            {cat && <SleepingCat />}
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
          <GameCovers surface="landing" onPick={open} active={game} />
        </section>
      </div>

      <footer className="landing__credit">
        <a href="https://vcreate.art" target="_blank" rel="noopener noreferrer">
          <span>Powered by</span>
          <img src={vcreateLogo} alt="Vcreate.art" width={92} height={28} />
        </a>
      </footer>

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
              <div className="sheet__titles">
                <h2 id="create-title" className="sheet__title">{GAME_LABELS[game].name}</h2>
                <CategoryLabel kind={game} className="sheet__cat" />
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
