/** One second of game time: the step god mode moves a room's clock by. */
export const TICK_MS = 1000;

/** How a room's time relates to the server's, for clients to follow: room
 *  time was `at` when the server's clock read `wall`, and moves `rate` times
 *  as fast since (0 while frozen). */
export interface ClockMapping {
  at: number;
  wall: number;
  rate: number;
}

export type TimerHandle = number;

interface Timer {
  due: number;
  fn: () => void;
  label: string;
  /** Set for a repeating timer: how far apart its runs are. */
  every: number | null;
}

/**
 * A room's own time. Its timers run against it rather than the server's
 * clock, so god mode can freeze a room, speed it up, or step it on a tick at
 * a time, and the game moves through its states as it would on its own.
 *
 * Left alone it runs at real speed and reads the same as `Date.now()`, so a
 * room nobody touches behaves exactly as it would without it. One real
 * timeout is armed, for the earliest timer due.
 */
export class RoomClock {
  private baseAt = Date.now();
  private baseWall = this.baseAt;
  private rate = 1;
  /** Once anything changes the clock, clients are sent the mapping. */
  private touched = false;
  private readonly timers = new Map<TimerHandle, Timer>();
  private seq = 0;
  private real: ReturnType<typeof setTimeout> | null = null;
  private firing = false;

  now(): number {
    return this.baseAt + (Date.now() - this.baseWall) * this.rate;
  }

  get speed(): number {
    return this.rate;
  }

  get frozen(): boolean {
    return this.rate === 0;
  }

  /** Runs `fn` once, `ms` of room time from now. */
  after(ms: number, fn: () => void, label = 'timer'): TimerHandle {
    return this.add({ due: this.now() + Math.max(0, ms), fn, label, every: null });
  }

  /** Runs `fn` every `ms` of room time, the first `ms` from now. */
  every(ms: number, fn: () => void, label = 'repeat'): TimerHandle {
    const every = Math.max(1, ms);
    return this.add({ due: this.now() + every, fn, label, every });
  }

  cancel(handle: TimerHandle | null | undefined): void {
    if (handle == null || !this.timers.delete(handle)) return;
    this.arm();
  }

  /** Sets how fast the room runs against real time; 0 freezes it. */
  setSpeed(rate: number): void {
    this.rebase();
    this.rate = Math.max(0, rate);
    this.touched = true;
    this.arm();
  }

  /** Moves room time on by `ms` at once, running every timer that falls due
   *  on the way, in order and each at its own moment. */
  advance(ms: number): void {
    const target = this.now() + Math.max(0, ms);
    this.touched = true;
    this.fireUntil(target);
    this.jumpTo(target);
    this.arm();
  }

  /** When the next timer is due, in room time, or null with none. */
  nextDue(): number | null {
    let next: number | null = null;
    for (const t of this.timers.values()) if (next === null || t.due < next) next = t.due;
    return next;
  }

  /** The timers waiting, soonest first, for god mode to show. */
  pending(): { label: string; inMs: number; every: number | null }[] {
    const now = this.now();
    return [...this.timers.values()]
      .sort((a, b) => a.due - b.due)
      .map((t) => ({ label: t.label, inMs: Math.max(0, Math.round(t.due - now)), every: t.every }));
  }

  /** What clients need to follow this room's time, or null while it still
   *  reads the same as the server's clock. */
  mapping(): ClockMapping | null {
    if (!this.touched) return null;
    return { at: this.baseAt, wall: this.baseWall, rate: this.rate };
  }

  dispose(): void {
    this.timers.clear();
    if (this.real) clearTimeout(this.real);
    this.real = null;
  }

  private add(t: Timer): TimerHandle {
    const handle = ++this.seq;
    this.timers.set(handle, t);
    this.arm();
    return handle;
  }

  /** Room time is `at` from this moment of real time on. */
  private jumpTo(at: number): void {
    this.baseAt = at;
    this.baseWall = Date.now();
  }

  private rebase(): void {
    this.jumpTo(this.now());
  }

  /** Runs the timers due by `target`, earliest first. A timer may add or
   *  cancel others, so the next one is looked up afresh each time. */
  private fireUntil(target: number): void {
    if (this.firing) return;
    this.firing = true;
    try {
      for (;;) {
        let handle: TimerHandle | null = null;
        let t: Timer | null = null;
        for (const [h, x] of this.timers) {
          if (x.due <= target && (!t || x.due < t.due)) {
            handle = h;
            t = x;
          }
        }
        if (handle === null || !t) break;
        // Room time stands at the timer's own moment while it runs.
        if (t.due > this.now()) this.jumpTo(t.due);
        if (t.every) t.due += t.every;
        else this.timers.delete(handle);
        t.fn();
      }
    } finally {
      this.firing = false;
    }
  }

  private arm(): void {
    if (this.firing) return;
    if (this.real) clearTimeout(this.real);
    this.real = null;
    const next = this.nextDue();
    if (next === null || this.rate === 0) return;
    const wait = Math.max(0, (next - this.now()) / this.rate);
    this.real = setTimeout(() => {
      this.real = null;
      this.fireUntil(this.now());
      this.arm();
    }, wait);
  }
}
