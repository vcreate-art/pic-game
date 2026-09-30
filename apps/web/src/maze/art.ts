import {
  MAZE_TILE, TILE_KIND, mazeTileAt, seededRng, wallAt, worldH, worldW,
  type MazeMap, type MazeTheme,
} from '@pic-game/shared';

/** How tall walls stand, in world pixels: their tops are drawn this far up,
 *  over whatever is just behind them. */
export const WALL_H = 12;
const T = MAZE_TILE;

export interface ThemeLook {
  /** The page behind the maze, beyond its outer wall. */
  void: string;
  /** Darkness laid over everything, which lights cut through (0 to 1). */
  ambient: number;
  ambientRgb: string;
  /** How far a player's own light reaches. */
  playerLight: number;
  mini: { bg: string; wall: string; cover: string };
}

export const THEME_LOOK: Record<MazeTheme, ThemeLook> = {
  neon: { void: '#020308', ambient: 0.5, ambientRgb: '2, 3, 12', playerLight: 260, mini: { bg: 'rgba(5, 6, 13, 0.9)', wall: '#22d3ee', cover: '#e879f9' } },
  temple: { void: '#0d1206', ambient: 0.32, ambientRgb: '14, 20, 6', playerLight: 240, mini: { bg: 'rgba(40, 36, 24, 0.9)', wall: '#8a8466', cover: '#b3a987' } },
  industrial: { void: '#0b0d11', ambient: 0.38, ambientRgb: '6, 8, 12', playerLight: 240, mini: { bg: 'rgba(20, 24, 31, 0.9)', wall: '#6b7280', cover: '#d97706' } },
};

const solid = (m: MazeMap, x: number, y: number) => wallAt(m, x, y);
const floorAt = (m: MazeMap, x: number, y: number) => !wallAt(m, x, y);

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

// ----------------------------------------------------------------- floors

/**
 * The ground: the theme's floor, its decoration, and soft shadow where the
 * floor meets a wall. Drawn once per map, under everything.
 */
export function buildFloor(m: MazeMap, theme: MazeTheme, seed: number): HTMLCanvasElement {
  const [c, g] = canvas(worldW(m), worldH(m));
  const rng = seededRng(seed ^ 0x5eed);
  g.fillStyle = THEME_LOOK[theme].void;
  g.fillRect(0, 0, c.width, c.height);
  if (theme === 'neon') neonFloor(m, g);
  else if (theme === 'temple') templeFloor(m, g, rng);
  else industrialFloor(m, g, rng);
  shadows(m, g);
  return c;
}

function eachFloor(m: MazeMap, fn: (tx: number, ty: number, x: number, y: number) => void): void {
  for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) if (floorAt(m, tx, ty)) fn(tx, ty, tx * T, ty * T);
}

const inArena = (m: MazeMap, tx: number, ty: number) =>
  m.rooms?.some((r) => r.arena && tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) ?? false;

function neonFloor(m: MazeMap, g: CanvasRenderingContext2D): void {
  eachFloor(m, (tx, ty, x, y) => {
    const arena = inArena(m, tx, ty);
    g.fillStyle = arena ? '#0b0620' : '#05060d';
    g.fillRect(x, y, T, T);
    g.strokeStyle = arena ? 'rgba(232, 121, 249, 0.13)' : 'rgba(56, 189, 248, 0.08)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, T, T);
    // A brighter line every fourth tile, like a larger grid behind the small one.
    g.strokeStyle = arena ? 'rgba(232, 121, 249, 0.3)' : 'rgba(56, 189, 248, 0.2)';
    if (tx % 4 === 0) { g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + T); g.stroke(); }
    if (ty % 4 === 0) { g.beginPath(); g.moveTo(x, y + 0.5); g.lineTo(x + T, y + 0.5); g.stroke(); }
  });
}

