import { useGame } from '../store/game.js';
import posthog, { isPostHogEnabled } from './posthog.js';

/**
 * Which games get played, read off the room state rather than the Start
 * buttons: every lobby has its own button, a start can be refused, and
 * "Play again" goes round the lobby entirely. The room moving into play, and
 * its finished-games count ticking up, are the facts. Only the host reports,
 * so a game counts once however many are in the room.
 */
/** When the game in play began, so its end can say how long it ran. Unknown
 *  to a host who took over mid-game, and they report no duration. */
let startedAt: number | null = null;

if (isPostHogEnabled) {
  useGame.subscribe((s, prev) => {
    const room = s.room;
    const before = prev.room;
    // Joining or reloading into a room isn't something happening in it.
    if (!room || !before || room.code !== before.code || s.me !== room.hostId) return;
    const props = { game_kind: room.kind, player_count: room.players.length };
    if (room.meta.stage === 'playing' && before.meta.stage !== 'playing') {
      startedAt = Date.now();
      posthog.capture('game_started', { ...props, rematch: before.meta.stage === 'ended' });
    }
    if (room.meta.games > before.meta.games) {
      const duration = startedAt === null ? null : Math.round((Date.now() - startedAt) / 1000);
      posthog.capture('game_finished', { ...props, duration_seconds: duration });
      startedAt = null;
    }
  });
}

/** The lobby visit under way: when it began, in which room, and the room as
 *  last seen. Leaving clears the store before we hear of it, so what the
 *  event says about the room has to be kept as we go. */
let lobby: {
  code: string;
  since: number;
  returned: boolean;
  room: { game_kind: string; player_count: number; is_host: boolean };
} | null = null;

type LobbyOutcome = 'game_started' | 'left_room' | 'kicked' | 'closed_page';

/** How long someone sat in a lobby, and what ended it. Every player reports
 *  their own wait, since each waits on their own clock. */
function endLobby(outcome: LobbyOutcome, beacon = false) {
  if (!lobby) return;
  posthog.capture(
    'lobby_exited',
    {
      outcome,
      duration_seconds: Math.round((Date.now() - lobby.since) / 100) / 10,
      returned_from_game: lobby.returned,
      ...lobby.room,
    },
    // The page is going away, so it can't wait for the next batch.
    beacon ? { transport: 'sendBeacon' } : undefined,
  );
  lobby = null;
}

if (isPostHogEnabled) {
  useGame.subscribe((s, prev) => {
    const room = s.room;
    if (lobby && (!room || room.code !== lobby.code)) {
      endLobby(s.kickedBy ? 'kicked' : 'left_room');
    } else if (lobby && room && room.meta.stage !== 'lobby') {
      endLobby('game_started');
    }
    if (!room || room.meta.stage !== 'lobby') return;
    const seen = { game_kind: room.kind, player_count: room.players.length, is_host: room.hostId === s.me };
    if (lobby) {
      lobby.room = seen;
    } else {
      const before = prev.room?.code === room.code ? prev.room.meta.stage : null;
      lobby = { code: room.code, since: Date.now(), returned: !!before && before !== 'lobby', room: seen };
    }
  });
  window.addEventListener('pagehide', () => endLobby('closed_page', true));
}
