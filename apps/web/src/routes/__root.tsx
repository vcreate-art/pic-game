import { Outlet, createRootRoute } from '@tanstack/react-router';
import { ProfileChip } from '../components/ProfileChip.js';
import { CountdownOverlay } from '../components/CountdownOverlay.js';
import { PausedOverlay } from '../components/PausedOverlay.js';
import { RoomPanel } from '../components/RoomPanel.js';
import { useGame } from '../store/game.js';

function RootLayout() {
  const connected = useGame((s) => s.connected);
  const notice = useGame((s) => s.notice);
  const inRoom = useGame((s) => !!s.room);

  return (
    <div className="app">
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
