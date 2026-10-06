import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  cooldownFor, isDarkSquare, legalDestinations, squareName, viewOrder,
  type BoardSpec, type Piece, type Side, type Square,
} from '@pic-game/shared';
import { gameNow } from '../../net/clock.js';

/** One silhouette per piece, tinted per side in CSS. Unicode has a white set
 *  and a black set, which is no help once there are four players. */
const GLYPH: Record<Piece['type'], string> = {
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

export function ChessBoard({
  spec,
  pieces,
  mySide,
  live,
  cooldownMs,
  eliminated,
  onMove,
}: {
  spec: BoardSpec;
  pieces: Piece[];
  /** null when spectating — the board is then read-only. */
  mySide: Side | null;
  live: boolean;
  /** Base cooldown, needed to place a running bar on its full timeline. */
  cooldownMs: number;
  eliminated: Side[];
  onMove: (pieceId: string, to: Square) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  const bySquare = useMemo(() => {
    const m = new Map<Square, Piece>();
    for (const p of pieces) m.set(p.square, p);
    return m;
  }, [pieces]);

  const selectedPiece = selected ? pieces.find((p) => p.id === selected) ?? null : null;
  const targets = useMemo(
    () => (selectedPiece ? new Set(legalDestinations(pieces, selectedPiece, spec)) : new Set<Square>()),
    [pieces, selectedPiece, spec],
  );

  // Everyone looks at their own army from behind it, which on a four-way board
  // means rotating the view rather than flipping it.
  const order = useMemo(() => viewOrder(spec, mySide), [spec, mySide]);

  const iAmOut = !!mySide && eliminated.includes(mySide);
  const canPlay = live && !!mySide && !iAmOut;

  const clickSquare = (sq: Square) => {
    if (!canPlay) return;
    const here = bySquare.get(sq);

    if (selectedPiece && targets.has(sq)) {
      onMove(selectedPiece.id, sq);
      setSelected(null);
      return;
    }
    // Selecting is allowed on a cooling piece so you can plan, but the move
    // will not be accepted until it is ready.
    if (here && here.side === mySide) {
      setSelected(here.id === selected ? null : here.id);
      return;
    }
    setSelected(null);
  };

  // Cooldowns hold still while the game is paused.
  const now = gameNow();

  // Nothing else re-renders the board when a cooldown simply runs out, so the
  // piece would stay dimmed until some other move happened. Wake up once, when
  // the next one is due.
  const nextReady = pieces.reduce(
    (soonest, p) => (p.readyAt > now && p.readyAt < soonest ? p.readyAt : soonest),
    Number.POSITIVE_INFINITY,
  );
  useEffect(() => {
    if (!Number.isFinite(nextReady)) return;
    const id = setTimeout(tick, Math.max(50, nextReady - gameNow()) + 40);
    return () => clearTimeout(id);
  }, [nextReady]);

  return (
    <div
      className={`chess chess--${spec.variant}`}
      style={{ gridTemplateColumns: `repeat(${spec.size}, 1fr)` }}
      role="grid"
      aria-label="Chess board"
    >
      {order.map((sq) => {
        // The cut-away corners of a cruciform board. Rendered as empty cells so
        // the grid stays rectangular and the arms line up.
        if (!spec.playable(sq)) return <span key={sq} className="sq sq--void" />;

        const piece = bySquare.get(sq);
        const isTarget = targets.has(sq);
        const cooling = piece && piece.readyAt > now ? piece.readyAt - now : 0;
        const dead = piece ? eliminated.includes(piece.side) : false;

        return (
          <button
            key={sq}
            type="button"
            role="gridcell"
            aria-label={`${squareName(sq, spec.size)}${piece ? ` ${piece.side}${piece.type}` : ''}`}
            className={[
              'sq',
              isDarkSquare(spec, sq) ? 'sq--dark' : 'sq--light',
              isTarget ? (piece ? 'is-capture' : 'is-target') : '',
              piece && piece.id === selected ? 'is-selected' : '',
            ].join(' ')}
            onClick={() => clickSquare(sq)}
            disabled={!canPlay}
          >
            {piece && (
              <span
                className={`pc pc--${piece.side} ${cooling ? 'is-cooling' : ''} ${dead ? 'is-dead' : ''}`}
              >
                {GLYPH[piece.type]}
                {/* Described by its FULL duration plus a negative delay for the
                    part already elapsed, never by the time remaining. Changing
                    an animation's duration does not reset how far it has run,
                    so describing it by what is left made a re-render mid-
                    cooldown snap the bar to empty. */}
                {cooling > 0 && (
                  <span
                    className="pc__cool"
                    style={{
                      animationDuration: `${cooldownFor(piece.type, cooldownMs)}ms`,
                      animationDelay: `-${Math.max(
                        0,
                        cooldownFor(piece.type, cooldownMs) - cooling,
                      )}ms`,
                    }}
                  />
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
