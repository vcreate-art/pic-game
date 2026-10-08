import { useEffect, useMemo, useRef, useState } from 'react';
import { LOGICAL_H, LOGICAL_W } from '@pic-game/shared';
import { getSocket } from '../net/socket.js';
import { selectIsDrawer, useGame } from '../store/game.js';
import { useTools } from '../store/tools.js';
import { getEngine } from './engineInstance.js';
import { DrawInput, type DrawSink } from './input.js';
import { uid } from '../lib/uid.js';

export function CanvasBoard() {
  const ref = useRef<HTMLCanvasElement>(null);
  const isDrawer = useGame(selectIsDrawer);
  const inputRef = useRef<DrawInput | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const engine = getEngine();
    const socket = getSocket();
    engine.attach(canvas);

    // Local echo: paint immediately, then tell the server. Waiting for the
    // round trip would put a visible lag under the drawer's own cursor.
    const sink: DrawSink = {
      start(op) {
        engine.startStroke({ kind: 'stroke', by: 'me', ...op });
        socket.emit('draw:start', op);
      },
      append(id, pts) {
        engine.appendStroke(id, pts);
        socket.emit('draw:append', { id, pts });
      },
      end(id) {
        engine.endStroke(id);
        socket.emit('draw:end', { id });
      },
      replace(id, pts) {
        engine.replaceStroke(id, pts);
        socket.emit('draw:replace', { id, pts });
      },
      fill(x, y, color) {
        engine.applyFill({ kind: 'fill', id: uid(), by: 'me', x, y, color });
        socket.emit('draw:fill', { x, y, color });
      },
    };

    const input = new DrawInput(sink, () => useTools.getState());
    input.attach(canvas);
    inputRef.current = input;

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);
    window.addEventListener('resize', () => engine.resize());

    return () => {
      ro.disconnect();
      input.detach();
      engine.detach();
      inputRef.current = null;
    };
  }, []);

  // How many screen px one logical px is, for sizing the brush cursor.
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => setScale(canvas.getBoundingClientRect().width / LOGICAL_W || 1));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);
  const { tool, color, size } = useTools();
  const cursor = useMemo(() => brushCursor(tool, color, size * scale), [tool, color, size, scale]);

  // Re-checked whenever the turn changes, so input dies the instant the turn ends.
  useEffect(() => {
    inputRef.current?.setEnabled(isDrawer);
  }, [isDrawer]);

  return (
    <div className="board" style={{ aspectRatio: `${LOGICAL_W} / ${LOGICAL_H}` }}>
      <canvas
        ref={ref}
        className={`board__canvas ${isDrawer ? 'is-drawable' : ''}`}
        // Stops the browser scrolling or text-selecting under a drawing finger.
        style={{ touchAction: 'none', ...(isDrawer ? { cursor } : {}) }}
      />
      {!isDrawer && <div className="board__lock" aria-hidden="true" />}
    </div>
  );
}

/** Browsers draw a cursor image up to 128px; the brush ring stays inside it. */
const CURSOR_MAX = 120;

/**
 * The cursor while drawing: a ring the size the brush paints at, on screen,
 * in its colour (grey for the eraser), with a faint dark edge so it shows on
 * any colour, white included, and a dot in the middle when it's too small
 * to read as a ring. An image cursor, so the browser draws it with the
 * pointer, never trailing behind. Fill works at a point: a crosshair.
 */
function brushCursor(tool: string, color: string, diameter: number): string {
  if (tool === 'fill') return 'crosshair';
  const d = Math.max(4, Math.min(CURSOR_MAX, diameter));
  const box = Math.ceil(d + 6);
  const c = box / 2;
  const r = d / 2;
  const eraser = tool === 'eraser';
  const ink = eraser ? '#8a8f9c' : color;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">` +
    `<circle cx="${c}" cy="${c}" r="${r + 1}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1"/>` +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="${eraser ? 'rgba(255,255,255,.6)' : 'none'}" stroke="${ink}" stroke-width="1.5"/>` +
    (d < 10 ? `<circle cx="${c}" cy="${c}" r="1.2" fill="${ink}"/>` : '') +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(c)} ${Math.round(c)}, crosshair`;
}
