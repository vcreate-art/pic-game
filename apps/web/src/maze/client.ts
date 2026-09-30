import {
  FIRE_EVERY, MAX_HP, MAZE_COLORS, MAZE_HZ, MAZE_TILE, MISSILE, MV, PF, PICKUP_R, PLAYER_R, POWER_AMOUNT,
  POWER_NAMES, SHOT, SPREAD, fromAim, generateMaze, powerOf, speedFor, toAim, walk, wallAt, worldH, worldW,
  type MazeEvent, type MazeFrame, type MazeInput, type MazeMap, type MazeRadar, type PowerKind,
} from '@pic-game/shared';
import { serverNow } from '../net/clock.js';
import { LOCK_KEEP, inSight, lockOrder, nextLock } from './lock.js';

const STEP_MS = 1000 / MAZE_HZ;
/** World pixels across the screen: wider screens see more, up to a point. */
const VIEW_WORLD_W = 1000;
const MINIMAP_W = 200;

/**
 * Two ways to play, chosen per player:
 *  - mouse: WASD or the arrows move, the mouse aims, click fires
 *  - keys: WASD moves and the arrows shoot, eight ways, twin-stick style;
 *    U (or Space) fires the way you are facing, I locks on, O lets go
 */
export type MazeControls = 'mouse' | 'keys';

const MOVE: Record<string, number> = { KeyW: MV.UP, KeyS: MV.DOWN, KeyA: MV.LEFT, KeyD: MV.RIGHT };
const ARROWS: Record<string, number> = { ArrowUp: MV.UP, ArrowDown: MV.DOWN, ArrowLeft: MV.LEFT, ArrowRight: MV.RIGHT };

/** The way a set of direction bits points, or null for none (or opposites). */
function dirOf(bits: number): number | null {
  const dx = (bits & MV.RIGHT ? 1 : 0) - (bits & MV.LEFT ? 1 : 0);
  const dy = (bits & MV.DOWN ? 1 : 0) - (bits & MV.UP ? 1 : 0);
  return dx || dy ? Math.atan2(dy, dx) : null;
}

export const POWER_COLORS: Record<PowerKind, string> = {
  speed: '#22d3ee', missile: '#f472b6', spread: '#fb923c', life: '#60a5fa',
};
const POWER_GLYPH: Record<PowerKind, string> = { speed: '»', missile: '◆', spread: '⁂', life: '+' };

export interface MazeMeta {
  seed: number;
  cols: number;
  rows: number;
  /** Seat of this client's player, or -1 when watching. */
  mySeat: number;
  names: string[];
  radar: MazeRadar;
  endsAt: number;
  live: boolean;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface FeedLine {
  text: string;
  color: string;
  at: number;
}

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/**
 * The match on this screen: input, prediction and drawing.
 *
 * Frames and events come straight from the socket and never touch React. The
 * component only mounts this, hands it a canvas and tells it who is who.
 */
export class MazeClient {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private ro: ResizeObserver | null = null;
  private raf = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;

  private meta: MazeMeta | null = null;
  private map: MazeMap | null = null;
  private mapKey = '';
  private floor: HTMLCanvasElement | null = null;
  private mini: HTMLCanvasElement | null = null;

  private prev: MazeFrame | null = null;
  private cur: MazeFrame | null = null;
  private curAt = 0;

  // Prediction for our own player.
  private seq = 0;
  private pending: MazeInput[] = [];
  private me = { x: 0, y: 0 };
  private mePrev = { x: 0, y: 0 };
  private meAt = 0;
  private acc = 0;
  private lastT = 0;
  private cooldown = 0;

  // Controls.
  private controls: MazeControls = 'mouse';
  private moveKeys = 0;
  private arrowKeys = 0;
  private fireKey = false;
  private mouseDown = false;
  private mouse = { x: 0, y: 0, in: false };
  private aim = 0;
  private send: ((i: MazeInput) => void) | null = null;

  private sparks: Spark[] = [];
  private feed: FeedLine[] = [];
  private flashes = new Map<number, number>();
  private hurtAt = 0;
  private toast: { text: string; at: number } | null = null;
  /** Keyboard only: the seat our aim is locked on to, if any. */
  private lock: number | null = null;
  /** A wall stands between us and the locked target: our shots will hit it. */
  private lockBlocked = false;
  private cam = { x: 0, y: 0 };

  // ------------------------------------------------------------ lifecycle

