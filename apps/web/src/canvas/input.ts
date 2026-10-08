import { LOGICAL_W, LOGICAL_H, quantize, recognizeShape, type PenTool } from '@pic-game/shared';
import { uid } from '../lib/uid.js';

/** One network message per pointermove would be ~120/sec on a good mouse.
 *  Batching to 50ms frames keeps it near 20/sec with no visible difference. */
const FLUSH_MS = 50;
/** Held this long without moving, mid-stroke, and the stroke is read for a
 *  shape to snap to (a line, a circle, an ellipse), as Apple Notes does. */
const HOLD_MS = 450;
/** How far, in screen px, a held finger may drift and still be holding: a
 *  fingertip at rest on glass wanders a few px, a mouse not at all. */
const HOLD_SLOP_PX = 8;

export interface ToolState {
  tool: PenTool | 'fill';
  color: string;
  size: number;
}

export interface DrawSink {
  start(op: { id: string; tool: PenTool; color: string; size: number; pts: number[] }): void;
  append(id: string, pts: number[]): void;
  end(id: string): void;
  /** The stroke's points swapped for a clean shape's. */
  replace(id: string, pts: number[]): void;
  fill(x: number, y: number, color: string): void;
}

export class DrawInput {
  private canvas: HTMLCanvasElement | null = null;
  private enabled = false;
  private strokeId: string | null = null;
  private pending: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastQ: [number, number] | null = null;
  /** The whole stroke so far, for reading its shape. */
  private strokePts: number[] = [];
  /** Where the pointer came to rest, on screen, and the timer waiting out
   *  the hold. */
  private restAt: [number, number] | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** Snapped: held still since, the stroke is the shape. Drawn on from
   *  there, it goes back to as drawn, and carries on. */
  private snapped = false;

  constructor(
    private readonly sink: DrawSink,
    private readonly getTool: () => ToolState,
  ) {}

  attach(canvas: HTMLCanvasElement): void {
    this.detach();
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', this.onDown);
    // A finger held still for a snap is a long press to the browser; its
    // menu would cancel the stroke just as the snap is due.
    canvas.addEventListener('contextmenu', this.noMenu);
    canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  detach(): void {
    const c = this.canvas;
    if (c) {
      c.removeEventListener('pointerdown', this.onDown);
      c.removeEventListener('contextmenu', this.noMenu);
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

  private noMenu = (e: Event): void => e.preventDefault();

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
    this.strokePts = [qx, qy];
    this.snapped = false;
    this.sink.start({ id: this.strokeId, tool: t.tool, color: t.color, size: t.size, pts: [qx, qy] });
    this.startTimer();
    this.rest([e.clientX, e.clientY]);
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.enabled || !this.strokeId || !this.canvas) return;
    e.preventDefault();
    if (this.snapped) {
      // Still holding: the shape stays. Drawing on: back to as drawn, which
      // goes on from here (and may snap again at the next hold).
      if (!this.restAt || Math.hypot(e.clientX - this.restAt[0], e.clientY - this.restAt[1]) <= HOLD_SLOP_PX) return;
      this.snapped = false;
      this.sink.replace(this.strokeId, [...this.strokePts]);
    }

    // Browsers throttle pointermove to the frame rate but retain the samples in
    // between; taking the coalesced list keeps fast strokes smooth instead of angular.
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    for (const ev of events.length > 0 ? events : [e]) {
      const [qx, qy] = this.toLogical(ev);
      // Skip points the wire format could not distinguish anyway.
      if (this.lastQ && this.lastQ[0] === qx && this.lastQ[1] === qy) continue;
      this.lastQ = [qx, qy];
      this.pending.push(qx, qy);
      this.strokePts.push(qx, qy);
      // Moved off the spot it rested on: not holding, so start the wait again.
      if (this.restAt && Math.hypot(ev.clientX - this.restAt[0], ev.clientY - this.restAt[1]) > HOLD_SLOP_PX) {
        this.rest([ev.clientX, ev.clientY]);
      }
    }
  };

  /** The pointer settles here; if it stays for HOLD_MS, read the shape. */
  private rest(at: [number, number]): void {
    this.restAt = at;
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(this.held, HOLD_MS);
  }

  private held = (): void => {
    this.holdTimer = null;
    if (!this.strokeId || this.snapped) return;
    const shape = recognizeShape(this.strokePts);
    if (!shape) return;
    this.flush();
    this.snapped = true;
    this.sink.replace(this.strokeId, shape.pts);
    // A small buzz where phones can, so a snap is felt as well as seen.
    navigator.vibrate?.(12);
  };

  private stopHold(): void {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.restAt = null;
    this.strokePts = [];
    this.snapped = false;
  }

  private onUp = (): void => {
    if (!this.strokeId) return;
    this.flush();
    this.sink.end(this.strokeId);
    this.strokeId = null;
    this.lastQ = null;
    this.stopTimer();
    this.stopHold();
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
    this.stopHold();
  }

  private flush(): void {
    if (!this.strokeId || this.pending.length === 0) return;
    // Snapped, the stroke is the shape now: nothing more of the hand's.
    if (this.snapped) {
      this.pending = [];
      return;
    }
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
