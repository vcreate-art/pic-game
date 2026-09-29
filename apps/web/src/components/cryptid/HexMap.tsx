import { memo, useId, useMemo, type ReactNode } from 'react';
import {
  COLS, HEXES, ROWS, TERRAINS, colOf, hexLabel, neighbour, rowOf,
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
const f = (n: number) => n.toFixed(1);

export const TERRAIN_NAMES: Record<Terrain, string> = {
  forest: 'Forest', desert: 'Desert', water: 'Water', swamp: 'Swamp', mountain: 'Mountain',
};

// -------------------------------------------------------------- structures

/**
 * A structure, centred on (x, y), in units of `u` (a hex radius on the map).
 * The two shapes are told apart by silhouette before colour: a standing stone
 * is a tall narrow monolith, a shack a wide low house with a roof and a door.
 */
export function StructureGlyph({ s, x, y, u }: { s: Pick<Structure, 'shape' | 'color'>; x: number; y: number; u: number }) {
  const cls = `cstruct cstruct--${s.color}`;
  if (s.shape === 'stone') {
    const w = 0.24 * u;
    const h = 0.58 * u;
    const top = y - h / 2;
    const bot = y + h / 2;
    return (
      <g>
        <ellipse className="cstruct__shadow" cx={x} cy={bot} rx={w * 0.85} ry={u * 0.05} />
        <path
          className={cls}
          d={`M${f(x - w / 2)},${f(bot)} L${f(x - w / 2 + 0.02 * u)},${f(top + w / 2)} Q${f(x - w / 2 + 0.02 * u)},${f(top)} ${f(x)},${f(top)} Q${f(x + w / 2 - 0.02 * u)},${f(top)} ${f(x + w / 2 - 0.02 * u)},${f(top + w / 2)} L${f(x + w / 2)},${f(bot)} Z`}
        />
        <path className="cstruct__mark" d={`M${f(x - 0.03 * u)},${f(top + 0.16 * u)} l${f(0.05 * u)},${f(0.1 * u)} l${f(-0.04 * u)},${f(0.1 * u)}`} />
      </g>
    );
  }
  const w = 0.56 * u;
  const eave = y - 0.02 * u;
  const bot = y + 0.2 * u;
  const peak = y - 0.24 * u;
  return (
    <g>
      <ellipse className="cstruct__shadow" cx={x} cy={bot} rx={w * 0.55} ry={u * 0.05} />
      <path
        className={cls}
        d={`M${f(x - w / 2 + 0.04 * u)},${f(bot)} L${f(x - w / 2 + 0.04 * u)},${f(eave)} L${f(x - w / 2)},${f(eave)} L${f(x)},${f(peak)} L${f(x + w / 2)},${f(eave)} L${f(x + w / 2 - 0.04 * u)},${f(eave)} L${f(x + w / 2 - 0.04 * u)},${f(bot)} Z`}
      />
      <rect className="cstruct__door" x={x - 0.06 * u} y={bot - 0.14 * u} width={0.12 * u} height={0.14 * u} />
    </g>
  );
}

// ------------------------------------------------------------ terrain art

/** A small repeatable random stream per space, so the art varies from space
 *  to space but is the same on every render and every screen. */
function seeded(n: number): () => number {
  let s = (n * 2654435761) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where scenery may go inside a space, in hex radii from its centre. The top
 *  middle is left clear for a structure. */
const SPOTS: readonly [number, number][] = [
  [-0.46, -0.3], [0.46, -0.3], [-0.6, 0.12], [0.6, 0.12], [-0.28, 0.5],
  [0.3, 0.5], [0, 0.08], [-0.2, -0.62], [0.22, -0.62], [0.02, 0.62],
];
const COUNT: Record<Terrain, number> = { forest: 4, desert: 2, water: 3, swamp: 3, mountain: 2 };

function scenery(t: Terrain, x: number, y: number, r: () => number, key: string): ReactNode {
  const u = S;
  switch (t) {
    case 'forest': {
      const k = 0.85 + r() * 0.35;
      return (
        <g key={key} transform={`translate(${f(x)},${f(y)}) scale(${k.toFixed(2)})`}>
          <rect className="cart-trunk" x={-0.03 * u} y={0.06 * u} width={0.06 * u} height={0.08 * u} />
          <path className="cart-tree" d={`M0,${f(-0.26 * u)} L${f(0.13 * u)},${f(-0.04 * u)} L${f(-0.13 * u)},${f(-0.04 * u)} Z`} />
          <path className="cart-tree" d={`M0,${f(-0.14 * u)} L${f(0.17 * u)},${f(0.08 * u)} L${f(-0.17 * u)},${f(0.08 * u)} Z`} />
          <path className="cart-tree-lit" d={`M0,${f(-0.26 * u)} L${f(-0.13 * u)},${f(-0.04 * u)} L0,${f(-0.04 * u)} Z`} />
        </g>
      );
    }
    case 'desert':
      return r() < 0.25 ? (
        <g key={key} transform={`translate(${f(x)},${f(y)})`}>
          <path className="cart-cactus" d={`M0,${f(0.12 * u)} V${f(-0.14 * u)} M0,${f(-0.02 * u)} h${f(-0.08 * u)} v${f(-0.07 * u)} M0,${f(0.03 * u)} h${f(0.08 * u)} v${f(-0.08 * u)}`} />
        </g>
      ) : (
        <path key={key} className="cart-dune" d={`M${f(x - 0.22 * u)},${f(y)} Q${f(x)},${f(y - 0.16 * u)} ${f(x + 0.22 * u)},${f(y)}`} />
      );
    case 'water':
      return (
        <path
          key={key}
          className="cart-wave"
          d={`M${f(x - 0.2 * u)},${f(y)} q${f(0.1 * u)},${f(-0.1 * u)} ${f(0.2 * u)},0 t${f(0.2 * u)},0`}
        />
      );
    case 'swamp':
      return (
        <g key={key} transform={`translate(${f(x)},${f(y)})`}>
          <ellipse className="cart-pool" cx={0} cy={0.07 * u} rx={0.17 * u} ry={0.05 * u} />
          <path className="cart-reed" d={`M${f(-0.06 * u)},${f(0.07 * u)} q${f(-0.02 * u)},${f(-0.12 * u)} ${f(-0.07 * u)},${f(-0.2 * u)} M0,${f(0.07 * u)} V${f(-0.18 * u)} M${f(0.06 * u)},${f(0.07 * u)} q${f(0.02 * u)},${f(-0.1 * u)} ${f(0.07 * u)},${f(-0.16 * u)}`} />
          <ellipse className="cart-cattail" cx={0} cy={-0.19 * u} rx={0.025 * u} ry={0.05 * u} />
        </g>
      );
    case 'mountain': {
      const k = 0.9 + r() * 0.3;
      return (
        <g key={key} transform={`translate(${f(x)},${f(y)}) scale(${k.toFixed(2)})`}>
          <path className="cart-peak" d={`M${f(-0.26 * u)},${f(0.12 * u)} L0,${f(-0.24 * u)} L${f(0.26 * u)},${f(0.12 * u)} Z`} />
          <path className="cart-peak-shade" d={`M0,${f(-0.24 * u)} L${f(0.26 * u)},${f(0.12 * u)} L${f(0.04 * u)},${f(0.12 * u)} Z`} />
          <path className="cart-snow" d={`M${f(-0.08 * u)},${f(-0.13 * u)} L0,${f(-0.24 * u)} L${f(0.08 * u)},${f(-0.13 * u)} L${f(0.03 * u)},${f(-0.1 * u)} L${f(-0.02 * u)},${f(-0.14 * u)} Z`} />
        </g>
      );
    }
  }
}

function spaceArt(board: CryptidBoard, h: number, hasStructure: boolean): ReactNode[] {
  const t = board.terrain[h]!;
  const r = seeded(h * 31 + TERRAINS.indexOf(t));
  const spots = SPOTS.filter(([sx, sy]) => !(hasStructure && sy < -0.1 && Math.abs(sx) < 0.35));
  const [cx, cy] = centre(h);
  const out: ReactNode[] = [];
  const pool = [...spots];
  for (let i = 0; i < COUNT[t] && pool.length; i++) {
    const [sx, sy] = pool.splice(Math.floor(r() * pool.length), 1)[0]!;
    const jx = (r() - 0.5) * 0.12;
    const jy = (r() - 0.5) * 0.12;
    out.push(scenery(t, cx + (sx + jx) * S, cy + (sy + jy) * S, r, `${h}-${i}`));
  }
  return out;
}

/** Structures drawn a little over a hex radius tall, so they read at a glance. */
const STRUCT_U = S * 1.15;

/** The ground: terrain and scenery. None of it changes once a map is dealt,
 *  so it renders once per board. */
const Ground = memo(function Ground({ board, pid }: { board: CryptidBoard; pid: string }) {
  const structAt = new Set(board.structures.map((s) => s.hex));
  return (
    <g className="cmap__ground">
      {Array.from({ length: HEXES }, (_, h) => (
        <g key={h} className={`cspace cspace--${board.terrain[h]}`}>
          <polygon points={points(corners(h))} fill={`url(#${pid}-${board.terrain[h]})`} className="cterr" />
          <polygon points={points(corners(h, 0.9))} className="cterr__bevel" />
          {spaceArt(board, h, structAt.has(h))}
        </g>
      ))}
    </g>
  );
});

/** What clues are about: territory fences and structures, with the grid
 *  labels. Drawn above the wash on ruled-out spaces, so it never hides them. */
const Landmarks = memo(function Landmarks({ board }: { board: CryptidBoard }) {
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
      d += `M${f(x1)},${f(y1)}L${f(x2)},${f(y2)}`;
    }
    if (d) fences.push({ d, animal: a });
  }

  return (
    <g className="cmap__landmarks">
      {fences.map((fe, i) => (
        <path key={i} d={fe.d} className={`cfence cfence--${fe.animal}`} />
      ))}
      {board.structures.map((s) => {
        const [x, y] = centre(s.hex);
        return <StructureGlyph key={s.hex} s={s} x={x} y={y - S * 0.44} u={STRUCT_U} />;
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

/** A light-to-dark wash per terrain, and the hatch that marks ruled-out spaces. */
function Defs({ pid }: { pid: string }) {
  return (
    <defs>
      {TERRAINS.map((t) => (
        <linearGradient key={t} id={`${pid}-${t}`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" style={{ stopColor: `var(--cry-${t}-hi)` }} />
          <stop offset="1" style={{ stopColor: `var(--cry-${t})` }} />
        </linearGradient>
      ))}
      <pattern id={`${pid}-out`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="7" height="7" className="cshade__wash" />
        <line x1="0" y1="0" x2="0" y2="7" className="cshade__line" />
      </pattern>
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
  /** A space to point at: a history line being hovered. */
  focus: number | null;
  /** The spaces the last move touched, ringed in the colour of who made it. */
  last: { hexes: number[]; color: string; key: number } | null;
  /** Spaces to wash out, e.g. where your own clue rules the creature out. */
  shade: Set<number> | null;
  answer: number | null;
  onPick?: (hex: number) => void;
  onHover?: (hex: number | null) => void;
}

export function HexMap(props: HexMapProps) {
  const { board, colorOf, seatOf, disks, cubes, selected, focus, last, shade, answer, onPick, onHover } = props;
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
      <Defs pid={pid} />
      <Ground board={board} pid={pid} />

      {shade && (
        <g className="cmap__shade">
          {[...shade].map((h) => <polygon key={h} points={outlines[h]} fill={`url(#${pid}-out)`} />)}
        </g>
      )}
      <Landmarks board={board} />

      {last?.hexes.filter((h) => h !== answer).map((h) => (
        <polygon
          key={`${last.key}-${h}`}
          className="cmap__last"
          points={points(corners(h, 0.94))}
          style={{ stroke: last.color }}
        />
      ))}

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
