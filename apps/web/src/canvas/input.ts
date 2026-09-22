import { LOGICAL_W, LOGICAL_H, quantize, type PenTool } from '@pic-game/shared';
import { uid } from '../lib/uid.js';

/** One network message per pointermove would be ~120/sec on a good mouse.
 *  Batching to 50ms frames keeps it near 20/sec with no visible difference. */
const FLUSH_MS = 50;

export interface ToolState {
  tool: PenTool | 'fill';
  color: string;
  size: number;
}

export interface DrawSink {
  start(op: { id: string; tool: PenTool; color: string; size: number; pts: number[] }): void;
  append(id: string, pts: number[]): void;
  end(id: string): void;
  fill(x: number, y: number, color: string): void;
}

export class DrawInput {
  private canvas: HTMLCanvasElement | null = null;
  private enabled = false;
  private strokeId: string | null = null;
  private pending: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastQ: [number, number] | null = null;

  constructor(
    private readonly sink: DrawSink,
    private readonly getTool: () => ToolState,
  ) {}

  attach(canvas: HTMLCanvasElement): void {
    this.detach();
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  detach(): void {
    const c = this.canvas;
    if (c) {
      c.removeEventListener('pointerdown', this.onDown);
      c.removeEventListener('pointermove', this.onMove);
    }
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.stopTimer();
    this.canvas = null;
  }

  /** Flipped by the turn state — only the current drawer's input is live. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.abort();
  }

  private toLogical(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.canvas!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * LOGICAL_W;
    const y = ((e.clientY - rect.top) / rect.height) * LOGICAL_H;
    return quantize(x, y);
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled || !this.canvas || e.button !== 0) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);

    const t = this.getTool();
    const [qx, qy] = this.toLogical(e);

    if (t.tool === 'fill') {
      this.sink.fill(qx, qy, t.color);
      return;
    }

    this.strokeId = uid();
    this.lastQ = [qx, qy];
    this.sink.start({ id: this.strokeId, tool: t.tool, color: t.color, size: t.size, pts: [qx, qy] });
    this.startTimer();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.enabled || !this.strokeId || !this.canvas) return;
    e.preventDefault();

    // Browsers throttle pointermove to the frame rate but retain the samples in
    // between; taking the coalesced list keeps fast strokes smooth instead of angular.
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    for (const ev of events.length > 0 ? events : [e]) {
      const [qx, qy] = this.toLogical(ev);
      // Skip points the wire format could not distinguish anyway.
      if (this.lastQ && this.lastQ[0] === qx && this.lastQ[1] === qy) continue;
      this.lastQ = [qx, qy];
      this.pending.push(qx, qy);
    }
  };

  private onUp = (): void => {
    if (!this.strokeId) return;
    this.flush();
    this.sink.end(this.strokeId);
    this.strokeId = null;
    this.lastQ = null;
    this.stopTimer();
  };

  private abort(): void {
    if (this.strokeId) {
      this.flush();
      this.sink.end(this.strokeId);
    }
    this.strokeId = null;
    this.lastQ = null;
    this.pending = [];
    this.stopTimer();
  }

  private flush(): void {
    if (!this.strokeId || this.pending.length === 0) return;
    const pts = this.pending;
    this.pending = [];
    this.sink.append(this.strokeId, pts);
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
