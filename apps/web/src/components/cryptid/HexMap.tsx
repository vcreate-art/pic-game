import { memo, useId, useMemo, type ReactNode } from 'react';
import {
  COLS, HEXES, ROWS, colOf, hexLabel, neighbour, rowOf,
  type CryptidBoard, type Structure, type Terrain,
} from '@pic-game/shared';

/** Hex radius in SVG units; everything else is drawn relative to it. */
const S = 30;
const SQRT3 = Math.sqrt(3);
const PAD_L = 22;
const PAD_T = 20;
export const MAP_W = PAD_L + S * (1.5 * (COLS - 1) + 2) + 6;
export const MAP_H = PAD_T + SQRT3 * S * (ROWS + 0.5) + 6;

export function centre(hex: number): [number, number] {
  const c = colOf(hex);
  const r = rowOf(hex);
  return [PAD_L + S + 1.5 * S * c, PAD_T + (SQRT3 / 2) * S + SQRT3 * S * (r + 0.5 * (c & 1))];
}

/** Corner i sits at 60°·i, y down, so side i (corner i to i+1) faces
 *  SE, S, SW, NW, N, NE in turn: the same order `neighbour` uses. */
function corners(hex: number, scale = 1): [number, number][] {
  const [cx, cy] = centre(hex);
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return [cx + S * scale * Math.cos(a), cy + S * scale * Math.sin(a)];
  });
}

const points = (pts: [number, number][]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

export const TERRAIN_NAMES: Record<Terrain, string> = {
  forest: 'Forest', desert: 'Desert', water: 'Water', swamp: 'Swamp', mountain: 'Mountain',
};

/** One structure glyph: a standing stone is a tall slab, a shack a little house. */
export function StructureGlyph({ s, x, y, size }: { s: Pick<Structure, 'shape' | 'color'>; x: number; y: number; size: number }) {
  const k = size / 10;
  const cls = `cstruct cstruct--${s.color}`;
  if (s.shape === 'stone') {
    return (
      <path
        className={cls}
        d={`M${x - 3.2 * k},${y + 5 * k} L${x - 3.8 * k},${y - 2.5 * k} L${x - 1.5 * k},${y - 5.5 * k} L${x + 2 * k},${y - 5 * k} L${x + 3.8 * k},${y - 1.5 * k} L${x + 3.2 * k},${y + 5 * k} Z`}
      />
    );
  }
  return (
    <path
      className={cls}
      d={`M${x - 5 * k},${y + 4.5 * k} L${x - 5 * k},${y - 0.5 * k} L${x},${y - 5.5 * k} L${x + 5 * k},${y - 0.5 * k} L${x + 5 * k},${y + 4.5 * k} Z`}
    />
  );
}

/** The ground: terrain, territory fences, structures and the grid labels.
 *  None of it changes once a map is dealt, so it renders once per board. */
const Ground = memo(function Ground({ board, pid }: { board: CryptidBoard; pid: string }) {
  const structAt = new Map(board.structures.map((s) => [s.hex, s]));
  const fences: { d: string; animal: string }[] = [];
  for (let h = 0; h < HEXES; h++) {
    const a = board.animal[h];
    if (!a) continue;
    // On the true edges, so neighbouring segments meet and a territory reads
    // as one fenced region rather than a ring per space.
    const edge = corners(h);
    let d = '';
    for (let side = 0; side < 6; side++) {
      const n = neighbour(h, side);
      if (n !== null && board.animal[n] === a) continue;
      const [x1, y1] = edge[side]!;
      const [x2, y2] = edge[(side + 1) % 6]!;
      d += `M${x1.toFixed(1)},${y1.toFixed(1)}L${x2.toFixed(1)},${y2.toFixed(1)}`;
    }
    if (d) fences.push({ d, animal: a });
  }

  return (
    <g className="cmap__ground">
      {Array.from({ length: HEXES }, (_, h) => {
        const pts = points(corners(h));
        return (
          <g key={h}>
            <polygon points={pts} className={`cterr cterr--${board.terrain[h]}`} />
            <polygon points={pts} fill={`url(#${pid}-${board.terrain[h]})`} className="cterr__tex" />
          </g>
        );
      })}
      {fences.map((f, i) => (
        <path key={i} d={f.d} className={`cfence cfence--${f.animal}`} />
      ))}
      {[...structAt.values()].map((s) => {
        const [x, y] = centre(s.hex);
        return <StructureGlyph key={s.hex} s={s} x={x} y={y - S * 0.42} size={S * 0.36} />;
      })}
      {Array.from({ length: COLS }, (_, c) => {
        const [x] = centre(c);
        return <text key={`c${c}`} x={x} y={PAD_T - 6} className="cmap__axis">{String.fromCharCode(65 + c)}</text>;
      })}
      {Array.from({ length: ROWS }, (_, r) => {
        const [, y] = centre(r * COLS);
        return <text key={`r${r}`} x={PAD_L - 12} y={y + 4} className="cmap__axis">{r + 1}</text>;
      })}
    </g>
  );
});

/** Small repeating marks per terrain, so the map reads without colour too. */
function Patterns({ pid }: { pid: string }) {
  const p = (t: Terrain, w: number, h: number, body: ReactNode) => (
    <pattern key={t} id={`${pid}-${t}`} width={w} height={h} patternUnits="userSpaceOnUse">{body}</pattern>
  );
  return (
    <defs>
      {p('forest', 14, 14, <path d="M4,9 L7,3 L10,9 Z" className="ctex ctex--fill" />)}
      {p('desert', 10, 10, <><circle cx="2.5" cy="2.5" r=".9" className="ctex ctex--fill" /><circle cx="7.5" cy="7.5" r=".9" className="ctex ctex--fill" /></>)}
      {p('water', 16, 8, <path d="M0,5 Q4,2 8,5 T16,5" className="ctex" />)}
      {p('swamp', 12, 12, <path d="M3,10 L3,5 M6,10 L6,3 M9,10 L9,6" className="ctex" />)}
      {p('mountain', 16, 12, <path d="M2,9 L6,4 L10,9 M8,9 L11,6 L14,9" className="ctex" />)}
    </defs>
  );
}

/** Where each seat's disk sits within a space, so a player's disks are always
 *  in the same place: an arc round the lower half, below the structure. */
const DISK_SLOTS = [180, 135, 90, 45, 0].map((deg) => {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * S * 0.56, Math.sin(a) * S * 0.5] as const;
});