function templeFloor(m: MazeMap, g: CanvasRenderingContext2D, rng: () => number): void {
  eachFloor(m, (tx, ty, x, y) => {
    const v = ((tx * 7 + ty * 13) % 5) - 2;
    g.fillStyle = `rgb(${139 + v * 4}, ${125 + v * 4}, ${91 + v * 3})`;
    g.fillRect(x, y, T, T);
    g.strokeStyle = 'rgba(80, 68, 44, 0.55)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
    if (rng() < 0.12) {
      // A crack across the slab.
      g.strokeStyle = 'rgba(70, 58, 36, 0.6)';
      g.beginPath();
      g.moveTo(x + rng() * T, y + 2);
      g.lineTo(x + rng() * T, y + T / 2);
      g.lineTo(x + rng() * T, y + T - 2);
      g.stroke();
    }
  });
  // Moss creeping over the stones, puddles, and fallen leaves.
  eachFloor(m, (tx, ty, x, y) => {
    const r = rng();
    if (r < 0.09) {
      g.fillStyle = 'rgba(77, 107, 47, 0.55)';
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.arc(x + rng() * T, y + rng() * T, 4 + rng() * 9, 0, Math.PI * 2);
        g.fill();
      }
    } else if (r < 0.115) {
      g.fillStyle = 'rgba(47, 111, 122, 0.7)';
      g.beginPath();
      g.ellipse(x + T / 2, y + T / 2, 12 + rng() * 10, 7 + rng() * 5, rng() * Math.PI, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(180, 230, 235, 0.35)';
      g.beginPath();
      g.ellipse(x + T / 2 - 4, y + T / 2 - 2, 4, 2, 0, 0, Math.PI * 2);
      g.fill();
    } else if (r < 0.2) {
      g.fillStyle = rng() < 0.5 ? 'rgba(120, 140, 50, 0.8)' : 'rgba(160, 110, 40, 0.8)';
      g.beginPath();
      g.ellipse(x + rng() * T, y + rng() * T, 3, 1.6, rng() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function industrialFloor(m: MazeMap, g: CanvasRenderingContext2D, rng: () => number): void {
  eachFloor(m, (tx, ty, x, y) => {
    g.fillStyle = (Math.floor(tx / 2) + Math.floor(ty / 2)) % 2 ? '#3a404c' : '#363c47';
    g.fillRect(x, y, T, T);
    // Plate seams every two tiles, rivets at their corners.
    g.fillStyle = '#2a2f38';
    if (tx % 2 === 0) g.fillRect(x, y, 1.5, T);
    if (ty % 2 === 0) g.fillRect(x, y, T, 1.5);
    // A rivet in each plate's corners: every tile is one corner of its plate,
    // and draws that corner's rivet itself so no later tile paints over it.
    g.fillStyle = '#5a6272';
    g.beginPath();
    g.arc(tx % 2 === 0 ? x + 4 : x + T - 4, ty % 2 === 0 ? y + 4 : y + T - 4, 1.4, 0, Math.PI * 2);
    g.fill();
    const r = rng();
    if (r < 0.05) {
      // A floor grate.
      g.fillStyle = '#1c2027';
      g.fillRect(x + 4, y + 4, T - 8, T - 8);
      g.strokeStyle = '#4b5261';
      g.lineWidth = 1.5;
      for (let i = 8; i < T - 4; i += 5) {
        g.beginPath();
        g.moveTo(x + i, y + 5);
        g.lineTo(x + i, y + T - 5);
        g.stroke();
      }
    } else if (r < 0.08) {
      g.fillStyle = 'rgba(10, 10, 14, 0.45)';
      g.beginPath();
      g.ellipse(x + T / 2, y + T / 2, 8 + rng() * 10, 5 + rng() * 6, rng() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  });
  // Hazard stripes round the arena's edge.
  const arena = m.rooms?.find((r) => r.arena);
  if (arena) {
    const x0 = arena.x * T + 6;
    const y0 = arena.y * T + 6;
    const w = arena.w * T - 12;
    const h = arena.h * T - 12;
    g.save();
    g.beginPath();
    g.rect(x0, y0, w, h);
    g.rect(x0 + 8, y0 + 8, w - 16, h - 16);
    g.clip('evenodd');
    g.fillStyle = '#eab308';
    g.fillRect(x0, y0, w, h);
    g.fillStyle = '#111827';
    for (let i = -h; i < w + h; i += 16) {
      g.beginPath();
      g.moveTo(x0 + i, y0);
      g.lineTo(x0 + i + 8, y0);
      g.lineTo(x0 + i + 8 - h, y0 + h);
      g.lineTo(x0 + i - h, y0 + h);
      g.fill();
    }
    g.restore();
  }
}

/** Soft shade on the floor along walls to the north and west, as if lit from
 *  the top left: it makes the walls stand up off the ground. */
function shadows(m: MazeMap, g: CanvasRenderingContext2D): void {
  eachFloor(m, (tx, ty, x, y) => {
    if (solid(m, tx, ty - 1)) {
      const s = g.createLinearGradient(0, y, 0, y + 14);
      s.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
      s.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = s;
      g.fillRect(x, y, T, 14);
    }
    if (solid(m, tx - 1, ty)) {
      const s = g.createLinearGradient(x, 0, x + 9, 0);
      s.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
      s.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = s;
      g.fillRect(x, y, 9, T);
    }
  });
}

// ------------------------------------------------------------------ walls

/**
 * The walls, raised: each solid tile's top is drawn WALL_H up, with its front
 * face showing below where it meets open floor. This layer goes over the
 * players, so someone just behind a wall is partly hidden by it.
 */
export function buildWalls(m: MazeMap, theme: MazeTheme, seed: number): HTMLCanvasElement {
  const [c, g] = canvas(worldW(m), worldH(m));
  const rng = seededRng(seed ^ 0xa11);
  // Fronts first, then tops over them, row by row down the map, so a wall
  // further south covers the top of one behind it.
  for (let ty = 0; ty < m.h; ty++) {
    for (let tx = 0; tx < m.w; tx++) {
      const kind = mazeTileAt(m, tx, ty);
      if (kind === TILE_KIND.FLOOR) continue;
      const x = tx * T;
      const y = ty * T;
      if (!solid(m, tx, ty + 1)) front(g, theme, kind, x, y + T - WALL_H, rng);
      top(g, m, theme, kind, tx, ty, x, y - WALL_H, rng);
    }
  }
  return c;
}

function front(g: CanvasRenderingContext2D, theme: MazeTheme, kind: number, x: number, y: number, rng: () => number): void {
  const cover = kind === TILE_KIND.COVER;
  if (theme === 'neon') {
    g.fillStyle = cover ? '#1a0b2e' : '#060a18';
    g.fillRect(x, y, T, WALL_H);
    g.fillStyle = cover ? 'rgba(232, 121, 249, 0.35)' : 'rgba(34, 211, 238, 0.25)';
    g.fillRect(x, y + WALL_H - 2, T, 2);
  } else if (theme === 'temple') {
    g.fillStyle = cover ? '#6b654e' : '#4f4b39';
    g.fillRect(x, y, T, WALL_H);
    g.fillStyle = 'rgba(30, 26, 16, 0.5)';
    g.fillRect(x + (cover ? 0 : T / 2), y, 1, WALL_H);
    if (!cover && rng() < 0.3) {
      // A vine hanging down the face.
      g.strokeStyle = '#4d7c2f';
      g.lineWidth = 2;
      g.beginPath();
      const vx = x + 6 + rng() * (T - 12);
      g.moveTo(vx, y);
      g.quadraticCurveTo(vx + 4, y + WALL_H / 2, vx - 2, y + WALL_H + 6);
      g.stroke();
    }
  } else {
    g.fillStyle = cover ? '#7c2d12' : '#353a45';
    g.fillRect(x, y, T, WALL_H);
    if (!cover && rng() < 0.25) {
      // A pipe along the wall.
      g.fillStyle = '#6b7280';
      g.fillRect(x, y + 3, T, 4);
      g.fillStyle = 'rgba(255, 255, 255, 0.2)';
      g.fillRect(x, y + 3, T, 1);
    }
  }
}

function top(
  g: CanvasRenderingContext2D, m: MazeMap, theme: MazeTheme, kind: number,
  tx: number, ty: number, x: number, y: number, rng: () => number,
): void {
  const cover = kind === TILE_KIND.COVER;
  // Which sides face open floor: that is where edges and trims go.
  const open = {
    n: floorAt(m, tx, ty - 1), s: floorAt(m, tx, ty + 1), w: floorAt(m, tx - 1, ty), e: floorAt(m, tx + 1, ty),
  };
  if (theme === 'neon') {
    g.fillStyle = cover ? '#1e1033' : '#0c1426';
    g.fillRect(x, y, T, T);
    g.save();
    const col = cover ? '#e879f9' : '#22d3ee';
    g.strokeStyle = col;
    g.shadowColor = col;
    g.shadowBlur = 10;
    g.lineWidth = 2;
    g.beginPath();
    if (open.n) { g.moveTo(x, y + 1); g.lineTo(x + T, y + 1); }
    if (open.s) { g.moveTo(x, y + T - 1); g.lineTo(x + T, y + T - 1); }
    if (open.w) { g.moveTo(x + 1, y); g.lineTo(x + 1, y + T); }
    if (open.e) { g.moveTo(x + T - 1, y); g.lineTo(x + T - 1, y + T); }
    g.stroke();
    if (cover) g.strokeRect(x + 6, y + 6, T - 12, T - 12);
    g.restore();
    return;
  }
  if (theme === 'temple') {
    if (cover) {
      // A broken column.
      g.fillStyle = '#9c9478';
      g.beginPath();
      g.arc(x + T / 2, y + T / 2, T / 2 - 2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(60, 54, 36, 0.6)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x + T / 2, y + T / 2, T / 2 - 7, 0, Math.PI * 2);
      g.stroke();
      return;
    }
    g.fillStyle = '#7d7a63';
    g.fillRect(x, y, T, T);
    g.strokeStyle = 'rgba(45, 42, 30, 0.6)';
    g.lineWidth = 1;
    // Two courses of stone blocks, offset.
    g.strokeRect(x + 0.5, y + 0.5, T - 1, T / 2);
    g.beginPath();
    g.moveTo(x + T / 2, y + 0.5);
    g.lineTo(x + T / 2, y + T / 2);
    g.moveTo(x + (ty % 2 ? T / 4 : (3 * T) / 4), y + T / 2);
    g.lineTo(x + (ty % 2 ? T / 4 : (3 * T) / 4), y + T);
    g.stroke();
    if (rng() < 0.35) {
      g.fillStyle = 'rgba(91, 122, 51, 0.7)';
      g.beginPath();
      g.arc(x + rng() * T, y + rng() * T, 3 + rng() * 6, 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  // Industrial.
  if (cover) {
    if (rng() < 0.3) {
      // A barrel.
      g.fillStyle = rng() < 0.5 ? '#b91c1c' : '#1d4ed8';
      g.beginPath();
      g.arc(x + T / 2, y + T / 2, T / 2 - 3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x + T / 2, y + T / 2, T / 2 - 8, 0, Math.PI * 2);
      g.stroke();
      return;
    }
    // A crate.
    g.fillStyle = '#b45309';
    g.fillRect(x + 1, y + 1, T - 2, T - 2);
    g.strokeStyle = '#78350f';
    g.lineWidth = 2.5;
    g.strokeRect(x + 2.5, y + 2.5, T - 5, T - 5);
    g.beginPath();
    g.moveTo(x + 3, y + 3);
    g.lineTo(x + T - 3, y + T - 3);
    g.moveTo(x + T - 3, y + 3);
    g.lineTo(x + 3, y + T - 3);
    g.stroke();
    return;
  }
  g.fillStyle = '#5b6270';
  g.fillRect(x, y, T, T);
  g.fillStyle = 'rgba(255, 255, 255, 0.06)';
  g.fillRect(x, y, T, T / 2);
  g.fillStyle = '#f97316';
  if (open.s) g.fillRect(x, y + T - 3, T, 3);
  if (open.n) g.fillRect(x, y, T, 2);
}

// --------------------------------------------------------------- mini map

export function buildMini(m: MazeMap, theme: MazeTheme, width: number): HTMLCanvasElement {
  const k = width / worldW(m);
  const [c, g] = canvas(width, Math.round(worldH(m) * k));
  const look = THEME_LOOK[theme].mini;
  g.fillStyle = look.bg;
  g.fillRect(0, 0, c.width, c.height);
  const t = T * k;
  for (let ty = 0; ty < m.h; ty++) {
    for (let tx = 0; tx < m.w; tx++) {
      const kind = mazeTileAt(m, tx, ty);
      if (kind === TILE_KIND.FLOOR) continue;
      g.fillStyle = kind === TILE_KIND.COVER ? look.cover : look.wall;
      g.globalAlpha = kind === TILE_KIND.COVER ? 0.8 : 0.55;
      g.fillRect(tx * t, ty * t, Math.ceil(t), Math.ceil(t));
    }
  }
  g.globalAlpha = 1;
  return c;
}
