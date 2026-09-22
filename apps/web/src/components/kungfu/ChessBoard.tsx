import { useMemo, useState } from 'react';
import {
  legalDestinations, squareName, type Piece, type Side, type Square,
} from '@pic-game/shared';
import { serverNow } from '../../net/clock.js';

const GLYPH: Record<Side, Record<Piece['type'], string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

export function ChessBoard({
  pieces,
  mySide,
  live,
  onMove,
}: {
  pieces: Piece[];
  /** null when spectating — the board is then read-only. */
  mySide: Side | null;
  live: boolean;
  onMove: (pieceId: string, to: Square) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

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
              <span
                className={`pc pc--${piece.side} ${cooling ? 'is-cooling' : ''}`}
                // The bar is a pure CSS animation so a ticking cooldown costs
                // no React renders. A negative delay starts it part-way
                // through, which is what a late joiner needs.
                style={
                  cooling
                    ? ({
                        '--cd': `${piece.readyAt - (piece.readyAt - cooling)}ms`,
                        animationDuration: `${cooling}ms`,
                      } as React.CSSProperties)
                    : undefined
                }
              >
                {GLYPH[piece.side][piece.type]}
                {cooling > 0 && <span className="pc__cool" style={{ animationDuration: `${cooling}ms` }} />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
