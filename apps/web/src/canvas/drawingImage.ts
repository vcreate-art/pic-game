import type { Drawing } from '@pic-game/shared';
import { CanvasEngine } from './engine.js';

/** Finished drawings never change, so each is painted once. */
const cache = new Map<string, string>();
/** A private engine, so painting the gallery never touches the live board. */
let painter: CanvasEngine | null = null;

/** A drawing as a PNG data URL, replayed from its strokes at full size. */
export function drawingImage(d: Drawing): string {
  const hit = cache.get(d.id);
  if (hit) return hit;
  painter ??= new CanvasEngine();
  painter.replay(d.ops);
  const url = painter.toDataURL();
  cache.set(d.id, url);
  return url;
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'drawing';

export function downloadDrawing(d: Drawing): void {
  const a = document.createElement('a');
  a.href = drawingImage(d);
  a.download = `${slug(d.word)}-by-${slug(d.drawerName)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
