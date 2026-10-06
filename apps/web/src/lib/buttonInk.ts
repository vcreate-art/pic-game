/**
 * Tells every button where the pointer crossed its edge, so its ink can
 * spread from the point it came in and drain toward the point it left, the
 * same as the game covers. One listener for the whole page rather than a
 * handler on each button; the effect itself is CSS (`--ex`/`--ey`).
 */
const INKED = '.btn, .room__ctl, .paused__resume';

function mark(e: PointerEvent): void {
  if (e.pointerType !== 'mouse') return;
  const el = (e.target as Element | null)?.closest?.(INKED) as HTMLElement | null;
  if (!el) return;
  // Moving between a button's own children isn't crossing its edge.
  const other = e.relatedTarget as Node | null;
  if (other && el.contains(other)) return;
  const box = el.getBoundingClientRect();
  el.style.setProperty('--ex', `${((e.clientX - box.left) / box.width) * 100}%`);
  el.style.setProperty('--ey', `${((e.clientY - box.top) / box.height) * 100}%`);
}

document.addEventListener('pointerover', mark);
document.addEventListener('pointerout', mark);
