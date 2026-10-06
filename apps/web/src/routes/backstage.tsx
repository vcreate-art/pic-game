import { useEffect, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { GAME_LABELS, type BackstageRoom, type GameKind } from '@pic-game/shared';
import { fetchBackstage } from '../api/client.js';
import { Avatar } from '../components/Avatar.js';
import { GAME_ICONS } from '../components/gameIcons.js';
import { Route as rootRoute } from './__root.js';

const POLL_MS = 5000;

/** Re-renders once a second, so "updated 3s ago" and room ages keep moving
 *  between polls. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** 'lobby' → 'Lobby', 'roundEnd' → 'Round end', 'game-over' → 'Game over'. */
function phaseLabel(phase: string): string {
  const words = phase.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function age(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

const online = (r: BackstageRoom) => r.players.filter((p) => p.connected).length;

/** Games in progress first, then the busiest, then the oldest. */
function byActivity(a: BackstageRoom, b: BackstageRoom): number {
  return Number(a.inLobby) - Number(b.inLobby) || online(b) - online(a) || a.createdAt - b.createdAt;
}

function Backstage() {
  const now = useNow();
  const { data, error, dataUpdatedAt } = useQuery({
    queryKey: ['backstage'],
    queryFn: fetchBackstage,
    refetchInterval: POLL_MS,
    staleTime: 0,
  });

  const rooms = [...(data?.rooms ?? [])].sort(byActivity);
  const players = rooms.reduce((n, r) => n + online(r), 0);
  const playing = rooms.filter((r) => !r.inLobby).length;

  // Rooms and players per game, busiest game first.
  const perGame = new Map<GameKind, { rooms: number; players: number }>();
  for (const r of rooms) {
    const g = perGame.get(r.kind) ?? { rooms: 0, players: 0 };
    g.rooms += 1;
    g.players += online(r);
    perGame.set(r.kind, g);
  }
  const games = [...perGame].sort(([, a], [, b]) => b.players - a.players || b.rooms - a.rooms);

  const updated = Math.max(0, Math.round((now - dataUpdatedAt) / 1000));

  return (
    <div className="backstage">
      <header className="backstage__head">
        <h1 className="backstage__title">Backstage</h1>
        <p className={`backstage__status ${error ? 'is-off' : ''}`} role="status">
          {error
            ? 'Can’t reach the server. Trying again every 5 seconds.'
            : data
              ? `Live. Updated ${updated < 2 ? 'just now' : `${updated}s ago`}.`
              : 'Loading…'}
        </p>
      </header>

      {data && rooms.length === 0 && (
        <p className="backstage__empty">
          No one is playing right now. Rooms show up here as soon as someone creates one.
        </p>
      )}

      {rooms.length > 0 && (
        <>
          <p className="backstage__summary">
            <strong>{players}</strong> {players === 1 ? 'player' : 'players'} online in{' '}
            <strong>{rooms.length}</strong> {rooms.length === 1 ? 'room' : 'rooms'}.{' '}
            {playing} in a game, {rooms.length - playing} in the lobby.
          </p>

          <section className="backstage__section" aria-labelledby="bs-games">
            <h2 id="bs-games" className="backstage__heading">Games being played</h2>
            <ul className="bs-games">
              {games.map(([kind, g]) => {
                const { icon: Icon, color } = GAME_ICONS[kind];
                return (
                  <li key={kind} className="bs-game" style={{ '--game': color } as CSSProperties}>
                    <Icon className="bs-game__icon" aria-hidden="true" />
                    <span className="bs-game__name">{GAME_LABELS[kind].name}</span>
                    <span className="bs-game__count">
                      {g.players} {g.players === 1 ? 'player' : 'players'}, {g.rooms}{' '}
                      {g.rooms === 1 ? 'room' : 'rooms'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="backstage__section" aria-labelledby="bs-rooms">
            <h2 id="bs-rooms" className="backstage__heading">Rooms</h2>
            <ul className="bs-rooms">
              {rooms.map((r) => {
                const { icon: Icon, color } = GAME_ICONS[r.kind];
                const here = online(r);
                return (
                  <li key={r.id} className="bs-room" style={{ '--game': color } as CSSProperties}>
                    <div className="bs-room__game">
                      <Icon className="bs-room__icon" aria-hidden="true" />
                      <div>
                        <p className="bs-room__name">{GAME_LABELS[r.kind].name}</p>
                        <p className="bs-room__meta">
                          <span className={`bs-phase ${r.inLobby ? '' : 'is-live'}`}>{phaseLabel(r.phase)}</span>
                          <span>Open {age(now - r.createdAt)}</span>
                        </p>
                      </div>
                      <p className="bs-room__seats">
                        {here}/{r.maxPlayers} here
                      </p>
                    </div>
                    {here === 0 ? (
                      <p className="bs-room__away">Everyone has dropped out. The room closes if no one returns.</p>
                    ) : null}
                    <ul className="bs-players">
                      {r.players.map((p, i) => (
                        <li key={i} className={`bs-player ${p.connected ? '' : 'is-away'}`}>
                          <Avatar data={p.avatar} size={28} host={p.host} />
                          <span className="bs-player__name">{p.name}</span>
                          {!p.connected && <span className="bs-player__away">away</span>}
                          {/* Every seat is at 0 until a game starts. */}
                          {!r.inLobby && <span className="bs-player__score">{p.score} pts</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/** Not linked from anywhere. Open and read-only by design for now; the API
 *  behind it leaves out room codes so it can't be used to get into a game. */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backstage',
  component: Backstage,
});
