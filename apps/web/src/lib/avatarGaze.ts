/**
 * Trying LoginCritter's idea on the web: every avatar on the page looks
 * where you are. Its face shifts toward the pointer, the eyes a little
 * further, like a head turning. While you type in a field, it follows the
 * end of your text across the field instead, as LoginCritter's critter
 * turns its head along the email you type; and a complete room code makes
 * the avatars in that form hop for joy, as the critter does at an "@".
 *
 * One listener for the page; each avatar registers its element, and gets
 * --lx/--ly (-1 to 1, where it looks) and data-mood set on it.
 */
const watching = new Set<HTMLElement>();
let pointer: { x: number; y: number } | null = null;
let frame = 0;

/** How far away the target is before an avatar looks fully that way, px. */
const FULL_AT = 320;
/** A room code's length, at which its form's avatars are glad. */
const CODE_LENGTH = 6;

const measure = document.createElement('canvas').getContext('2d');

/** Where the end of the text in a focused field sits, on screen. */
function caretOf(input: HTMLInputElement): { x: number; y: number } {
  const box = input.getBoundingClientRect();
  const css = getComputedStyle(input);
  let width = 0;
  if (measure) {
    measure.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    const text = input.value.slice(0, input.selectionEnd ?? input.value.length);
    width = measure.measureText(text).width + text.length * (parseFloat(css.letterSpacing) || 0);
  }
  const left = box.left + (parseFloat(css.paddingLeft) || 0);
  const right = box.right - (parseFloat(css.paddingRight) || 0);
  // A centred field starts its text in the middle.
  const start = css.textAlign === 'center' ? (left + right) / 2 - width / 2 : left;
  return { x: Math.min(start + width, right), y: box.top + box.height / 2 };
}

function update() {
  frame = 0;
  const focused = document.activeElement;
  const typing = focused instanceof HTMLInputElement && focused.classList.contains('field__input') ? focused : null;
  const target = typing ? caretOf(typing) : pointer;
  const glad =
    typing?.classList.contains('field__input--code') && typing.value.length === CODE_LENGTH ? typing.form : null;

  for (const el of watching) {
    const box = el.getBoundingClientRect();
    if (!target) {
      el.style.setProperty('--lx', '0');
      el.style.setProperty('--ly', '0');
    } else {
      const dx = target.x - (box.left + box.width / 2);
      const dy = target.y - (box.top + box.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, d / FULL_AT);
      el.style.setProperty('--lx', ((dx / d) * reach).toFixed(3));
      el.style.setProperty('--ly', ((dy / d) * reach).toFixed(3));
    }
    if (glad && glad.contains(el)) el.dataset.mood = 'glad';
    else delete el.dataset.mood;
  }
}

function soon() {
  if (!frame) frame = requestAnimationFrame(update);
}

document.addEventListener('pointermove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  soon();
});
document.addEventListener('pointerout', (e) => {
  if (e.relatedTarget) return;
  pointer = null;
  soon();
});
document.addEventListener('input', soon);
document.addEventListener('selectionchange', soon);
document.addEventListener('focusin', soon);
document.addEventListener('focusout', soon);
window.addEventListener('scroll', soon, { capture: true, passive: true });

/** Starts an avatar watching; returns how to stop. */
export function watch(el: HTMLElement): () => void {
  watching.add(el);
  soon();
  return () => {
    watching.delete(el);
  };
}
