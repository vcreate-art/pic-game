/** Leaky token bucket. Refills continuously, so it never needs its own timer. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
  }

  tryTake(n = 1): boolean {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.last) / 1000) * this.refillPerSec,
    );
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
