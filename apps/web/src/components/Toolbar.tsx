import { Eraser, PaintBucket, Pencil, Trash2, Undo2 } from 'lucide-react';
import { BRUSH_SIZES, PALETTE } from '@pic-game/shared';
import { getSocket } from '../net/socket.js';
import { useTools } from '../store/tools.js';

export function Toolbar() {
  const { tool, color, size, setTool, setColor, setSize } = useTools();
  const socket = getSocket();

  return (
    <div className="toolbar">
      <div className="toolbar__palette">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch ${color === c && tool !== 'eraser' ? 'is-active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`Colour ${c}`}
          />
        ))}
      </div>

      <div className="toolbar__group">
        {BRUSH_SIZES.map((s) => (
          <button
            key={s}
            type="button"
            className={`brush ${size === s ? 'is-active' : ''}`}
            onClick={() => setSize(s)}
            aria-label={`Brush size ${s}`}
          >
            <span style={{ width: s / 1.6, height: s / 1.6, background: tool === 'eraser' ? '#94a3b8' : color }} />
          </button>
        ))}
      </div>

      <div className="toolbar__group">
        {/* Each tool has an icon and a word: a desktop shows the word, a phone
            the icon, so a full set fits one row there. */}
        <button type="button" className={`tool ${tool === 'pen' ? 'is-active' : ''}`} onClick={() => setTool('pen')}>
          <Pencil className="tool__icon" aria-hidden="true" />
          <span className="tool__label">Pen</span>
        </button>
        <button type="button" className={`tool ${tool === 'fill' ? 'is-active' : ''}`} onClick={() => setTool('fill')}>
          <PaintBucket className="tool__icon" aria-hidden="true" />
          <span className="tool__label">Fill</span>
        </button>
        <button type="button" className={`tool ${tool === 'eraser' ? 'is-active' : ''}`} onClick={() => setTool('eraser')}>
          <Eraser className="tool__icon" aria-hidden="true" />
          <span className="tool__label">Eraser</span>
        </button>
      </div>

      <div className="toolbar__group">
        <button type="button" className="tool" onClick={() => socket.emit('canvas:undo')}>
          <Undo2 className="tool__icon" aria-hidden="true" />
          <span className="tool__label">Undo</span>
        </button>
        <button type="button" className="tool tool--danger" onClick={() => socket.emit('canvas:clear')}>
          <Trash2 className="tool__icon" aria-hidden="true" />
          <span className="tool__label">Clear</span>
        </button>
      </div>
    </div>
  );
}
