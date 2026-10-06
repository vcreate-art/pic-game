import type { GameKind } from '@pic-game/shared';

/** One finished game, kept so a session can be looked back over. */
export interface GameResult {
  kind: GameKind;
  winners: string[];
  at: number;
}

const HISTORY_KEPT = 20;

/** Everyone tied on the highest score, for games won on points. Nobody wins
 *  if the best score is zero. */
export function topScorers(scores: Record<string, number>): string[] {
  const best = Math.max(0, ...Object.values(scores));
  return best > 0 ? Object.keys(scores).filter((id) => scores[id] === best) : [];
}

/**
 * What a room remembers across games. A room swaps its game object when the
 * host switches to a different game; this is handed from one to the next, so
 * the group's wins and the host's kicks carry over.
 */
export class RoomSession {
  /** Wins this session, by player id. */
  readonly wins = new Map<string, number>();
  /**
   * Seat tokens the host has removed.
   *
   * With no accounts a kick is a soft block: it stops the client reconnecting
   * and stops a return through the invite link on the same seat, which covers
   * ordinary nuisance. Someone determined can clear their session and come back
   * as a new player. Keying on IP would be stronger but would eject everyone
   * behind the same router, which is how this gets played over home Wi-Fi.
   */
  readonly banned = new Set<string>();
  /** Games finished, including ones nobody won. */
  games = 0;
  history: GameResult[] = [];

  /** Counts a finished game. Everyone in `winners` gets a win, so a tie is a
   *  win for each; an empty list is a game nobody won. */
  record(kind: GameKind, winners: readonly string[]): void {
    const ids = [...new Set(winners)];
    for (const id of ids) this.wins.set(id, (this.wins.get(id) ?? 0) + 1);
    this.games += 1;
    this.history = [...this.history, { kind, winners: ids, at: Date.now() }].slice(-HISTORY_KEPT);
  }

  /** Takes back the most recent result, when a host undoes the move that
   *  ended a game. */
  revokeLast(): void {
    const last = this.history.at(-1);
    if (!last) return;
    for (const id of last.winners) {
      const n = (this.wins.get(id) ?? 0) - 1;
      if (n > 0) this.wins.set(id, n);
      else this.wins.delete(id);
    }
    this.games = Math.max(0, this.games - 1);
    this.history = this.history.slice(0, -1);
  }

  /** Wins for the given players, leaving out anyone with none. */
  winsOf(ids: Iterable<string>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of ids) {
      const n = this.wins.get(id);
      if (n) out[id] = n;
    }
    return out;
  }
}
