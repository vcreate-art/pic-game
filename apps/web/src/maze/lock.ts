import { PF, mazeSolidAt, type MazeFrame, type MazeMap } from '@pic-game/shared';

/** How far a keyboard lock-on reaches, and how far a locked target may get
 *  before the lock lets go. */
export const LOCK_RANGE = 650;
export const LOCK_KEEP = 900;

/** Whether nothing solid stands between two points. */
export function inSight(m: MazeMap, ax: number, ay: number, bx: number, by: number): boolean {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 8);
  for (let i = 1; i < steps; i++) {
    if (mazeSolidAt(m, ax + ((bx - ax) * i) / steps, ay + ((by - ay) * i) / steps)) return false;
  }
  return true;
}

/**
 * Who a lock-on may pick, nearest first: other players, alive and here,
 * within range, and in sight unless `throughWalls` (Ghost missiles).
 */
export function lockOrder(
  m: MazeMap, f: MazeFrame, mySeat: number, me: { x: number; y: number }, throughWalls: boolean,
): number[] {
  return f.p
    .map((p, seat) => ({ seat, d: Math.hypot(p[0] - me.x, p[1] - me.y), p }))
    .filter(({ seat, d, p }) => seat !== mySeat && (p[4] & PF.ALIVE) !== 0 && !(p[4] & PF.AWAY) && d <= LOCK_RANGE
      && (throughWalls || inSight(m, me.x, me.y, p[0], p[1])))
    .sort((a, b) => a.d - b.d)
    .map((o) => o.seat);
}

/** The next lock after `current`: the nearest if there is none, round again at the end. */
export function nextLock(order: number[], current: number | null): number | null {
  if (!order.length) return null;
  const at = current === null ? -1 : order.indexOf(current);
  return order[(at + 1) % order.length]!;
}
