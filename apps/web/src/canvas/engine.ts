import {
  LOGICAL_W, LOGICAL_H, dequantize,
  type CanvasOp, type StrokeOp,
} from '@pic-game/shared';

const BG = '#ffffff';
/** Flood-fill match tolerance. Anti-aliased stroke edges differ slightly between
 *  browsers; a loose threshold keeps fills from leaking through those seams. */
const FILL_TOLERANCE = 32;
/** How far from an edge pixel to look for the line colour it is blended from.
 *  Two covers a soft edge two pixels wide, which heavy strokes can leave. */
const LINE_REACH = 2;
/** How long a snapped stroke takes to ease from as drawn into its clean
 *  shape, and how many points both are resampled to for it. */
const SNAP_MS = 200;
const SNAP_POINTS = 64;

/** A stroke's flat points, evenly spaced along it, `n` of them. */
function resampleFlat(pts: readonly number[], n: number): number[] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    xs.push(pts[i]!);
    ys.push(pts[i + 1]!);
  }
  if (xs.length < 2) return Array.from({ length: n * 2 }, (_, i) => (i % 2 ? ys[0] ?? 0 : xs[0] ?? 0));
  const at = [0];
  for (let i = 1; i < xs.length; i++) at.push(at[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!));
  const total = at[at.length - 1]! || 1;
  const out: number[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const want = (k / (n - 1)) * total;
    while (j < at.length - 1 && at[j]! < want) j++;
    const span = at[j]! - at[j - 1]! || 1;
    const t = Math.min(1, Math.max(0, (want - at[j - 1]!) / span));
    out.push(xs[j - 1]! + (xs[j]! - xs[j - 1]!) * t, ys[j - 1]! + (ys[j]! - ys[j - 1]!) * t);
  }
  return out;
}

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
  /** A snap easing in: its frame, and how to finish it at once. */
  private morph: { raf: number; finish: () => void } | null = null;

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
    this.endMorph();
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
    this.endMorph();
    this.ops = [];
    this.live.clear();
    this.paintBackground();
    this.schedule();
  }

  snapshot(): CanvasOp[] {
    return this.ops;
  }

  /** The picture as a PNG, at the full logical size whatever the screen. */
  toDataURL(): string {
    return this.off.toDataURL('image/png');
  }

  // ---------------------------------------------------------------- strokes

  startStroke(op: StrokeOp): void {
    this.endMorph();
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

  /**
   * A stroke snapped to a clean shape: its points swapped for the shape's,
   * the drawn line easing into it over SNAP_MS. The picture without it is
   * kept for the frames to paint over; that needs it to be the latest op,
   * which it nearly always is (it's being held). If not, it just changes.
   */
  replaceStroke(id: string, pts: number[]): void {
    const i = this.ops.findIndex((o) => o.id === id);
    const op = this.ops[i];
    if (!op || op.kind !== 'stroke') return;
    this.endMorph();
    const from = op.pts;
    op.pts = [...pts];
    const live = this.live.get(id);
    if (live) live.drawn = op.pts.length;

    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still || i !== this.ops.length - 1) {
      this.repaint();
      return;
    }
    this.ops.pop();
    this.repaint();
    const under = this.octx.getImageData(0, 0, LOGICAL_W, LOGICAL_H);
    this.ops.push(op);
    const a = resampleFlat(from, SNAP_POINTS);
    const b = resampleFlat(op.pts, SNAP_POINTS);
    const start = performance.now();
    const paint = (k: number) => {
      this.octx.putImageData(under, 0, 0);
      this.paintStroke(k >= 1 ? op : { ...op, pts: a.map((v, j) => Math.round(v + (b[j]! - v) * k)) }, 0);
      this.blit();
    };
    const finish = () => {
      cancelAnimationFrame(this.morph?.raf ?? 0);
      this.morph = null;
      paint(1);
    };
    const frame = () => {
      const t = Math.min(1, (performance.now() - start) / SNAP_MS);
      if (t >= 1) return finish();
      paint(1 - (1 - t) ** 3);
      this.morph!.raf = requestAnimationFrame(frame);
    };
    this.morph = { raf: requestAnimationFrame(frame), finish };
  }

  /** A snap still easing in finishes at once, before anything else changes. */
  private endMorph(): void {
    this.morph?.finish();
  }

  /** Every op painted afresh, without touching what's live. */
  private repaint(): void {
    this.paintBackground();
    for (const op of this.ops) {
      if (op.kind === 'stroke') this.paintStroke(op, 0);
      else this.paintFill(op);
    }
    this.schedule();
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
    this.endMorph();
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
  if (sx < 0 || sy < 0 || sx >= LOGICAL_W || sy >= LOGICAL_H) return;
  const img = ctx.getImageData(0, 0, LOGICAL_W, LOGICAL_H);
  if (fillPixels(img.data, LOGICAL_W, LOGICAL_H, sx, sy, hexToRgb(color))) ctx.putImageData(img, 0, 0);
}

