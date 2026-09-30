import {
  FIRE_EVERY, MAX_HP, MAZE_COLORS, MAZE_HZ, MISSILE, MV, PF, PICKUP_R, PLAYER_R, POWER_AMOUNT, POWER_NAMES, SHOT,
  fromAim, generateMaze, powerOf, speedFor, toAim, unpackItems, walk, worldH, worldW,
  type ItemKind, type MazeEvent, type MazeFrame, type MazeFramePlayer, type MazeInput, type MazeMap, type MazeRadar,
  type MazeTheme, type PowerKind,
} from '@pic-game/shared';
import { serverNow } from '../net/clock.js';
import { THEME_LOOK, buildFloor, buildMini, buildWalls } from './art.js';
import { visibility, type Light } from './light.js';
import { LOCK_KEEP, inSight, lockOrder, nextLock } from './lock.js';

const STEP_MS = 1000 / MAZE_HZ;
/** World pixels across the screen: wider screens see more, up to a point. */
const VIEW_WORLD_W = 1000;
const MINIMAP_W = 200;
/** How far you can see with fog on. */
const FOG_RANGE = 760;

/**
 * Two ways to play, chosen per player:
 *  - mouse: WASD or the arrows move, the mouse aims; left click (or Space)
 *    fires the gun, right click (or E) uses the top power-up
 *  - keys: WASD moves and the arrows shoot, eight ways, twin-stick style;
 *    U (or Space) fires the way you face, J uses the top power-up, I locks
 *    on and O lets go
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
  speed: '#22d3ee', missile: '#f472b6', spread: '#fb923c', shield: '#60a5fa',
};
const POWER_GLYPH: Record<PowerKind, string> = { speed: '»', missile: '◆', spread: '⁂', shield: '◉' };

export interface MazeMeta {
  seed: number;
  cols: number;
  rows: number;
  theme: MazeTheme;
  fog: boolean;
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

/** The item on top of a player's stack, from a frame. */
const topItem = (p: MazeFramePlayer | undefined): ItemKind | null => (p ? unpackItems(p[7])[0] ?? null : null);

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
  private walls: HTMLCanvasElement | null = null;
  private mini: HTMLCanvasElement | null = null;
  /** Screen-sized scratch canvases for the dark and the fog. */
  private dark: HTMLCanvasElement | null = null;
  private fogLayer: HTMLCanvasElement | null = null;

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
  private altKey = false;
  private mouseDown = false;
  private rightDown = false;
  private mouse = { x: 0, y: 0, in: false };
  private aim = 0;
  private send: ((i: MazeInput) => void) | null = null;

  private sparks: Spark[] = [];
  private feed: FeedLine[] = [];
  private flashes = new Map<number, number>();
  private hurtAt = 0;
  private shakeAt = 0;
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
    const key = `${meta.seed}:${meta.cols}:${meta.rows}:${meta.theme}`;
    if (key !== this.mapKey) {
      this.mapKey = key;
      this.map = generateMaze(meta.seed, meta.cols, meta.rows);
      this.floor = this.walls = this.mini = null;
      this.prev = this.cur = null;
      this.pending = [];
      this.sparks = [];
      this.feed = [];
      this.lock = null;
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
   * nearest after the one held. Behind walls counts only with Ghost missiles
   * on top of the stack, since they go through them.
   */
  private cycleLock(): void {
    const m = this.meta;
    const f = this.cur;
    const map = this.map;
    if (!m || !f || !map || m.mySeat < 0) return;
    const through = topItem(f.p[m.mySeat]) === 'missile';
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
    const through = topItem(this.cur?.p[this.meta?.mySeat ?? -1]) === 'missile';
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
    if (e.code === (keysOnly ? 'KeyJ' : 'KeyE')) this.altKey = true;
    if (keysOnly && e.code === 'KeyI' && !e.repeat) this.cycleLock();
    if (keysOnly && e.code === 'KeyO') this.lock = null;
    const ours = keysOnly ? ['Space', 'KeyU', 'KeyJ', 'KeyI', 'KeyO'] : ['Space', 'KeyE'];
    if (move || arrow || ours.includes(e.code)) e.preventDefault();
  };

  private onUp = (e: KeyboardEvent) => {
    const move = MOVE[e.code];
    const arrow = ARROWS[e.code];
    if (move) this.moveKeys &= ~move;
    if (arrow) this.arrowKeys &= ~arrow;
    if (e.code === 'Space' || e.code === 'KeyU') this.fireKey = false;
    if (e.code === 'KeyJ' || e.code === 'KeyE') this.altKey = false;
  };

  private release = () => {
    this.moveKeys = 0;
    this.arrowKeys = 0;
    this.fireKey = false;
    this.altKey = false;
    this.mouseDown = false;
    this.rightDown = false;
  };

  /** Movement bits: with the mouse aiming, the arrows move too. */
  private get keys(): number {
    return this.controls === 'keys' ? this.moveKeys : this.moveKeys | this.arrowKeys;
  }

  private get firing(): boolean {
    return this.controls === 'keys' ? this.arrowKeys !== 0 || this.fireKey : this.mouseDown || this.fireKey;
  }

  private get usingItem(): boolean {
    return this.altKey || (this.controls === 'mouse' && this.rightDown);
  }

  private onMove = (e: MouseEvent) => {
    const r = this.canvas!.getBoundingClientRect();
    this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top, in: true };
  };

  private onPress = (e: MouseEvent) => {
    if (this.controls !== 'mouse') return;
    if (e.button === 0) this.mouseDown = true;
    else if (e.button === 2) this.rightDown = true;
    else return;
    this.onMove(e);
    e.preventDefault();
  };

  private onRelease = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2) this.rightDown = false;
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
    const now = performance.now();
    const name = (s: number) => (s === m?.mySeat ? 'You' : m?.names[s] ?? 'Someone');
    const line = (text: string, color: string) => {
      this.feed.unshift({ text, color, at: now });
      this.feed.length = Math.min(this.feed.length, 5);
    };
    for (const e of events) {
      if (e.k === 'hit') {
        this.burst(e.x, e.y, 10, '#fecaca', 140, 0.35);
        if (e.v === m?.mySeat) this.hurtAt = now;
      } else if (e.k === 'kill') {
        const f = this.cur?.p[e.v];
        if (f) this.burst(f[0], f[1], 34, MAZE_COLORS[e.v % MAZE_COLORS.length]!, 220, 0.8);
        if (e.v === m?.mySeat || e.by === m?.mySeat) this.shakeAt = now;
        line(e.by === e.v ? `${name(e.v)} went down` : `${name(e.by)} ✦ ${name(e.v)}`, MAZE_COLORS[e.by % MAZE_COLORS.length]!);
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
        this.toast = { text: 'Power-ups shuffled!', at: now };
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
    const speed = speedFor(p[10] > 0);
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
    const input: MazeInput = {
      seq: ++this.seq, keys: alive ? this.keys : 0, aim: toAim(this.aim),
      fire: alive && this.firing, alt: alive && this.usingItem,
    };
    this.send(input);
    this.pending.push(input);
    if (this.pending.length > 90) this.pending.shift();
    this.mePrev = { ...this.me };
    this.meAt = performance.now();
    if (alive) walk(map, this.me, input.keys, speedFor(me[10] > 0));
    if (this.cooldown > 0) this.cooldown--;
    if (input.fire && this.cooldown <= 0) {
      this.cooldown = FIRE_EVERY;
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

  private screenCanvas(which: 'dark' | 'fogLayer'): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const main = this.canvas!;
    let c = this[which];
    if (!c || c.width !== main.width || c.height !== main.height) {
      c = document.createElement('canvas');
      c.width = main.width;
      c.height = main.height;
      this[which] = c;
    }
    return [c, c.getContext('2d')!];
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
    g.fillStyle = m ? THEME_LOOK[m.theme].void : '#0b1018';
    g.fillRect(0, 0, w, h);
    if (!m || !map || !this.cur) {
      g.fillStyle = '#94a3b8';
      g.font = '600 16px Inter, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('Entering the maze…', w / 2, h / 2);
      return;
    }
    this.floor ??= buildFloor(map, m.theme, m.seed);
    this.walls ??= buildWalls(map, m.theme, m.seed);
    this.mini ??= buildMini(map, m.theme, MINIMAP_W);
    const look = THEME_LOOK[m.theme];

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
    const shake = Math.max(0, 1 - (now - this.shakeAt) / 280) * 7;
    this.cam = { x: focus.x + (Math.random() - 0.5) * shake, y: focus.y + (Math.random() - 0.5) * shake };

    // Where everyone is this frame, and who we can see.
    const fog = m.fog && m.mySeat >= 0 && m.live;
    const people = cur.p.map((pl, seat) => {
      const pp = prev.p[seat] ?? pl;
      const isMe = seat === m.mySeat;
      return {
        seat, pl, isMe,
        x: isMe ? me.x : lerp(pp[0], pl[0], alpha),
        y: isMe ? me.y : lerp(pp[1], pl[1], alpha),
        up: (pl[4] & PF.ALIVE) !== 0 && !(pl[4] & PF.AWAY),
      };
    }).filter((p) => p.up);
    const seen = (x: number, y: number) =>
      !fog || (Math.hypot(x - focus.x, y - focus.y) <= FOG_RANGE && inSight(map, focus.x, focus.y, x, y));
    const shown = people.filter((p) => p.isMe || seen(p.x, p.y));

    const toWorld = (ctx: CanvasRenderingContext2D, d = 1) => {
      ctx.setTransform(d * scale, 0, 0, d * scale, d * (w / 2 - this.cam.x * scale), d * (h / 2 - this.cam.y * scale));
    };

    g.save();
    toWorld(g, dpr);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.floor, 0, 0);

    // Pickups: a glowing token that bobs, with its power's mark.
    for (const u of cur.u ?? []) {
      const kind = powerOf(u[1]);
      if (kind) this.drawPickup(g, kind, u[2], u[3] + Math.sin(now / 300 + u[0]) * 2.5, now);
    }

    // Bullets: a bright streak from where each was a moment ago. Missiles are
    // fat and trail; pellets are small.
    const was = new Map(prev.b.map((b) => [b[0], b]));
    const lights: (Light & { color?: string })[] = [];
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
      lights.push({ x, y, r: shot === SHOT.MISSILE ? 110 : 60, k: 0.7, color: col });
    }
    g.shadowBlur = 0;

    // Players: bodies now; names go on last, over the walls and the dark.
    for (const p of shown) {
      const a = p.isMe && m.live ? this.aim : fromAim(p.pl[2]);
      this.drawPlayer(g, p.x, p.y, a, p.seat, (p.pl[4] & PF.SAFE) !== 0, p.isMe, now, topItem(p.pl), p.pl[9] > 0, p.pl[10] > 0);
      if (p.isMe && m.live && this.controls === 'keys') {
        // Keyboard aiming has no cursor, so show the way we face; red when a
        // locked target is round a corner.
        g.strokeStyle = this.lock !== null && this.lockBlocked ? 'rgba(248, 113, 113, 0.8)' : 'rgba(248, 250, 252, 0.35)';
        g.setLineDash([4, 6]);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(p.x + Math.cos(a) * (PLAYER_R + 14), p.y + Math.sin(a) * (PLAYER_R + 14));
        g.lineTo(p.x + Math.cos(a) * 120, p.y + Math.sin(a) * 120);
        g.stroke();
        g.setLineDash([]);
      }
      const flash = this.flashes.get(p.seat);
      const lit = flash && now - flash < 90;
      lights.push({ x: p.x, y: p.y, r: p.isMe ? look.playerLight : look.playerLight * 0.55, k: p.isMe ? 1 : 0.8 });
      if (lit) lights.push({ x: p.x + Math.cos(a) * 24, y: p.y + Math.sin(a) * 24, r: 150, k: 0.9, color: '#fde68a' });
    }
    for (const u of cur.u ?? []) {
      const kind = powerOf(u[1]);
      if (kind) lights.push({ x: u[2], y: u[3], r: 80, k: 0.6, color: POWER_COLORS[kind] });
    }

    for (const s of this.sparks) {
      g.globalAlpha = Math.max(0, s.life / s.max);
      g.fillStyle = s.color;
      g.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    g.globalAlpha = 1;

    // The walls, standing up over whatever is just behind them.
    g.drawImage(this.walls, 0, 0);
    g.restore();

    this.drawDark(g, look, lights, toWorld, dpr);
    if (fog) this.drawFog(g, map, focus, toWorld, dpr);

    // Names and health, over everything in the world.
    g.save();
    toWorld(g, dpr);
    for (const p of shown) {
      this.drawTag(g, p.x, p.y, p.seat, p.pl[3], p.pl[9], p.isMe);
      if (p.seat === this.lock && this.controls === 'keys') this.drawLock(g, p.x, p.y, now);
    }
    g.restore();

    this.drawHud(g, w, h, cur, now, meAlive, fog, seen);
  }

  /**
   * The theme's darkness, with light cut out round players, shots, pickups and
   * muzzle flashes, and a soft bloom of colour where the light is coloured.
   */
  private drawDark(
    g: CanvasRenderingContext2D, look: (typeof THEME_LOOK)[MazeTheme], lights: (Light & { color?: string })[],
    toWorld: (ctx: CanvasRenderingContext2D, d?: number) => void, dpr: number,
  ): void {
    const [d, dg] = this.screenCanvas('dark');
    dg.setTransform(1, 0, 0, 1, 0, 0);
    dg.globalCompositeOperation = 'source-over';
    dg.clearRect(0, 0, d.width, d.height);
    dg.fillStyle = `rgba(${look.ambientRgb}, ${look.ambient})`;
    dg.fillRect(0, 0, d.width, d.height);
    dg.globalCompositeOperation = 'destination-out';
    toWorld(dg, dpr);
    for (const l of lights) {
      const grad = dg.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      grad.addColorStop(0, `rgba(0, 0, 0, ${l.k})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      dg.fillStyle = grad;
      dg.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(d, 0, 0);
    // Coloured light adds to what is under it.
    toWorld(g, dpr);
    g.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (!l.color) continue;
      const r = l.r * 0.6;
      const grad = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, r);
      grad.addColorStop(0, `${l.color}40`);
      grad.addColorStop(1, `${l.color}00`);
      g.fillStyle = grad;
      g.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    g.restore();
  }

  /** Fog: everything our player could not see from where they stand is dark. */
  private drawFog(
    g: CanvasRenderingContext2D, map: MazeMap, from: { x: number; y: number },
    toWorld: (ctx: CanvasRenderingContext2D, d?: number) => void, dpr: number,
  ): void {
    const [f, fg] = this.screenCanvas('fogLayer');
    fg.setTransform(1, 0, 0, 1, 0, 0);
    fg.globalCompositeOperation = 'source-over';
    fg.clearRect(0, 0, f.width, f.height);
    fg.fillStyle = 'rgba(2, 3, 6, 0.94)';
    fg.fillRect(0, 0, f.width, f.height);
    fg.globalCompositeOperation = 'destination-out';
    toWorld(fg, dpr);
    const poly = visibility(map, from.x, from.y, FOG_RANGE);
    // A shadow on the cut-out softens its edge.
    fg.shadowColor = 'black';
    fg.shadowBlur = 24 * dpr;
    fg.fillStyle = 'black';
    fg.beginPath();
    poly.forEach(([x, y], i) => (i ? fg.lineTo(x, y) : fg.moveTo(x, y)));
    fg.closePath();
    fg.fill();
    fg.shadowBlur = 0;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(f, 0, 0);
    g.restore();
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
    g: CanvasRenderingContext2D, x: number, y: number, a: number, seat: number, safe: boolean, isMe: boolean,
    now: number, item: ItemKind | null, shielded: boolean, fast: boolean,
  ): void {
    const col = MAZE_COLORS[seat % MAZE_COLORS.length]!;
    g.save();
    // A shadow under the body, so players sit on the floor.
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.ellipse(x + 3, y + 5, PLAYER_R, PLAYER_R * 0.7, 0, 0, Math.PI * 2);
    g.fill();
    // What they are carrying glows in its colour; a shield is a bubble.
    if (item || shielded || fast) {
      g.shadowBlur = 14;
      if (item) {
        const pc = POWER_COLORS[item];
        g.shadowColor = pc;
        g.strokeStyle = pc;
        g.lineWidth = 2;
        g.globalAlpha = 0.55 + Math.sin(now / 150) * 0.25;
        g.beginPath();
        g.arc(x, y, PLAYER_R + 4, 0, Math.PI * 2);
        g.stroke();
      }
      if (shielded) {
        g.shadowColor = POWER_COLORS.shield;
        g.globalAlpha = 0.9;
        g.strokeStyle = POWER_COLORS.shield;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, y, PLAYER_R + 8, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 0.12;
        g.fillStyle = POWER_COLORS.shield;
        g.fill();
      }
      if (fast) {
        // Speed lines behind, against the way we face.
        g.shadowColor = POWER_COLORS.speed;
        g.strokeStyle = POWER_COLORS.speed;
        g.globalAlpha = 0.8;
        g.lineWidth = 2;
        for (const off of [-6, 0, 6]) {
          g.beginPath();
          g.moveTo(x - Math.cos(a) * (PLAYER_R + 6) - Math.sin(a) * off, y - Math.sin(a) * (PLAYER_R + 6) + Math.cos(a) * off);
          g.lineTo(x - Math.cos(a) * (PLAYER_R + 18) - Math.sin(a) * off, y - Math.sin(a) * (PLAYER_R + 18) + Math.cos(a) * off);
          g.stroke();
        }
      }
    }
    g.restore();
    if (safe && Math.floor(now / 120) % 2) g.globalAlpha = 0.45;
    // Gun first, under the body. The barrel shows what the secondary will fire.
    g.save();
    g.translate(x, y);
    g.rotate(a);
    const wide = item === 'spread' ? 2.5 : 0;
    g.fillStyle = '#0f172a';
    g.fillRect(PLAYER_R - 4, -3.5 - wide, 14, 7 + wide * 2);
    g.fillStyle = item === 'missile' ? POWER_COLORS.missile : item === 'spread' ? POWER_COLORS.spread : '#cbd5e1';
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
  }

  /** A name, and health (with any shield) once it is not full. */
  private drawTag(g: CanvasRenderingContext2D, x: number, y: number, seat: number, hp: number, shield: number, isMe: boolean): void {
    const name = isMe ? 'You' : this.meta?.names[seat] ?? '';
    g.font = '700 11px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(15, 23, 42, 0.8)';
    g.fillText(name, x + 1, y - PLAYER_R - 11);
    g.fillStyle = '#f1f5f9';
    g.fillText(name, x, y - PLAYER_R - 12);
    if (hp < MAX_HP || shield > 0) {
      g.fillStyle = 'rgba(15, 23, 42, 0.8)';
      g.fillRect(x - 16, y + PLAYER_R + 8, 32, 5);
      g.fillStyle = hp > 40 ? '#4ade80' : '#f87171';
      g.fillRect(x - 16, y + PLAYER_R + 8, 32 * (hp / MAX_HP), 5);
      if (shield > 0) {
        g.fillStyle = POWER_COLORS.shield;
        g.fillRect(x - 16, y + PLAYER_R + 8, 32 * (shield / POWER_AMOUNT.shield), 2);
      }
    }
  }

  private drawHud(
    g: CanvasRenderingContext2D, w: number, h: number, f: MazeFrame, now: number, meAlive: boolean,
    fog: boolean, seen: (x: number, y: number) => boolean,
  ): void {
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

    // The mini map, top right: walls, pickups, everyone the radar allows, and our view.
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
      // The radar rule, and, with fog, anyone we can see anyway.
      if (!isMe && m.radar === 'firing' && !(flags & PF.RADAR) && m.mySeat >= 0 && !(fog && seen(p[0], p[1]))) return;
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

    // Our health, bottom left, with the shield over it in blue.
    const hp = mine[3];
    const shield = mine[9];
    g.fillStyle = 'rgba(15, 23, 42, 0.8)';
    g.fillRect(14, h - 36, 204, 22);
    g.fillStyle = hp > 40 ? '#4ade80' : '#f87171';
    g.fillRect(16, h - 34, 200 * (hp / MAX_HP), 18);
    if (shield > 0) {
      g.fillStyle = POWER_COLORS.shield;
      g.fillRect(16, h - 34, 200 * (shield / POWER_AMOUNT.shield), 7);
    }
    g.fillStyle = '#0f172a';
    g.textAlign = 'left';
    g.font = '800 13px Inter, system-ui, sans-serif';
    g.fillText(shield > 0 ? `${hp} HP + ${shield} shield` : `${hp} HP`, 22, h - 20);

    // The stack, top first: the one the secondary will use, then what is under it.
    const stack = unpackItems(mine[7]);
    let sx = 14;
    const sy = h - 68;
    if (mine[10] > 0) {
      sx = this.chip(g, sx, sy, `${POWER_GLYPH.speed} Speed ${Math.ceil(mine[10] / MAZE_HZ)}s`, POWER_COLORS.speed, true) + 6;
    }
    stack.forEach((kind, i) => {
      const label = i === 0
        ? `${POWER_GLYPH[kind]} ${POWER_NAMES[kind]}${kind === 'speed' ? '' : ` · ${mine[8]}`}`
        : POWER_GLYPH[kind];
      sx = this.chip(g, sx, sy, label, POWER_COLORS[kind], i === 0) + 6;
    });
    if (stack.length) {
      g.font = '700 11px Inter, system-ui, sans-serif';
      g.fillStyle = 'rgba(203, 213, 225, 0.8)';
      g.fillText(this.controls === 'keys' ? 'J to use' : 'Right click or E to use', 16, sy - 8);
    }

    // Keyboard only: the keys, as a reminder.
    if (m.live && this.controls === 'keys') {
      g.textAlign = 'right';
      g.font = '700 12px Inter, system-ui, sans-serif';
      g.fillStyle = this.lock === null ? 'rgba(203, 213, 225, 0.75)' : '#fca5a5';
      g.fillText(
        this.lock === null
          ? 'U fire  ·  J power-up  ·  I lock on'
          : `Locked: ${m.names[this.lock] ?? ''}${this.lockBlocked ? ' (blocked)' : ''}  ·  U fire  ·  J power-up  ·  I next  ·  O let go`,
        w - 16, h - 18,
      );
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

  /** A labelled chip on the HUD; returns where it ends. */
  private chip(g: CanvasRenderingContext2D, x: number, y: number, label: string, color: string, strong: boolean): number {
    g.font = `800 ${strong ? 14 : 13}px Inter, system-ui, sans-serif`;
    g.textAlign = 'left';
    const tw = g.measureText(label).width;
    const wdt = tw + 18;
    g.fillStyle = 'rgba(15, 23, 42, 0.85)';
    g.fillRect(x, y - 17, wdt, 24);
    g.strokeStyle = color;
    g.globalAlpha = strong ? 1 : 0.6;
    g.lineWidth = 2;
    g.strokeRect(x, y - 17, wdt, 24);
    g.fillStyle = color;
    g.fillText(label, x + 9, y);
    g.globalAlpha = 1;
    return x + wdt;
  }
}

let client: MazeClient | null = null;

/** One per tab, like the fight view: socket bindings feed it whether or not
 *  the stage is mounted. */
export function getMazeClient(): MazeClient {
  if (!client) client = new MazeClient();
  return client;
}
