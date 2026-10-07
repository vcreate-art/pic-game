/**
 * Tells every button where the pointer crossed its edge, so its ink can
 * spread from the point it came in and drain toward the point it left, the
 * same as the game covers. One listener for the whole page rather than a
 * handler on each button; the effect itself is CSS (`--ex`/`--ey`,
 * `is-inked`).
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
  const place = () => {
    el.style.setProperty('--ex', `${((e.clientX - box.left) / box.width) * 100}%`);
    el.style.setProperty('--ey', `${((e.clientY - box.top) / box.height) * 100}%`);
  };
  if (e.type === 'pointerout') {
    // Shrinking while it moves is what drains it toward where it left.
    place();
    el.classList.remove('is-inked');
    return;
  }
  // The circle's centre and size animate together, so moving the centre as
  // it grows would slide the ink in from wherever it last left. Move it while
  // it's still empty, with no transition, then let it grow from there.
  el.classList.add('ink-place');
  place();
  void getComputedStyle(el, '::before').clipPath;
  el.classList.remove('ink-place');
  el.classList.add('is-inked');
}

document.addEventListener('pointerover', mark);
document.addEventListener('pointerout', mark);
