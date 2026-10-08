import { useEffect, useState } from 'react';

/**
 * The part of the screen the on-screen keyboard leaves visible. Ported from
 * the toys repo's mobile editor, which solved the same problem.
 *
 * iOS Safari doesn't shrink the layout viewport when the keyboard opens, so
 * anything pinned to the bottom ends up under the keys; the visual viewport
 * is what moves, on iOS and Android alike (index.html pins both to that with
 * interactive-widget=resizes-visual).
 */
export interface ViewportBox {
  /** Height not covered by the keyboard, in CSS px. */
  height: number;
  /** How far the visual viewport has scrolled down inside the layout viewport. */
  offsetTop: number;
  /** Height the keyboard takes, or 0 while it's closed. */
  keyboardInset: number;
}

/** Below this an inset isn't a keyboard: Safari's collapsing address bar
 *  shrinks the viewport too, and no phone keyboard is this short. */
const MIN_KEYBOARD_PX = 120;

/** The last real keyboard height seen, kept past this mount: it's a fact
 *  about the device, and a sheet standing in for the keyboard wants it even
 *  while the keys are down. */
let lastKeyboard = 0;

/** How tall the keyboard was the last time it was up, or 0 if never seen. */
export function lastKeyboardHeight(): number {
  return lastKeyboard;
}

function read(): ViewportBox {
  const vv = window.visualViewport;
  if (!vv) return { height: window.innerHeight, offsetTop: 0, keyboardInset: 0 };
  // Rounded: the two are reported on different pixel grids and disagree by a
  // fraction with no keyboard up.
  const keyboardInset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  if (keyboardInset >= MIN_KEYBOARD_PX) lastKeyboard = keyboardInset;
  return { height: vv.height, offsetTop: vv.offsetTop, keyboardInset: keyboardInset >= MIN_KEYBOARD_PX ? keyboardInset : 0 };
}

const same = (a: ViewportBox, b: ViewportBox) =>
  a.height === b.height && a.offsetTop === b.offsetTop && a.keyboardInset === b.keyboardInset;

export function useVisualViewport(): ViewportBox {
  const [box, setBox] = useState<ViewportBox>(read);

  useEffect(() => {
    const vv = window.visualViewport;
    let frame = 0;
    // One read per frame: iOS fires resize and scroll together all through
    // the keyboard's animation.
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = read();
        setBox((prev) => (same(prev, next) ? prev : next));
      });
    };
    update();
    // Scroll as well: iOS slides the visual viewport up to reveal a focused
    // field, which moves the box without resizing it.
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return box;
}