/**
 * The fill itself, on raw RGBA pixels. Returns false when there was nothing to do.
 *
 * Two passes. The first floods every pixel within FILL_TOLERANCE of the seed's
 * colour. That stops short of a stroke's anti-aliased edge, whose pixels are
 * blends of the line and the old background, and left alone they show as a pale
 * halo between line and fill. So the second pass takes the one ring of pixels
 * bordering the flooded area and re-blends each: it estimates how much of the
 * pixel is line, from the most line-like pixel around it, and swaps the old
 * background for the new colour in the same proportion. The line keeps its
 * smooth edge and the fill runs right up to it. One ring only, so it cannot
 * creep through a gap.
 */
export function fillPixels(
  d: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, rgb: [number, number, number],
): boolean {
  const at = (x: number, y: number) => (y * w + x) * 4;
  const start = at(sx, sy);
  const tr = d[start]!, tg = d[start + 1]!, tb = d[start + 2]!;
  const [nr, ng, nb] = rgb;

  // Filling with the colour already there would spin over the whole region for nothing.
  if (Math.abs(tr - nr) < 2 && Math.abs(tg - ng) < 2 && Math.abs(tb - nb) < 2) return false;

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

  // Worked out against the pixels as they are before any of the edge changes,
  // then applied together, so no edge pixel reads a neighbour already re-blended.
  const edits: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !bordersFlood(seen, w, h, x, y)) continue;
      // The pixel itself is a candidate for the line colour, then the unflooded
      // pixels around it: whichever is furthest from the old background.
      let lr = 0, lg = 0, lb = 0, far = -1;
      for (let dy = -LINE_REACH; dy <= LINE_REACH; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -LINE_REACH; dx <= LINE_REACH; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || seen[yy * w + xx]) continue;
          const q = at(xx, yy);
          const dist = (d[q]! - tr) ** 2 + (d[q + 1]! - tg) ** 2 + (d[q + 2]! - tb) ** 2;
          if (dist > far) {
            far = dist;
            lr = d[q]!;
            lg = d[q + 1]!;
            lb = d[q + 2]!;
          }
        }
      }
      if (far <= 0) continue;
      // How much of this pixel is line: its offset from the old background,
      // projected onto the line's.
      const p = at(x, y);
      const cover = ((d[p]! - tr) * (lr - tr) + (d[p + 1]! - tg) * (lg - tg) + (d[p + 2]! - tb) * (lb - tb)) / far;
      const a = Math.min(1, Math.max(0, cover));
      if (a >= 1) continue;
      edits.push(
        p,
        Math.round(a * lr + (1 - a) * nr),
        Math.round(a * lg + (1 - a) * ng),
        Math.round(a * lb + (1 - a) * nb),
      );
    }
  }
  for (let i = 0; i < edits.length; i += 4) {
    const p = edits[i]!;
    d[p] = edits[i + 1]!;
    d[p + 1] = edits[i + 2]!;
    d[p + 2] = edits[i + 3]!;
    d[p + 3] = 255;
  }
  return true;
}

/** Whether any of the eight pixels around (x, y) was flooded. */
function bordersFlood(seen: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      if (xx >= 0 && xx < w && seen[yy * w + xx]) return true;
    }
  }
  return false;
}
