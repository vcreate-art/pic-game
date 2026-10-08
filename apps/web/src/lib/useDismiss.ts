import { useEffect, type RefObject } from 'react';

/** Closes a popover on a press outside `box`, or on Escape, while it is open.
 *  On pointerdown, caught on its way down: the canvas takes its presses for
 *  drawing, and a mousedown never follows one there. */
export function useDismiss(box: RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [box, open, close]);
}
