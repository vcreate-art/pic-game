import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  cooldownFor, legalDestinations, squareName, type Piece, type Side, type Square,
} from '@pic-game/shared';
import { serverNow } from '../../net/clock.js';

/** One silhouette per piece, tinted per side in CSS. Unicode has a white set
 *  and a black set, which is no help once there are four players. */
const GLYPH: Record<Piece['type'], string> = {
  k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',
};

export function ChessBoard({
  pieces,
  mySide,
  live,
  cooldownMs,
  onMove,
}: {
  pieces: Piece[];
  /** null when spectating — the board is then read-only. */
  mySide: Side | null;
  live: boolean;
  /** Base cooldown, needed to place a running bar on its full timeline. */
  cooldownMs: number;
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
    () => (selectedPiece ? new Set(legalDestinations(pieces, selectedPiece)) : new Set<Square>()),
    [pieces, selectedPiece],
  );

  // Black plays from the far side, so their pieces sit at the bottom.
  const order = useMemo(() => {
    const squares = Array.from({ length: 64 }, (_, i) => i);
    // Rank 8 first for white; reversed for black.
    const rows: Square[][] = [];
    for (let r = 7; r >= 0; r--) rows.push(squares.slice(r * 8, r * 8 + 8));
    return mySide === 'b' ? rows.reverse().map((row) => [...row].reverse()) : rows;
  }, [mySide]);

  const clickSquare = (sq: Square) => {
    if (!live || !mySide) return;
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

  const now = serverNow();

  // Nothing else re-renders the board when a cooldown simply runs out, so the
  // piece would stay dimmed until some other move happened. Wake up once, when
  // the next one is due.
  const nextReady = pieces.reduce(
    (soonest, p) => (p.readyAt > now && p.readyAt < soonest ? p.readyAt : soonest),
    Number.POSITIVE_INFINITY,
  );
  useEffect(() => {
    if (!Number.isFinite(nextReady)) return;
    const id = setTimeout(tick, Math.max(50, nextReady - serverNow()) + 40);
    return () => clearTimeout(id);
  }, [nextReady]);

  return (
    <div className="chess" role="grid" aria-label="Chess board">
      {order.flat().map((sq) => {
        const piece = bySquare.get(sq);
        const dark = (((sq / 8) | 0) + (sq % 8)) % 2 === 0;
        const isTarget = targets.has(sq);
        const cooling = piece && piece.readyAt > now ? piece.readyAt - now : 0;

        return (
          <button
            key={sq}
            type="button"
            role="gridcell"
            aria-label={`${squareName(sq)}${piece ? ` ${piece.side}${piece.type}` : ''}`}
            className={[
              'sq',
              dark ? 'sq--dark' : 'sq--light',
              isTarget ? (piece ? 'is-capture' : 'is-target') : '',
              piece && piece.id === selected ? 'is-selected' : '',
            ].join(' ')}
            onClick={() => clickSquare(sq)}
            disabled={!live || !mySide}
          >
            {piece && (
              <span className={`pc pc--${piece.side} ${cooling ? 'is-cooling' : ''}`}>
                {GLYPH[piece.type]}
                {/* Described by its FULL duration plus a negative delay for the
                    part already elapsed, never by the time remaining. Changing
                    an animation's duration does not reset how far it has run,
                    so a re-render mid-cooldown used to shorten the timeline
                    under a bar that had already travelled — and it jumped
                    straight to empty while the server still said "wait". These
                    two values describe the same absolute timeline on every
                    render, so re-rendering cannot move the bar. */}
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