  attach(canvas: HTMLCanvasElement, send: (i: MazeInput) => void): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.send = send;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.release);
    canvas.addEventListener('mousemove', this.onMove);
    canvas.addEventListener('mousedown', this.onPress);
    window.addEventListener('mouseup', this.onRelease);
    canvas.addEventListener('mouseleave', this.onLeave);
    canvas.addEventListener('contextmenu', this.noMenu);
    this.lastT = performance.now();
    // Input runs on its own timer, not the animation frame: a tab that is not
    // being painted gets no animation frames, and its player would freeze
    // mid-stride on everyone else's screen instead of stopping cleanly.
    this.ticker = setInterval(() => this.pump(), STEP_MS / 2);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.ro?.disconnect();
    this.ro = null;
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.release);
    window.removeEventListener('mouseup', this.onRelease);
    this.canvas?.removeEventListener('mousemove', this.onMove);
    this.canvas?.removeEventListener('mousedown', this.onPress);
    this.canvas?.removeEventListener('mouseleave', this.onLeave);
    this.canvas?.removeEventListener('contextmenu', this.noMenu);
    this.canvas = null;
    this.ctx = null;
    this.send = null;
    this.release();
  }

  setMeta(meta: MazeMeta): void {
    const key = `${meta.seed}:${meta.cols}:${meta.rows}`;
    if (key !== this.mapKey) {
      this.mapKey = key;
      this.map = generateMaze(meta.seed, meta.cols, meta.rows);
      this.floor = this.mini = null;
      this.prev = this.cur = null;
      this.pending = [];
      this.sparks = [];
      this.feed = [];
    }
    this.meta = meta;
  }

  private resize(): void {
    const c = this.canvas;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
  }

  // ----------------------------------------------------------------- input

  setControls(c: MazeControls): void {
    this.controls = c;
    this.lock = null;
    this.release();
  }

  /**
   * Keyboard lock-on: the nearest enemy in sight, or, pressed again, the next
   * nearest after the one held. Behind walls counts only with Ghost missiles,
   * which go through them.
   */
  private cycleLock(): void {
    const m = this.meta;
    const f = this.cur;
    const map = this.map;
    if (!m || !f || !map || m.mySeat < 0) return;
    const through = powerOf(f.p[m.mySeat]?.[7] ?? 0) === 'missile';
    this.lock = nextLock(lockOrder(map, f, m.mySeat, this.me, through), this.lock);
    if (this.lock === null) this.toast = { text: 'Nobody in sight to lock on to', at: performance.now() };
  }

  /** Drops a lock whose target has died, left, or got too far away. */
  private checkLock(): void {
    const p = this.lock === null ? null : this.cur?.p[this.lock];
    this.lockBlocked = false;
    if (!p) return;
    if (!(p[4] & PF.ALIVE) || p[4] & PF.AWAY || Math.hypot(p[0] - this.me.x, p[1] - this.me.y) > LOCK_KEEP) {
      this.lock = null;
      return;
    }
    // The lock holds through cover, but says so: Ghost missiles aside, shots
    // at someone round a corner only hit the wall.
    const through = powerOf(this.cur?.p[this.meta?.mySeat ?? -1]?.[7] ?? 0) === 'missile';
    this.lockBlocked = !!this.map && !through && !inSight(this.map, this.me.x, this.me.y, p[0], p[1]);
  }

  private onDown = (e: KeyboardEvent) => {
    if (typing(e.target)) return;
    const move = MOVE[e.code];
    const arrow = ARROWS[e.code];
    if (move) this.moveKeys |= move;
    if (arrow) this.arrowKeys |= arrow;
    const keysOnly = this.controls === 'keys';
    if (e.code === 'Space' || (keysOnly && e.code === 'KeyU')) this.fireKey = true;
    if (keysOnly && e.code === 'KeyI' && !e.repeat) this.cycleLock();
    if (keysOnly && e.code === 'KeyO') this.lock = null;
    if (move || arrow || e.code === 'Space' || (keysOnly && ['KeyU', 'KeyI', 'KeyO'].includes(e.code))) e.preventDefault();
  };

  private onUp = (e: KeyboardEvent) => {
    const move = MOVE[e.code];
    const arrow = ARROWS[e.code];
    if (move) this.moveKeys &= ~move;
    if (arrow) this.arrowKeys &= ~arrow;
    if (e.code === 'Space' || e.code === 'KeyU') this.fireKey = false;
  };

  private release = () => {
    this.moveKeys = 0;
    this.arrowKeys = 0;
    this.fireKey = false;
    this.mouseDown = false;
  };

  /** Movement bits: with the mouse aiming, the arrows move too. */
  private get keys(): number {
    return this.controls === 'keys' ? this.moveKeys : this.moveKeys | this.arrowKeys;
  }

  private get firing(): boolean {
    return this.controls === 'keys' ? this.arrowKeys !== 0 || this.fireKey : this.mouseDown || this.fireKey;
  }

  private onMove = (e: MouseEvent) => {
    const r = this.canvas!.getBoundingClientRect();
    this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top, in: true };
  };

  private onPress = (e: MouseEvent) => {
    if (e.button !== 0 || this.controls !== 'mouse') return;
    this.mouseDown = true;
    this.onMove(e);
    e.preventDefault();
  };

  private onRelease = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
  };

  private onLeave = () => {
    this.mouse.in = false;
  };

  private noMenu = (e: Event) => e.preventDefault();

  // ------------------------------------------------------------ from server

  pushFrame(f: MazeFrame): void {
    if (this.cur && f.t <= this.cur.t) {
      // Merely late: drop it. Far older: a new match the reset missed.
      if (this.cur.t - f.t < 90) return;
      this.prev = this.cur = null;
    }
    this.prev = this.cur;
    this.cur = f;
    this.curAt = performance.now();
    this.reconcile(f);
    // A bullet seen for the first time is a shot: a flash at the muzzle.
    const before = new Set(this.prev?.b.map((b) => b[0]));
    for (const b of f.b) if (!before.has(b[0])) this.flashes.set(b[3], performance.now());
    // One that vanished hit something: a wall, if no hit event says otherwise.
    const now = new Set(f.b.map((b) => b[0]));
    for (const b of this.prev?.b ?? []) {
      if (!now.has(b[0])) this.burst(b[1], b[2], 4, MAZE_COLORS[b[3] % MAZE_COLORS.length]!, 60, 0.25);
    }
  }

  pushEvents(events: MazeEvent[]): void {
    if (document.hidden) return;
    const m = this.meta;
    const name = (s: number) => (s === m?.mySeat ? 'You' : m?.names[s] ?? 'Someone');
    const line = (text: string, color: string) => {
      this.feed.unshift({ text, color, at: performance.now() });
      this.feed.length = Math.min(this.feed.length, 5);
    };
    for (const e of events) {
      if (e.k === 'hit') {
        this.burst(e.x, e.y, 10, '#fecaca', 140, 0.35);
        if (e.v === m?.mySeat) this.hurtAt = performance.now();
      } else if (e.k === 'kill') {
        const f = this.cur?.p[e.v];
        if (f) this.burst(f[0], f[1], 34, MAZE_COLORS[e.v % MAZE_COLORS.length]!, 220, 0.8);
        this.feed.unshift({
          text: e.by === e.v ? `${name(e.v)} went down` : `${name(e.by)} ✦ ${name(e.v)}`,
          color: MAZE_COLORS[e.by % MAZE_COLORS.length]!,
          at: performance.now(),
        });
        this.feed.length = Math.min(this.feed.length, 5);
      } else if (e.k === 'spawn') {
        this.burst(e.x, e.y, 18, '#e0f2fe', 120, 0.5);
      } else if (e.k === 'pick') {
        const kind = powerOf(e.p);
        if (!kind) continue;
        this.burst(e.x, e.y, 22, POWER_COLORS[kind], 160, 0.5);
        line(`${name(e.s)} took ${POWER_NAMES[kind]}`, POWER_COLORS[kind]);
      } else if (e.k === 'swap') {
        line(`${name(e.a)} ⇄ ${name(e.b)}: power-ups swapped`, '#e2e8f0');
      } else if (e.k === 'shuffle') {
        this.toast = { text: 'Power-ups shuffled!', at: performance.now() };
        line("Everyone's power-ups shuffled", '#fde68a');
      }
    }
  }

  /** The server's word on our position, with our unanswered inputs replayed
   *  on top, so what we see is where we will be once it catches up. */
  private reconcile(f: MazeFrame): void {
    const seat = this.meta?.mySeat ?? -1;
    const p = f.p[seat];
    if (!p || !this.map) return;
    const ack = p[5];
    this.pending = this.pending.filter((i) => i.seq > ack);
    const pos = { x: p[0], y: p[1] };
    const speed = speedFor(powerOf(p[7]));
    if (p[4] & PF.ALIVE) for (const i of this.pending) walk(this.map, pos, i.keys, speed);
    // Small differences are the usual drift of float maths; large ones (a
    // respawn, a correction) are taken at once rather than slid across.
    const off = Math.hypot(pos.x - this.me.x, pos.y - this.me.y);
    if (off > 0.01) {
      this.me = pos;
      if (off > 40) this.mePrev = { ...pos };
    }
  }

  // ------------------------------------------------------------ the tick

  /** Runs as many of our ticks as are due. */
  private pump(): void {
    const t = performance.now();
    this.acc += Math.min(250, t - this.lastT);
    this.lastT = t;
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      this.localTick();
    }
  }

  private lastDraw = 0;

  private frame(): void {
    const t = performance.now();
    const dt = Math.min(100, t - (this.lastDraw || t));
    this.lastDraw = t;
    for (const s of this.sparks) {
      s.x += s.vx * (dt / 1000);
      s.y += s.vy * (dt / 1000);
      s.vx *= 0.9;
      s.vy *= 0.9;
      s.life -= dt / 1000;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    this.draw();
  }

  /** One of our ticks: read the controls, send them, and move ourselves. */
  private localTick(): void {
    const m = this.meta;
    const map = this.map;
    const me = m && this.cur?.p[m.mySeat];
    if (!m || !map || !m.live || m.mySeat < 0 || !me || !this.send) return;
    this.checkLock();
    const locked = this.lock === null ? null : this.cur?.p[this.lock];
    // Keyboard: the arrows win while held; then a lock-on; then the way we walk.
    this.aim = this.controls === 'keys'
      ? dirOf(this.arrowKeys) ?? (locked ? Math.atan2(locked[1] - this.me.y, locked[0] - this.me.x) : null) ?? dirOf(this.moveKeys) ?? this.aim
      : this.aimAt();
    const alive = (me[4] & PF.ALIVE) !== 0 && (me[4] & PF.AWAY) === 0;
    const input: MazeInput = { seq: ++this.seq, keys: alive ? this.keys : 0, aim: toAim(this.aim), fire: alive && this.firing };
    this.send(input);
    this.pending.push(input);
    if (this.pending.length > 90) this.pending.shift();
    this.mePrev = { ...this.me };
    this.meAt = performance.now();
    const power = powerOf(me[7]);
    if (alive) walk(map, this.me, input.keys, speedFor(power));
    if (this.cooldown > 0) this.cooldown--;
    if (input.fire && this.cooldown <= 0) {
      this.cooldown = power === 'missile' ? MISSILE.every : power === 'spread' ? SPREAD.every : FIRE_EVERY;
      this.flashes.set(m.mySeat, performance.now());
    }
  }

  /** From our player to the mouse, in world terms. */
  private aimAt(): number {
    const c = this.canvas;
    if (!c || !this.mouse.in) return this.aim;
    const { scale } = this.viewport();
    const sx = (this.me.x - this.cam.x) * scale + c.clientWidth / 2;
    const sy = (this.me.y - this.cam.y) * scale + c.clientHeight / 2;
    return Math.atan2(this.mouse.y - sy, this.mouse.x - sx);
  }

  private viewport(): { scale: number; w: number; h: number } {
    const c = this.canvas!;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const scale = Math.max(0.55, Math.min(1.35, w / VIEW_WORLD_W));
    return { scale, w, h };
  }

  private burst(x: number, y: number, n: number, color: string, speed: number, life: number): void {
    if (this.sparks.length > 500) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.5 + Math.random() * 0.5), max: life, color, size: 1.5 + Math.random() * 2.5 });
    }
  }

  // ----------------------------------------------------------------- draw

  /** The maze drawn once: floor, walls with a lit top edge, and a faint grid. */
  private buildFloor(map: MazeMap): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = worldW(map);
    c.height = worldH(map);
    const g = c.getContext('2d')!;
    g.fillStyle = '#131a24';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    g.lineWidth = 1;
    for (let x = 0; x <= map.w; x++) {
      g.beginPath();
      g.moveTo(x * MAZE_TILE + 0.5, 0);
      g.lineTo(x * MAZE_TILE + 0.5, c.height);
      g.stroke();
    }
    for (let y = 0; y <= map.h; y++) {
      g.beginPath();
      g.moveTo(0, y * MAZE_TILE + 0.5);
      g.lineTo(c.width, y * MAZE_TILE + 0.5);
      g.stroke();
    }
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        if (!wallAt(map, tx, ty)) continue;
        const x = tx * MAZE_TILE;
        const y = ty * MAZE_TILE;
        g.fillStyle = '#334155';
        g.fillRect(x, y, MAZE_TILE, MAZE_TILE);
        // Lit edges where the wall meets open floor, for a raised look.
        g.fillStyle = '#64748b';
        if (!wallAt(map, tx, ty - 1)) g.fillRect(x, y, MAZE_TILE, 4);
        if (!wallAt(map, tx - 1, ty)) g.fillRect(x, y, 3, MAZE_TILE);
        g.fillStyle = '#1e293b';
        if (!wallAt(map, tx, ty + 1)) g.fillRect(x, y + MAZE_TILE - 5, MAZE_TILE, 5);
        if (!wallAt(map, tx + 1, ty)) g.fillRect(x + MAZE_TILE - 3, y, 3, MAZE_TILE);
      }
    }
    return c;
  }

  private buildMini(map: MazeMap): HTMLCanvasElement {
    const k = MINIMAP_W / worldW(map);
    const c = document.createElement('canvas');
    c.width = MINIMAP_W;
    c.height = Math.round(worldH(map) * k);
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(15, 23, 42, 0.85)';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#475569';
    const t = MAZE_TILE * k;
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) if (wallAt(map, tx, ty)) g.fillRect(tx * t, ty * t, Math.ceil(t), Math.ceil(t));
    }
    return c;
  }

  private draw(): void {
    const c = this.canvas;
    const g = this.ctx;
    const m = this.meta;
    const map = this.map;
    if (!c || !g) return;
    const dpr = c.width / Math.max(1, c.clientWidth);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { scale, w, h } = this.viewport();
    g.fillStyle = '#0b1018';
    g.fillRect(0, 0, w, h);
    if (!m || !map || !this.cur) {
      g.fillStyle = '#94a3b8';
      g.font = '600 16px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('Entering the maze…', w / 2, h / 2);
      return;
    }
    this.floor ??= this.buildFloor(map);
    this.mini ??= this.buildMini(map);

    const now = performance.now();
    const alpha = Math.min(1, (now - this.curAt) / STEP_MS);
    const prev = this.prev ?? this.cur;
    const cur = this.cur;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const mine = m.mySeat >= 0 ? cur.p[m.mySeat] : undefined;
    const meAlive = !!mine && (mine[4] & PF.ALIVE) !== 0;

    // Our own player from prediction, smoothed between our ticks.
    const k = Math.min(1, (now - this.meAt) / STEP_MS);
    const me = { x: lerp(this.mePrev.x, this.me.x, k), y: lerp(this.mePrev.y, this.me.y, k) };
    const focus = mine ? (meAlive ? me : { x: mine[0], y: mine[1] }) : { x: worldW(map) / 2, y: worldH(map) / 2 };
    // Always centred on the player, even at the edge of the maze: held back at
    // the border, a player in a corner would slide under the mini map.
    this.cam = { x: focus.x, y: focus.y };

    g.save();
    g.translate(w / 2, h / 2);
    g.scale(scale, scale);
    g.translate(-this.cam.x, -this.cam.y);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.floor, 0, 0);

    // Pickups: a glowing token that bobs, with its power's mark.
    for (const u of cur.u ?? []) {
      const kind = powerOf(u[1]);
      if (kind) this.drawPickup(g, kind, u[2], u[3] + Math.sin(now / 300 + u[0]) * 2.5, now);
    }

    // Bullets: a bright streak from where each was a moment ago. Missiles are
    // fat and trail; pellets are small.
    const was = new Map(prev.b.map((b) => [b[0], b]));
    g.lineCap = 'round';
    for (const b of cur.b) {
      const p = was.get(b[0]) ?? b;
      const x = lerp(p[1], b[1], alpha);
      const y = lerp(p[2], b[2], alpha);
      const shot = b[4] ?? SHOT.BULLET;
      const col = shot === SHOT.MISSILE ? POWER_COLORS.missile : MAZE_COLORS[b[3] % MAZE_COLORS.length]!;
      const tail = shot === SHOT.MISSILE ? 1.4 : shot === SHOT.PELLET ? 0.35 : 0.6;
      g.strokeStyle = col;
      g.lineWidth = shot === SHOT.MISSILE ? 6 : shot === SHOT.PELLET ? 2.5 : 3;
      g.shadowColor = col;
      g.shadowBlur = shot === SHOT.MISSILE ? 18 : 10;
      g.beginPath();
      g.moveTo(x - (b[1] - p[1]) * tail, y - (b[2] - p[2]) * tail);
      g.lineTo(x, y);
      g.stroke();
      if (shot === SHOT.MISSILE) {
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(x, y, 3.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.shadowBlur = 0;

    // Players.
    cur.p.forEach((pl, seat) => {
      const flags = pl[4];
      if (!(flags & PF.ALIVE) || flags & PF.AWAY) return;
      const pp = prev.p[seat] ?? pl;
      const isMe = seat === m.mySeat;
      const x = isMe ? me.x : lerp(pp[0], pl[0], alpha);
      const y = isMe ? me.y : lerp(pp[1], pl[1], alpha);
      const a = isMe && m.live ? this.aim : fromAim(pl[2]);
      const power = powerOf(pl[7] ?? 0);
      this.drawPlayer(g, x, y, a, seat, pl[3], (flags & PF.SAFE) !== 0, isMe, now, power);
      if (seat === this.lock && this.controls === 'keys') this.drawLock(g, x, y, now);
      // Keyboard aiming has no cursor, so show the way we face.
      if (isMe && m.live && this.controls === 'keys') {
        g.strokeStyle = this.lock !== null && this.lockBlocked ? 'rgba(248, 113, 113, 0.8)' : 'rgba(248, 250, 252, 0.35)';
        g.setLineDash([4, 6]);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x + Math.cos(a) * (PLAYER_R + 14), y + Math.sin(a) * (PLAYER_R + 14));
        g.lineTo(x + Math.cos(a) * 120, y + Math.sin(a) * 120);
        g.stroke();
        g.setLineDash([]);
      }
    });

    for (const s of this.sparks) {
      g.globalAlpha = Math.max(0, s.life / s.max);
      g.fillStyle = s.color;
      g.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    g.globalAlpha = 1;
    g.restore();

    this.drawHud(g, w, h, cur, now, meAlive);
  }

  /** Four brackets turning round a locked-on target. */
  private drawLock(g: CanvasRenderingContext2D, x: number, y: number, now: number): void {
    const r = PLAYER_R + 12;
    g.save();
    g.translate(x, y);
    g.rotate(now / 600);
    g.strokeStyle = '#f87171';
    g.lineWidth = 3;
    g.shadowColor = '#ef4444';
    g.shadowBlur = 8;
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.moveTo(r, -7);
      g.lineTo(r, -r + 4);
      g.lineTo(7, -r);
      g.stroke();
    }
    g.restore();
  }

  private drawPickup(g: CanvasRenderingContext2D, kind: PowerKind, x: number, y: number, now: number): void {
    const col = POWER_COLORS[kind];
    const pulse = 1 + Math.sin(now / 200) * 0.12;
    g.shadowColor = col;
    g.shadowBlur = 16;
    g.fillStyle = 'rgba(15, 23, 42, 0.85)';
    g.beginPath();
    g.arc(x, y, PICKUP_R * pulse, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = col;
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = col;
    g.font = '900 16px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(POWER_GLYPH[kind], x, y + 1);
    g.textBaseline = 'alphabetic';
  }

  private drawPlayer(
    g: CanvasRenderingContext2D, x: number, y: number, a: number, seat: number, hp: number,
    safe: boolean, isMe: boolean, now: number, power: PowerKind | null,
  ): void {
    const col = MAZE_COLORS[seat % MAZE_COLORS.length]!;
    // Holding a power: a glow in its colour. Double life: a shield bubble.
    if (power) {
      const pc = POWER_COLORS[power];
      g.save();
      g.shadowColor = pc;
      g.shadowBlur = 14;
      g.strokeStyle = pc;
      g.lineWidth = power === 'life' ? 3 : 2;
      g.globalAlpha = power === 'life' ? 0.9 : 0.55 + Math.sin(now / 150) * 0.25;
      g.beginPath();
      g.arc(x, y, PLAYER_R + (power === 'life' ? 7 : 4), 0, Math.PI * 2);
      g.stroke();
      if (power === 'speed') {
        // Speed lines behind, against the way we face.
        g.lineWidth = 2;
        for (const off of [-6, 0, 6]) {
          g.beginPath();
          g.moveTo(x - Math.cos(a) * (PLAYER_R + 6) - Math.sin(a) * off, y - Math.sin(a) * (PLAYER_R + 6) + Math.cos(a) * off);
          g.lineTo(x - Math.cos(a) * (PLAYER_R + 16) - Math.sin(a) * off, y - Math.sin(a) * (PLAYER_R + 16) + Math.cos(a) * off);
          g.stroke();
        }
      }
      g.restore();
    }
    if (safe && Math.floor(now / 120) % 2) g.globalAlpha = 0.45;
    // Gun first, under the body.
    g.save();
    g.translate(x, y);
    g.rotate(a);
    // A wider barrel for the spread shot, a pink one for missiles.
    const wide = power === 'spread' ? 2.5 : 0;
    g.fillStyle = '#0f172a';
    g.fillRect(PLAYER_R - 4, -3.5 - wide, 14, 7 + wide * 2);
    g.fillStyle = power === 'missile' ? POWER_COLORS.missile : power === 'spread' ? POWER_COLORS.spread : '#cbd5e1';
    g.fillRect(PLAYER_R - 3, -2.5 - wide, 12, 5 + wide * 2);
    const flash = this.flashes.get(seat);
    if (flash && now - flash < 70) {
      g.fillStyle = '#fef08a';
      g.beginPath();
      g.arc(PLAYER_R + 12, 0, 6, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    g.beginPath();
    g.arc(x, y, PLAYER_R, 0, Math.PI * 2);
    g.fillStyle = col;
    g.fill();
    g.lineWidth = isMe ? 3 : 2;
    g.strokeStyle = isMe ? '#ffffff' : '#0f172a';
    g.stroke();
    // A lighter cap, for a little depth.
    g.beginPath();
    g.arc(x - 3, y - 3, PLAYER_R * 0.45, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 255, 255, 0.28)';
    g.fill();
    if (safe) {
      g.beginPath();
      g.arc(x, y, PLAYER_R + 6, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(224, 242, 254, 0.8)';
      g.lineWidth = 2;
      g.stroke();
    }
    g.globalAlpha = 1;
    // Name, and health once it is not full.
    const name = isMe ? 'You' : this.meta?.names[seat] ?? '';
    g.font = '700 11px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(15, 23, 42, 0.8)';
    g.fillText(name, x + 1, y - PLAYER_R - 9);
    g.fillStyle = '#f1f5f9';
    g.fillText(name, x, y - PLAYER_R - 10);
    if (hp < MAX_HP) {
      g.fillStyle = 'rgba(15, 23, 42, 0.8)';
      g.fillRect(x - 16, y + PLAYER_R + 6, 32, 5);
      g.fillStyle = hp > 40 ? '#4ade80' : '#f87171';
      g.fillRect(x - 16, y + PLAYER_R + 6, 32 * (hp / MAX_HP), 5);
    }
  }

  private drawHud(g: CanvasRenderingContext2D, w: number, h: number, f: MazeFrame, now: number, meAlive: boolean): void {
    const m = this.meta!;
    const map = this.map!;
    // A red edge when hit.
    const hurt = 1 - (now - this.hurtAt) / 400;
    if (hurt > 0) {
      const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
      grad.addColorStop(0, 'rgba(239, 68, 68, 0)');
      grad.addColorStop(1, `rgba(239, 68, 68, ${0.45 * hurt})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }

    // The mini map, top right: walls, everyone the radar allows, and our view.
    const mini = this.mini!;
    const mk = MINIMAP_W / worldW(map);
    const mx = w - MINIMAP_W - 12;
    const my = 12;
    g.drawImage(mini, mx, my);
    g.strokeStyle = 'rgba(148, 163, 184, 0.6)';
    g.lineWidth = 1;
    g.strokeRect(mx + 0.5, my + 0.5, mini.width - 1, mini.height - 1);
    const { scale } = this.viewport();
    // Our view, kept inside the mini map: at the maze's edge it reaches past it.
    g.save();
    g.beginPath();
    g.rect(mx, my, mini.width, mini.height);
    g.clip();
    g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    g.strokeRect(
      mx + (this.cam.x - w / 2 / scale) * mk, my + (this.cam.y - h / 2 / scale) * mk,
      (w / scale) * mk, (h / scale) * mk,
    );
    g.restore();
    for (const u of f.u ?? []) {
      const kind = powerOf(u[1]);
      if (!kind) continue;
      const x = mx + u[2] * mk;
      const y = my + u[3] * mk;
      g.fillStyle = POWER_COLORS[kind];
      g.beginPath();
      g.moveTo(x, y - 4);
      g.lineTo(x + 4, y);
      g.lineTo(x, y + 4);
      g.lineTo(x - 4, y);
      g.closePath();
      g.fill();
    }
    f.p.forEach((p, seat) => {
      const flags = p[4];
      if (!(flags & PF.ALIVE) || flags & PF.AWAY) return;
      const isMe = seat === m.mySeat;
      if (!isMe && m.radar === 'firing' && !(flags & PF.RADAR) && m.mySeat >= 0) return;
      const x = mx + (isMe ? this.me.x : p[0]) * mk;
      const y = my + (isMe ? this.me.y : p[1]) * mk;
      g.beginPath();
      g.arc(x, y, isMe ? 4 : 3.2, 0, Math.PI * 2);
      g.fillStyle = MAZE_COLORS[seat % MAZE_COLORS.length]!;
      g.fill();
      if (isMe) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.stroke();
      }
    });

    // Kill feed, under the mini map.
    g.textAlign = 'right';
    g.font = '700 13px Inter, system-ui, sans-serif';
    this.feed = this.feed.filter((l) => now - l.at < 6000);
    this.feed.forEach((l, i) => {
      const y = my + mini.height + 22 + i * 20;
      g.globalAlpha = Math.min(1, (6000 - (now - l.at)) / 800);
      g.fillStyle = 'rgba(15, 23, 42, 0.7)';
      const tw = g.measureText(l.text).width;
      g.fillRect(w - 12 - tw - 12, y - 14, tw + 12, 19);
      g.fillStyle = l.color;
      g.fillText(l.text, w - 18, y);
    });
    g.globalAlpha = 1;

    // The clock, top middle.
    const left = Math.max(0, m.endsAt - serverNow());
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000);
    g.textAlign = 'center';
    g.font = '800 20px "Baloo 2", system-ui, sans-serif';
    g.fillStyle = left < 30000 ? '#f87171' : '#e2e8f0';
    g.fillText(`${mm}:${String(ss).padStart(2, '0')}`, w / 2, 30);
    if (this.toast && now - this.toast.at < 2500) {
      const k = Math.min(1, (2500 - (now - this.toast.at)) / 500);
      g.globalAlpha = k;
      g.font = '800 26px "Baloo 2", system-ui, sans-serif';
      g.fillStyle = '#fde68a';
      g.fillText(this.toast.text, w / 2, 70);
      g.globalAlpha = 1;
    }

    const mine = m.mySeat >= 0 ? f.p[m.mySeat] : null;
    if (!mine) {
      g.font = '700 14px Inter, system-ui, sans-serif';
      g.fillStyle = '#94a3b8';
      g.fillText('Watching', w / 2, h - 20);
      return;
    }

    // Our health, bottom left.
    const hp = mine[3];
    g.fillStyle = 'rgba(15, 23, 42, 0.8)';
    g.fillRect(14, h - 36, 204, 22);
    g.fillStyle = hp > 40 ? '#4ade80' : '#f87171';
    g.fillRect(16, h - 34, 200 * (hp / MAX_HP), 18);
    const power = powerOf(mine[7] ?? 0);
    const store = mine[8] ?? 0;
    if (power === 'life') {
      // The shield, as a blue bar over the health.
      g.fillStyle = POWER_COLORS.life;
      g.fillRect(16, h - 34, 200 * (store / POWER_AMOUNT.life), 7);
    }
    g.fillStyle = '#0f172a';
    g.textAlign = 'left';
    g.font = '800 13px Inter, system-ui, sans-serif';
    g.fillText(power === 'life' ? `${hp} HP + ${store} shield` : `${hp} HP`, 22, h - 20);
    if (power) {
      const col = POWER_COLORS[power];
      const detail = power === 'speed' ? `${Math.ceil(store / MAZE_HZ)}s`
        : power === 'missile' || power === 'spread' ? `${store} left` : '';
      const label = `${POWER_GLYPH[power]}  ${POWER_NAMES[power]}${detail ? ` · ${detail}` : ''}`;
      g.font = '800 14px Inter, system-ui, sans-serif';
      const tw = g.measureText(label).width;
      g.fillStyle = 'rgba(15, 23, 42, 0.85)';
      g.fillRect(14, h - 66, tw + 20, 24);
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.strokeRect(14, h - 66, tw + 20, 24);
      g.fillStyle = col;
      g.fillText(label, 24, h - 49);
    }

    if (!meAlive && !(mine[4] & PF.AWAY)) {
      g.fillStyle = 'rgba(11, 16, 24, 0.55)';
      g.fillRect(0, h / 2 - 50, w, 90);
      g.textAlign = 'center';
      g.fillStyle = '#f8fafc';
      g.font = '800 30px "Baloo 2", system-ui, sans-serif';
      g.fillText('You were taken out', w / 2, h / 2 - 8);
      g.font = '600 15px Inter, system-ui, sans-serif';
      g.fillStyle = '#cbd5e1';
      g.fillText(`Back in ${Math.ceil(mine[6] / MAZE_HZ)}…`, w / 2, h / 2 + 20);
    }

    // Keyboard only: the lock keys, as a reminder.
    if (m.live && this.controls === 'keys') {
      g.textAlign = 'right';
      g.font = '700 12px Inter, system-ui, sans-serif';
      g.fillStyle = this.lock === null ? 'rgba(203, 213, 225, 0.75)' : '#fca5a5';
      g.fillText(
        this.lock === null
          ? 'U fire  ·  I lock on'
          : `Locked: ${m.names[this.lock] ?? ''}${this.lockBlocked ? ' (blocked)' : ''}  ·  U fire  ·  I next  ·  O let go`,
        w - 16, h - 18,
      );
    }

    // A crosshair where the mouse is.
    if (this.mouse.in && m.live && this.controls === 'mouse') {
      const { x, y } = this.mouse;
      g.strokeStyle = meAlive ? '#f8fafc' : 'rgba(248, 250, 252, 0.3)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.moveTo(x - 15, y); g.lineTo(x - 5, y);
      g.moveTo(x + 5, y); g.lineTo(x + 15, y);
      g.moveTo(x, y - 15); g.lineTo(x, y - 5);
      g.moveTo(x, y + 5); g.lineTo(x, y + 15);
      g.stroke();
    }
  }
}

let client: MazeClient | null = null;

/** One per tab, like the fight view: socket bindings feed it whether or not
 *  the stage is mounted. */
export function getMazeClient(): MazeClient {
  if (!client) client = new MazeClient();
  return client;
}
