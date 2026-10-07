import type { CSSProperties } from 'react';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { Bug } from 'lucide-react';
import { ProfileChip } from '../components/ProfileChip.js';
import { CountdownOverlay } from '../components/CountdownOverlay.js';
import { PausedOverlay } from '../components/PausedOverlay.js';
import { RoomPanel } from '../components/RoomPanel.js';
import { GAME_ICONS } from '../components/gameIcons.js';
import { isPostHogEnabled } from '../lib/posthog.js';
import { useGame } from '../store/game.js';

function RootLayout() {
  const connected = useGame((s) => s.connected);
  const notice = useGame((s) => s.notice);
  const kind = useGame((s) => s.room?.kind);
  const inRoom = !!kind;

  // In a room the whole screen wears the game's colour, the same one its
  // cover wore on the front page.
  return (
    <div
      className={inRoom ? 'app is-room' : 'app'}
      data-game={kind}
      style={kind ? ({ '--game': GAME_ICONS[kind].color } as CSSProperties) : undefined}
    >
      <header className="topbar">
        {/* In a room, the room itself takes the brand's place. */}
        {inRoom ? (
          <div className="topbar__room">
            <RoomPanel />
          </div>
        ) : (
          <a className="brand" href="/">
            <span className="brand__mark">🎲</span>
            <span className="brand__name">Game Night</span>
          </a>
        )}
        <div className="topbar__right">
          {/* Only worth a word when something is wrong. */}
          {inRoom && !connected && <span className="conn is-off">Reconnecting…</span>}
          {/* PostHog opens the bug-report survey on a click here, matched by
              this id in the survey's settings. Without PostHog, nothing would. */}
          {isPostHogEnabled && (
            <button type="button" id="report-bug" className="bugbtn" title="Report a bug">
              <Bug aria-hidden="true" />
              <span className="bugbtn__label">Report a bug</span>
            </button>
          )}
          <ProfileChip />
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      {inRoom && <PausedOverlay />}
      {inRoom && <CountdownOverlay />}
      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
