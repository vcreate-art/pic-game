import type { GameKind } from '@pic-game/shared';

/** One finished game, kept so a session can be looked back over. */
export interface GameResult {
  kind: GameKind;
  winners: string[];
  /** Everyone who took part, winners included. */
  players: string[];
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
  /** The same wins split by game, by player id. */
  readonly winsByGame = new Map<string, Partial<Record<GameKind, number>>>();
  /** Games each player took part in, so someone who joined late is measured
   *  against the games they were there for. */
  readonly played = new Map<string, number>();
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
   *  win for each; an empty list is a game nobody won. Everyone in `players`
   *  played it, and so does every winner. */
  record(kind: GameKind, winners: readonly string[], players: readonly string[] = []): void {
    const ids = [...new Set(winners)];
    const took = [...new Set([...players, ...ids])];
    for (const id of ids) {
      this.wins.set(id, (this.wins.get(id) ?? 0) + 1);
      const by = this.winsByGame.get(id) ?? {};
      by[kind] = (by[kind] ?? 0) + 1;
      this.winsByGame.set(id, by);
    }
    for (const id of took) this.played.set(id, (this.played.get(id) ?? 0) + 1);
    this.games += 1;
    this.history = [...this.history, { kind, winners: ids, players: took, at: Date.now() }].slice(-HISTORY_KEPT);
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
      const by = this.winsByGame.get(id);
      if (by) {
        const k = (by[last.kind] ?? 0) - 1;
        if (k > 0) by[last.kind] = k;
        else delete by[last.kind];
        if (!Object.keys(by).length) this.winsByGame.delete(id);
      }
    }
    for (const id of last.players) {
      const n = (this.played.get(id) ?? 0) - 1;
      if (n > 0) this.played.set(id, n);
      else this.played.delete(id);
    }
    this.games = Math.max(0, this.games - 1);
    this.history = this.history.slice(0, -1);
  }

  /** Wins for the given players, leaving out anyone with none. */
  winsOf(ids: Iterable<string>): Record<string, number> {
    return pick(this.wins, ids);
  }

  /** Games played by the given players, leaving out anyone with none. */
  playedOf(ids: Iterable<string>): Record<string, number> {
    return pick(this.played, ids);
  }

  /** Wins by game for the given players, leaving out anyone with none. */
  winsByGameOf(ids: Iterable<string>): Record<string, Partial<Record<GameKind, number>>> {
    return pick(this.winsByGame, ids);
  }
}

function pick<T>(from: Map<string, T>, ids: Iterable<string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of ids) {
    const v = from.get(id);
    if (v) out[id] = v;
  }
  return out;
}
