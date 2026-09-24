import { useEffect, useState, type RefObject } from 'react';

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

/**
 * Puts a game's stage (and its overlays, which live in the same box) into
 * full screen, and takes it out again. F does the same from the keyboard,
 * except while typing in chat.
 */
export function FullscreenButton({ target }: { target: RefObject<HTMLElement | null> }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(document.fullscreenElement === target.current && !!target.current);
    const toggle = (e: KeyboardEvent) => {
      if (e.code !== 'KeyF' || e.repeat || e.metaKey || e.ctrlKey || typing(e.target)) return;
      e.preventDefault();
      flip();
    };
    document.addEventListener('fullscreenchange', sync);
    window.addEventListener('keydown', toggle);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      window.removeEventListener('keydown', toggle);
    };
  });

  const flip = () => {
    const el = target.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  };

  if (typeof document !== 'undefined' && !document.fullscreenEnabled) return null;

  return (
    <button type="button" className="tool fs-btn" onClick={flip} aria-pressed={on}>
      {on ? 'Exit full screen' : 'Full screen'} <kbd>F</kbd>
    </button>
  );
}