export interface HexMapProps {
  board: CryptidBoard;
  /** Seat colour by player id. */
  colorOf: (id: string) => string;
  seatOf: (id: string) => number;
  disks: string[][];
  cubes: (string | null)[];
  selected: number | null;
  /** Spaces to point at: the last move, or a history line being hovered. */
  focus: number | null;
  /** Spaces to shade, e.g. where your own clue rules the creature out. */
  shade: Set<number> | null;
  answer: number | null;
  onPick?: (hex: number) => void;
  onHover?: (hex: number | null) => void;
}

export function HexMap(props: HexMapProps) {
  const { board, colorOf, seatOf, disks, cubes, selected, focus, shade, answer, onPick, onHover } = props;
  const pid = useId().replace(/:/g, '');
  const outlines = useMemo(() => Array.from({ length: HEXES }, (_, h) => points(corners(h))), []);

  return (
    <svg
      className="cmap"
      viewBox={`0 0 ${MAP_W.toFixed(0)} ${MAP_H.toFixed(0)}`}
      role="img"
      aria-label="The map"
      onPointerLeave={() => onHover?.(null)}
    >
      <Patterns pid={pid} />
      <Ground board={board} pid={pid} />

      {shade && (
        <g className="cmap__shade">
          {[...shade].map((h) => <polygon key={h} points={outlines[h]} />)}
        </g>
      )}

      <g className="cmap__pieces">
        {Array.from({ length: HEXES }, (_, h) => {
          const [cx, cy] = centre(h);
          const cube = cubes[h];
          const here = disks[h] ?? [];
          if (!cube && !here.length) return null;
          return (
            <g key={h}>
              {here.map((id) => {
                const [dx, dy] = DISK_SLOTS[seatOf(id) % DISK_SLOTS.length]!;
                return (
                  <circle key={id} className="cdisk" cx={cx + dx} cy={cy + dy} r={S * 0.17} fill={colorOf(id)} />
                );
              })}
              {cube && (
                <rect
                  className="ccube"
                  x={cx - S * 0.23}
                  y={cy - S * 0.13}
                  width={S * 0.46}
                  height={S * 0.46}
                  rx={2}
                  fill={colorOf(cube)}
                />
              )}
            </g>
          );
        })}
      </g>

      {answer !== null && (
        <g className="cmap__answer">
          <polygon points={outlines[answer]} />
          <text x={centre(answer)[0]} y={centre(answer)[1] + 7}>🐾</text>
        </g>
      )}
      {focus !== null && focus !== selected && focus !== answer && <polygon className="cmap__focus" points={outlines[focus]} />}
      {selected !== null && <polygon className="cmap__selected" points={outlines[selected]} />}

      {/* Hit targets last, so they sit over the pieces and catch every tap. */}
      <g className="cmap__hits">
        {outlines.map((pts, h) => (
          <polygon
            key={h}
            points={pts}
            className={onPick ? 'is-live' : ''}
            onClick={onPick ? () => onPick(h) : undefined}
            onPointerEnter={() => onHover?.(h)}
          >
            <title>{hexLabel(h)}</title>
          </polygon>
        ))}
      </g>
    </svg>
  );
}
