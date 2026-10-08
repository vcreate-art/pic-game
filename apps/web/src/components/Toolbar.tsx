import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, PaintBucket, Pencil, Redo2, Trash2, Undo2 } from 'lucide-react';
import { BRUSH_SIZES, PALETTE } from '@pic-game/shared';
import { useDismiss } from '../lib/useDismiss.js';
import { getSocket } from '../net/socket.js';
import { useTools } from '../store/tools.js';

/** The brush sizes by name, smallest first, as BRUSH_SIZES runs. */
const SIZE_NAMES = ['Small', 'Medium', 'Large', 'Extra large'] as const;

/** Whether a key press belongs to something being typed into. */
function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/**
 * Keys for drawing at a keyboard, while the toolbar is up (the drawer's own
 * turn): P or B the pen, F fill, E the eraser, [ and ] the brush smaller and
 * bigger, 1 to 8 the palette's top row and Shift with them the bottom row,
 * Z (or Ctrl/Cmd+Z) undo, and Shift+Z (or Ctrl/Cmd+Shift+Z, or Ctrl+Y)
 * redo. Never while typing, and not with Alt or with Ctrl/Cmd other than
 * for undo and redo, so the browser's own shortcuts stay its own.
 */
function useDrawShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && e.code !== 'KeyZ' && e.code !== 'KeyY') return;
      if (typing(e) || e.altKey) return;
      const { setTool, setColor, setSize, size } = useTools.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'KeyZ' || (e.code === 'KeyY' && mod)) {
        getSocket().emit(e.code === 'KeyY' || e.shiftKey ? 'canvas:redo' : 'canvas:undo');
        e.preventDefault();
        return;
      }
      if (mod) return;
      const at = BRUSH_SIZES.indexOf(size as (typeof BRUSH_SIZES)[number]);
      const digit = /^Digit([1-8])$/.exec(e.code);
      if (digit) setColor(PALETTE[Number(digit[1]) - 1 + (e.shiftKey ? 8 : 0)]!);
      else if (e.code === 'KeyP' || e.code === 'KeyB') setTool('pen');
      else if (e.code === 'KeyF') setTool('fill');
      else if (e.code === 'KeyE') setTool('eraser');
      else if (e.code === 'BracketLeft') setSize(BRUSH_SIZES[Math.max(0, at - 1)]!);
      else if (e.code === 'BracketRight') setSize(BRUSH_SIZES[Math.min(BRUSH_SIZES.length - 1, at + 1)]!);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function Toolbar() {
  const { tool, color, size, setTool, setColor, setSize } = useTools();
  const socket = getSocket();
  useDrawShortcuts();
  const ink = tool === 'eraser' ? '#94a3b8' : color;
  const [sizesOpen, setSizesOpen] = useState(false);
  const pick = useRef<HTMLDivElement>(null);
  const closeSizes = useCallback(() => setSizesOpen(false), []);
  useDismiss(pick, sizesOpen, closeSizes);
  const dot = (s: number) => s / 1.6;

  return (
    <div className="toolbar">
      <div className="toolbar__palette">
        {PALETTE.map((c, i) => (
          <button
            key={c}
            type="button"
            className={`swatch ${color === c && tool !== 'eraser' ? 'is-active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
            data-tip={`${i < 8 ? '' : 'Shift+'}${(i % 8) + 1}`}
          />
        ))}
      </div>

      {/* One brush button showing the size in use; a click opens the sizes
          above it, and picking one, a click elsewhere or Escape closes them. */}
      <div className={`brushpick ${sizesOpen ? 'is-open' : ''}`} ref={pick}>
        <button
          type="button"
          className="brush brushpick__now"
          aria-label={`Brush size ${size}`}
          aria-expanded={sizesOpen}
          data-tip="Brush size · press [ or ] to change"
          onClick={() => setSizesOpen(!sizesOpen)}
        >
          <span style={{ width: dot(size), height: dot(size), background: ink }} />
        </button>
        <div className="brushpick__menu" role="group" aria-label="Brush size">
          {BRUSH_SIZES.map((s, i) => (
            <button
              key={s}
              type="button"
              className={`brush ${size === s ? 'is-active' : ''}`}
              onClick={() => {
                setSize(s);
                closeSizes();
              }}
              aria-label={`${SIZE_NAMES[i]} brush`}
              aria-pressed={size === s}
              data-tip={SIZE_NAMES[i]}
            >
              <span style={{ width: dot(s), height: dot(s), background: ink }} />
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar__group toolbar__seg" role="group" aria-label="Drawing tool">
        {/* Each tool shows its icon and word, and its key in its tooltip
            (data-tip). A phone shows the icon alone. */}
        <button type="button" className={`tool ${tool === 'pen' ? 'is-active' : ''}`} onClick={() => setTool('pen')} data-tip="Pen (P)">
          <Pencil className="tool__icon" aria-hidden="true" />
          <span className="tool__label">Pen</span>
        </button>
        <button type="button" className={`tool ${tool === 'fill' ? 'is-active' : ''}`} onClick={() => setTool('fill')} data-tip="Fill (F)">
          <PaintBucket className="tool__icon" aria-hidden="true" />
          <span className="tool__label">Fill</span>
        </button>
        <button type="button" className={`tool ${tool === 'eraser' ? 'is-active' : ''}`} onClick={() => setTool('eraser')} data-tip="Eraser (E)">
          <Eraser className="tool__icon" aria-hidden="true" />
          <span className="tool__label">Eraser</span>
        </button>
      </div>

      {/* Undo and redo, joined, and clear apart: actions, so icons alone,
          their names and keys in their tooltips. */}
      <div className="toolbar__group toolbar__seg" role="group" aria-label="History">
        <button type="button" className="tool tool--icon" onClick={() => socket.emit('canvas:undo')} data-tip="Undo (Z)">
          <Undo2 className="tool__icon" aria-hidden="true" />
          <span className="tool__label">Undo</span>
        </button>
        <button type="button" className="tool tool--icon" onClick={() => socket.emit('canvas:redo')} data-tip="Redo (Shift+Z)">
          <Redo2 className="tool__icon" aria-hidden="true" />
          <span className="tool__label">Redo</span>
        </button>
      </div>
      <button type="button" className="tool tool--icon tool--danger" onClick={() => socket.emit('canvas:clear')} data-tip="Clear">
        <Trash2 className="tool__icon" aria-hidden="true" />
        <span className="tool__label">Clear</span>
      </button>
    </div>
  );
}
