import {
  LOGICAL_W, LOGICAL_H, dequantize,
  type CanvasOp, type StrokeOp,
} from '@pic-game/shared';

const BG = '#ffffff';
/** Flood-fill match tolerance. Anti-aliased stroke edges differ slightly between
 *  browsers; a loose threshold keeps fills from leaking through those seams. */
const FILL_TOLERANCE = 32;

/**
 * All painting happens on a fixed 800x600 backing canvas, which is then blitted
 * scaled into whatever space the layout gives us. Two things fall out of that:
 * resizing is a re-blit rather than a re-render, and flood fill operates on an
 * identical pixel grid on every client, so a fill spreads the same way on a phone
 * as on a desktop.
 */
export class CanvasEngine {
  private readonly off: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D;
  private view: HTMLCanvasElement | null = null;
  private vctx: CanvasRenderingContext2D | null = null;

  private ops: CanvasOp[] = [];
  /** Strokes still receiving points, with how many points are already painted. */
  private live = new Map<string, { op: StrokeOp; drawn: number }>();
  private raf = 0;

  constructor() {
    this.off = document.createElement('canvas');
    this.off.width = LOGICAL_W;
    this.off.height = LOGICAL_H;
    const ctx = this.off.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.octx = ctx;
    this.octx.lineCap = 'round';
    this.octx.lineJoin = 'round';
    this.paintBackground();
  }

  attach(view: HTMLCanvasElement): void {
    this.view = view;
    this.vctx = view.getContext('2d');
    this.resize();
  }

  detach(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.view = null;
    this.vctx = null;
  }

  /** Matches the backing store to the element's CSS box at device resolution,
   *  so lines stay crisp on retina displays. */
  resize(): void {
    const view = this.view;
    if (!view) return;
    const rect = view.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (view.width !== w || view.height !== h) {
      view.width = w;
      view.height = h;
    }
    this.blit();
  }

  private paintBackground(): void {
    this.octx.save();
    this.octx.globalCompositeOperation = 'source-over';
    this.octx.fillStyle = BG;
    this.octx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    this.octx.restore();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.blit();
    });
  }

  private blit(): void {
    const { vctx, view } = this;
    if (!vctx || !view) return;
    vctx.imageSmoothingEnabled = true;
    vctx.clearRect(0, 0, view.width, view.height);
    vctx.drawImage(this.off, 0, 0, view.width, view.height);
  }

  // ---------------------------------------------------------------- history

  /** Full repaint from an op list — used on join, on undo, and on reconnect. */
  replay(ops: CanvasOp[]): void {
    this.ops = ops.map((o) => (o.kind === 'stroke' ? { ...o, pts: [...o.pts] } : { ...o }));
    this.live.clear();
    this.paintBackground();
    for (const op of this.ops) {
      if (op.kind === 'stroke') this.paintStroke(op, 0);
      else this.paintFill(op);
    }
    this.schedule();
  }

  clear(): void {
    this.ops = [];
    this.live.clear();
    this.paintBackground();
    this.schedule();
  }

  snapshot(): CanvasOp[] {
    return this.ops;
  }

  // ---------------------------------------------------------------- strokes

  startStroke(op: StrokeOp): void {
    const copy: StrokeOp = { ...op, pts: [...op.pts] };
    this.ops.push(copy);
    this.live.set(copy.id, { op: copy, drawn: 0 });
    this.paintStroke(copy, 0);
    this.live.get(copy.id)!.drawn = copy.pts.length;
    this.schedule();
  }

  appendStroke(id: string, pts: number[]): void {
    const entry = this.live.get(id);
    if (!entry) return;
    entry.op.pts.push(...pts);
    // Repaint starting one point back so the new run joins the old one seamlessly.
    const from = Math.max(0, entry.drawn - 2);
    this.paintStroke(entry.op, from);
    entry.drawn = entry.op.pts.length;
    this.schedule();
  }

  endStroke(id: string): void {
    this.live.delete(id);
  }

  /** Paints the stroke from the given flat-array index onward. */
  private paintStroke(op: StrokeOp, fromIndex: number): void {
    const pts = op.pts;
    if (pts.length < 2) return;

    const ctx = this.octx;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    // The eraser paints the background colour rather than punching a hole, which
    // keeps the surface opaque so flood fill has a defined colour to test against.
    ctx.strokeStyle = op.tool === 'eraser' ? BG : op.color;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = op.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const [x0, y0] = dequantize(pts[fromIndex]!, pts[fromIndex + 1]!);

    // A tap with no travel still leaves a dot.
    if (pts.length === 2) {
      ctx.beginPath();
      ctx.arc(x0, y0, op.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let i = fromIndex + 2; i + 1 < pts.length; i += 2) {
      const [x, y] = dequantize(pts[i]!, pts[i + 1]!);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- fill

  applyFill(op: CanvasOp): void {
    if (op.kind !== 'fill') return;
    this.ops.push({ ...op });
    this.paintFill(op);
    this.schedule();
  }

  private paintFill(op: Extract<CanvasOp, { kind: 'fill' }>): void {
    const [fx, fy] = dequantize(op.x, op.y);
    floodFill(this.octx, Math.round(fx), Math.round(fy), op.color);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Scanline flood fill. Runs identically on every client from the same seed point,
 * because they all share the same op history and the same fixed pixel grid —
 * which is why only the seed travels over the wire, not a region of pixels.
 */
function floodFill(ctx: CanvasRenderingContext2D, sx: number, sy: number, color: string): void {
  const w = LOGICAL_W;
  const h = LOGICAL_H;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const at = (x: number, y: number) => (y * w + x) * 4;

  const start = at(sx, sy);
  const tr = d[start]!, tg = d[start + 1]!, tb = d[start + 2]!;
  const [nr, ng, nb] = hexToRgb(color);

  // Filling with the colour already there would spin over the whole region for nothing.
  if (Math.abs(tr - nr) < 2 && Math.abs(tg - ng) < 2 && Math.abs(tb - nb) < 2) return;

  const matches = (i: number): boolean =>
    Math.abs(d[i]! - tr) <= FILL_TOLERANCE &&
    Math.abs(d[i + 1]! - tg) <= FILL_TOLERANCE &&
    Math.abs(d[i + 2]! - tb) <= FILL_TOLERANCE;

  const stack: number[] = [sx, sy];
  const seen = new Uint8Array(w * h);

  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;

    let left = x;
    while (left > 0 && matches(at(left - 1, y))) left--;
    let right = x;
    while (right < w - 1 && matches(at(right + 1, y))) right++;

    for (let i = left; i <= right; i++) {
      const p = at(i, y);
      d[p] = nr;
      d[p + 1] = ng;
      d[p + 2] = nb;
      d[p + 3] = 255;
      seen[y * w + i] = 1;

      if (y > 0 && !seen[(y - 1) * w + i] && matches(at(i, y - 1))) stack.push(i, y - 1);
      if (y < h - 1 && !seen[(y + 1) * w + i] && matches(at(i, y + 1))) stack.push(i, y + 1);
    }
  }

  ctx.putImageData(img, 0, 0);
}
