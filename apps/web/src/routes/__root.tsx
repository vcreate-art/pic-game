import { Outlet, createRootRoute } from '@tanstack/react-router';
import { ProfileChip } from '../components/ProfileChip.js';
import { useGame } from '../store/game.js';

function RootLayout() {
  const connected = useGame((s) => s.connected);
  const notice = useGame((s) => s.notice);
  const inRoom = useGame((s) => !!s.room);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand__mark">🎲</span>
          <span className="brand__name">Game Night</span>
        </a>
        <div className="topbar__right">
          {inRoom && (
            <span className={`conn ${connected ? 'is-on' : 'is-off'}`}>
              {connected ? 'connected' : 'reconnecting…'}
            </span>
          )}
          <ProfileChip />
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      {notice && <div className="notice">{notice}</div>}
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
