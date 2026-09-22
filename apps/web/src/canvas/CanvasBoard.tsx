import { useEffect, useRef } from 'react';
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
        style={{ touchAction: 'none' }}
      />
      {!isDrawer && <div className="board__lock" aria-hidden="true" />}
    </div>
  );
}
