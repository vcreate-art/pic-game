import {
  GF, LEVELS, RH, RW, SHOT_R, T, TILE, atFinish, chaserX, checkpointAt,
  crumbleState, hazardAt, laserPhase, laserRect, newRunner, newWorld, sawAt, shotsAt, stepRunner,
  tileAt, type ChaserPace, type DeathCause, type Ghost, type Level, type RaceEvent, type Runner,
  type World,
} from '@pic-game/shared';
import { serverNow } from '../net/clock.js';
import { RaceInput } from './input.js';

export const VIEW_W = 960;
export const VIEW_H = 540;
const STEP_MS = 1000 / 60;
/** Other runners are drawn this far in the past, so there are always two
 *  updates to blend between. */
const GHOST_DELAY = 120;
const SEND_EVERY = 5;
const RESPAWN_FRAMES = 36;

export interface RacerInfo {
  id: string;
  name: string;
  color: string;
}

export interface RaceMeta {
  me: string | null;
  level: number;
  startAt: number;
  pace: ChaserPace;
  /** We are one of this level's racers and it is running (or about to). */
  racing: boolean;
  racers: RacerInfo[];
}

export interface RaceOut {
  pos: (seq: number, g: Ghost) => void;
  checkpoint: (n: number) => void;
  died: (cause: DeathCause) => void;
  finish: () => void;
  caught: () => void;
}

type Mode = 'run' | 'dead' | 'done' | 'caught' | 'watch';

interface Splat { x: number; y: number; r: number; color: string }
interface Bit { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }

const CAUSE_TEXT: Record<DeathCause, string> = {
  spikes: 'spiked', saw: 'sawn in half', laser: 'lasered', cannon: 'shot', pit: 'fell',
};

/**
 * The race, drawn and — for our own runner — simulated. Our runner moves the
 * moment a key goes down; the server only hears about it afterwards. Everyone
 * else is a ghost, drawn a little in the past between their last two updates.
 * Hazards need nothing from the network at all: they are read off the clock.
 */
export class RaceView {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private input = new RaceInput();
  private out: RaceOut | null = null;

  private meta: RaceMeta | null = null;
  private lv: Level = LEVELS[0]!;
  private world: World = newWorld(this.lv);
  private runner: Runner = newRunner(this.lv);
  private mode: Mode = 'watch';
  private cp = -1;
  private deadFor = 0;
  private deaths = 0;
  private frame = 0;
  private seq = 0;
  private acc = 0;
  private last = 0;
  private cam = { x: 0, y: 0 };
  private levelKey = '';

  private ghosts = new Map<string, { at: number; g: Ghost }[]>();
  private feed: { text: string; at: number; color: string }[] = [];
  private splats: Splat[] = [];
  private bits: Bit[] = [];
  private banner: { text: string; sub?: string; at: number; color: string } | null = null;

  attach(canvas: HTMLCanvasElement, out: RaceOut): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.out = out;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.input.attach();
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.acc = Math.min(this.acc + (now - this.last), 250);
      this.last = now;
      while (this.acc >= STEP_MS) {
        this.step();
        this.acc -= STEP_MS;
      }
      this.draw();
    };
    this.raf = requestAnimationFrame(loop);
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.input.detach();
    this.canvas = this.ctx = null;
    this.out = null;
  }

  private resize(): void {
    const c = this.canvas;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
  }

  /** Called on every state change. A new level (or a new start time) resets
   *  the runner; anything else just updates who is who. */
  setMeta(meta: RaceMeta): void {
    this.meta = meta;
    const key = `${meta.level}:${meta.startAt}`;
    if (key !== this.levelKey) {
      this.levelKey = key;
      this.lv = LEVELS[meta.level] ?? LEVELS[0]!;
      this.world = newWorld(this.lv);
      this.runner = newRunner(this.lv);
      this.cp = -1;
      this.deaths = 0;
      this.ghosts.clear();
      this.splats = [];
      this.bits = [];
      this.feed = [];
      this.banner = null;
      this.mode = meta.racing ? 'run' : 'watch';
      this.cam = { x: this.runner.x - VIEW_W / 3, y: this.runner.y - VIEW_H / 2 };
    }
    if (!meta.racing && this.mode === 'run') this.mode = 'watch';
    if (meta.racing && this.mode === 'watch') this.mode = 'run';
  }

  pushGhosts(gs: Record<string, Ghost>): void {
    const now = performance.now();
    for (const [id, g] of Object.entries(gs)) {
      if (id === this.meta?.me) continue;
      const buf = this.ghosts.get(id) ?? [];
      buf.push({ at: now, g });
      if (buf.length > 8) buf.shift();
      this.ghosts.set(id, buf);
    }
  }

  pushEvents(evs: RaceEvent[]): void {
    const now = performance.now();
    for (const e of evs) {
      const who = this.meta?.racers.find((r) => r.id === e.id);
      const name = e.id === this.meta?.me ? 'You' : who?.name ?? 'Someone';
      const color = who?.color ?? '#ddd';
      switch (e.t) {
        case 'died':
          if (e.id !== this.meta?.me) this.feed.push({ text: `${name} ${CAUSE_TEXT[e.cause]}`, at: now, color });
          break;
        case 'finish':
          this.feed.push({ text: `${name} finished ${ordinal(e.place)} · ${(e.time / 1000).toFixed(2)}s`, at: now, color });
          if (e.id === this.meta?.me) {
            this.banner = { text: `${ordinal(e.place).toUpperCase()}!`, sub: `${(e.time / 1000).toFixed(2)}s`, at: now, color: '#fde047' };
          }
          break;
        case 'caught':
          this.feed.push({ text: `${name} got caught by the grinder`, at: now, color });
          break;
      }
    }
    if (this.feed.length > 6) this.feed.splice(0, this.feed.length - 6);
  }

  // ---------------------------------------------------------------- sim

  private t(): number {
    return serverNow() - (this.meta?.startAt ?? 0);
  }

  private step(): void {
    this.frame++;
    this.updateBits();
    const meta = this.meta;
    const { held, pressed } = this.input.read();
    if (!meta?.racing) return;
    const t = this.t();
    if (t < 0) return; // waiting for GO; the runner stands at the start
    const r = this.runner;

    if (this.mode === 'run') {
      const wasGround = r.ground;
      stepRunner(r, held, pressed, this.world);
      if (!wasGround && r.ground) this.dust(r.x + RW / 2, r.y + RH, 5);
      if (r.ground && Math.abs(r.vx) > 3 && this.frame % 6 === 0) this.dust(r.x + RW / 2, r.y + RH, 1);

      const cause = hazardAt(this.lv, r.x, r.y, t);
      if (cause) this.die(cause);
      else if (r.x + RW < chaserX(this.lv, meta.pace, t)) {
        this.mode = 'caught';
        this.splat(r.x + RW / 2, r.y + RH / 2, 40);
        this.banner = { text: 'CAUGHT', sub: 'The grinder got you', at: performance.now(), color: '#f87171' };
        this.out?.caught();
      } else {
        const n = checkpointAt(this.lv, r.x, r.y);
        if (n > this.cp) {
          this.cp = n;
          this.out?.checkpoint(n);
        }
        if (atFinish(this.lv, r.x, r.y)) {
          // Position first: the server judges the claim from where we last were.
          this.send();
          this.mode = 'done';
          this.out?.finish();
        }
      }
    } else if (this.mode === 'dead') {
      if (--this.deadFor <= 0) {
        const at = this.cp >= 0 ? this.lv.checkpoints[this.cp]! : this.lv.spawn;
        this.runner = newRunner(this.lv, at);
        this.mode = 'run';
        this.send();
      }
    }
    if (this.frame % SEND_EVERY === 0 && (this.mode === 'run' || this.mode === 'dead')) this.send();
  }

  private die(cause: DeathCause): void {
    const r = this.runner;
    this.mode = 'dead';
    this.deadFor = RESPAWN_FRAMES;
    this.deaths++;
    this.splat(r.x + RW / 2, r.y + RH / 2, cause === 'pit' ? 0 : 28);
    this.out?.died(cause);
    this.send();
  }

  private send(): void {
    if (!this.out) return;
    const r = this.runner;
    let f = 0;
    if (r.facing < 0) f |= GF.FACING_LEFT;
    if (r.ground) f |= GF.GROUND;
    if (r.wall) f |= GF.WALL;
    if (r.gliding) f |= GF.GLIDE;
    if (this.mode === 'dead') f |= GF.DEAD;
    if (this.mode === 'done') f |= GF.DONE;
    this.out.pos(++this.seq, [r.x, r.y, r.vx, r.vy, f]);
  }

  // ------------------------------------------------------------ particles

  private myColor(): string {
    return this.meta?.racers.find((r) => r.id === this.meta?.me)?.color ?? '#ef4444';
  }

  private splat(x: number, y: number, n: number): void {
    const color = this.myColor();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 7;
      this.bits.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3, life: 60, color: i % 3 ? '#9f1239' : color, size: 3 + Math.random() * 4 });
    }
  }

  private dust(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.bits.push({ x, y, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 1.5, life: 18, color: 'rgba(200,190,180,.5)', size: 2 + Math.random() * 2 });
    }
  }

  private updateBits(): void {
    for (const b of this.bits) {
      b.x += b.vx;
      b.y += b.vy;
      b.vy += 0.4;
      b.life--;
      // Meat sticks: a blood bit that hits a surface leaves a stain there.
      if (b.color === '#9f1239' && this.solid(b.x, b.y)) {
        if (this.splats.length < 400) this.splats.push({ x: b.x, y: b.y, r: 2 + Math.random() * 4, color: '#7f1d1d' });
        b.life = 0;
      }
    }
    this.bits = this.bits.filter((b) => b.life > 0);
  }

  private solid(x: number, y: number): boolean {
    const t = tileAt(this.lv, Math.floor(x / TILE), Math.floor(y / TILE));
    return t === T.SOLID || t === T.CRUMBLE;
  }

  // ---------------------------------------------------------------- draw

  private ghostAt(id: string): Ghost | null {
    const buf = this.ghosts.get(id);
    if (!buf?.length) return null;
    const at = performance.now() - GHOST_DELAY;
    let i = buf.length - 1;
    while (i > 0 && buf[i]!.at > at) i--;
    const a = buf[i]!;
    const b = buf[i + 1];
    if (!b) return a.g;
    const k = Math.max(0, Math.min(1, (at - a.at) / (b.at - a.at)));
    // A long jump between updates is a respawn: snap, don't slide.
    if (Math.hypot(b.g[0] - a.g[0], b.g[1] - a.g[1]) > 3 * TILE) return k < 0.5 ? a.g : b.g;
    return [a.g[0] + (b.g[0] - a.g[0]) * k, a.g[1] + (b.g[1] - a.g[1]) * k, b.g[2], b.g[3], b.g[4]];
  }

  /** Who the camera follows while we are not running ourselves. */
  private leader(): Ghost | null {
    let best: Ghost | null = null;
    for (const id of this.ghosts.keys()) {
      const g = this.ghostAt(id);
      if (g && !(g[4] & GF.DONE) && (!best || g[0] > best[0])) best = g;
    }
    return best;
  }

  private draw(): void {
    const ctx = this.ctx;
    const c = this.canvas;
    if (!ctx || !c || !c.width) return;
    const meta = this.meta;
    const lv = this.lv;
    const t = meta ? this.t() : 0;
    const scale = c.width / VIEW_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // Camera.
    const r = this.runner;
    const follow = this.mode === 'run' || this.mode === 'dead' || this.mode === 'done' || !this.leader()
      ? { x: r.x, y: r.y } : { x: this.leader()![0], y: this.leader()![1] };
    const tx = follow.x - VIEW_W * 0.4 + r.vx * 12;
    const ty = follow.y - VIEW_H * 0.55;
    this.cam.x += (tx - this.cam.x) * 0.12;
    this.cam.y += (ty - this.cam.y) * 0.12;
    this.cam.x = Math.max(0, Math.min(lv.w * TILE - VIEW_W, this.cam.x));
    this.cam.y = Math.max(-2 * TILE, Math.min(lv.h * TILE - VIEW_H, this.cam.y));

    this.drawBackdrop(ctx);
    ctx.save();
    ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));
    this.drawTiles(ctx);
    this.drawMarkers(ctx);
    this.drawHazards(ctx, t);
    for (const s of this.splats) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (meta) {
      for (const id of this.ghosts.keys()) {
        const g = this.ghostAt(id);
        const info = meta.racers.find((q) => q.id === id);
        if (g && info && !(g[4] & GF.DEAD)) this.drawRunner(ctx, g[0], g[1], g[2], g[3], g[4], info.color, 0.5, info.name);
      }
      if (meta.racing && this.mode !== 'dead' && this.mode !== 'caught') {
        let f = 0;
        if (r.facing < 0) f |= GF.FACING_LEFT;
        if (r.ground) f |= GF.GROUND;
        if (r.wall) f |= GF.WALL;
        if (r.gliding) f |= GF.GLIDE;
        this.drawRunner(ctx, r.x, r.y, r.vx, r.vy, f, this.myColor(), 1, null);
      }
    }
    for (const b of this.bits) {
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);
    }
    if (meta) this.drawChaser(ctx, t);
    ctx.restore();

    this.drawHud(ctx, t);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#1b1320');
    g.addColorStop(1, '#3a1e1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // Factory chimneys, drifting at a quarter of the camera's speed.
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    const off = -(this.cam.x * 0.25) % 300;
    for (let x = off - 300; x < VIEW_W + 300; x += 300) {
      ctx.fillRect(x + 20, 240, 60, 300);
      ctx.fillRect(x + 40, 150, 20, 100);
      ctx.fillRect(x + 140, 300, 120, 240);
      ctx.fillRect(x + 170, 220, 14, 90);
    }
  }

  private drawTiles(ctx: CanvasRenderingContext2D): void {
    const lv = this.lv;
    const x0 = Math.max(0, Math.floor(this.cam.x / TILE));
    const y0 = Math.max(0, Math.floor(this.cam.y / TILE));
    const x1 = Math.min(lv.w - 1, x0 + Math.ceil(VIEW_W / TILE) + 1);
    const y1 = Math.min(lv.h - 1, y0 + Math.ceil(VIEW_H / TILE) + 1);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const k = tileAt(lv, tx, ty);
        if (k === T.AIR) continue;
        const x = tx * TILE;
        const y = ty * TILE;
        if (k === T.SOLID) {
          const top = tileAt(lv, tx, ty - 1) !== T.SOLID;
          ctx.fillStyle = '#4b3f45';
          ctx.fillRect(x, y, TILE, TILE);
          ctx.fillStyle = '#5c4e55';
          ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
          if (top) {
            ctx.fillStyle = '#8a7a7f';
            ctx.fillRect(x, y, TILE, 5);
          }
          ctx.fillStyle = 'rgba(0,0,0,.18)';
          ctx.fillRect(x + 6, y + 12, 3, 3);
          ctx.fillRect(x + 22, y + 22, 3, 3);
        } else if (k === T.CRUMBLE) {
          const s = crumbleState(this.world, ty * lv.w + tx);
          if (s === null) continue;
          const jig = s > 0 ? (Math.random() - 0.5) * 4 * s : 0;
          ctx.fillStyle = '#a16207';
          ctx.fillRect(x + jig, y, TILE, TILE / 2);
          ctx.strokeStyle = '#713f12';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 8 + jig, y);
          ctx.lineTo(x + 14 + jig, y + 8);
          ctx.lineTo(x + 10 + jig, y + 16);
          ctx.moveTo(x + 24 + jig, y);
          ctx.lineTo(x + 20 + jig, y + 10);
          ctx.stroke();
        } else {
          this.drawSpike(ctx, k, x, y);
        }
      }
    }
  }

  private drawSpike(ctx: CanvasRenderingContext2D, k: number, x: number, y: number): void {
    ctx.fillStyle = '#d4d4d8';
    ctx.strokeStyle = '#52525b';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const a = (i * TILE) / 3;
      const b = ((i + 1) * TILE) / 3;
      const m = (a + b) / 2;
      ctx.beginPath();
      if (k === T.SPIKE_UP) { ctx.moveTo(x + a, y + TILE); ctx.lineTo(x + m, y + 10); ctx.lineTo(x + b, y + TILE); }
      else if (k === T.SPIKE_DOWN) { ctx.moveTo(x + a, y); ctx.lineTo(x + m, y + TILE - 10); ctx.lineTo(x + b, y); }
      else if (k === T.SPIKE_LEFT) { ctx.moveTo(x + TILE, y + a); ctx.lineTo(x + 10, y + m); ctx.lineTo(x + TILE, y + b); }
      else { ctx.moveTo(x, y + a); ctx.lineTo(x + TILE - 10, y + m); ctx.lineTo(x, y + b); }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  private drawMarkers(ctx: CanvasRenderingContext2D): void {
    const lv = this.lv;
    lv.checkpoints.forEach((c, i) => {
      const x = c.zone.x + TILE / 2;
      const y = c.y + RH;
      ctx.strokeStyle = '#d6d3d1';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 56);
      ctx.stroke();
      ctx.fillStyle = i <= this.cp ? '#22c55e' : '#78716c';
      ctx.beginPath();
      ctx.moveTo(x, y - 56);
      ctx.lineTo(x + 22, y - 48);
      ctx.lineTo(x, y - 40);
      ctx.fill();
    });
    // Finish: a checkered arch.
    const f = lv.finish;
    const sq = 8;
    for (let j = 0; j < f.h / sq; j++) {
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = (i + j) % 2 ? '#fafafa' : '#18181b';
        ctx.fillRect(f.x + i * sq, f.y + j * sq, sq, sq);
        ctx.fillRect(f.x + f.w - (i + 1) * sq, f.y + j * sq, sq, sq);
      }
    }
    ctx.fillStyle = 'rgba(253,224,71,.12)';
    ctx.fillRect(f.x, f.y, f.w, f.h);
  }

  private drawHazards(ctx: CanvasRenderingContext2D, t: number): void {
    const lv = this.lv;
    for (const l of lv.lasers) {
      const ph = laserPhase(l, t);
      const rct = laserRect(l);
      ctx.fillStyle = '#27272a';
      ctx.fillRect(l.x - 12, l.y - 12, 24, 24);
      if (ph === 'on') {
        ctx.fillStyle = 'rgba(248,113,113,.35)';
        ctx.fillRect(rct.x - 6, rct.y - 6, rct.w + 12, rct.h + 12);
        ctx.fillStyle = '#fecaca';
        ctx.fillRect(rct.x, rct.y, rct.w, rct.h);
      } else if (ph === 'warn' && Math.floor(t / 80) % 2 === 0) {
        ctx.fillStyle = 'rgba(248,113,113,.4)';
        const thin = l.dir === 'down' || l.dir === 'up';
        ctx.fillRect(rct.x + (thin ? 2 : 0), rct.y + (thin ? 0 : 2), thin ? 2 : rct.w, thin ? rct.h : 2);
      }
      ctx.fillStyle = ph === 'on' ? '#ef4444' : ph === 'warn' ? '#f59e0b' : '#52525b';
      ctx.beginPath();
      ctx.arc(l.x, l.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const cn of lv.cannons) {
      const bx = cn.x - (cn.dir === 1 ? TILE : 0);
      ctx.fillStyle = '#3f3f46';
      ctx.fillRect(bx, cn.y - TILE / 2, TILE, TILE);
      ctx.fillStyle = '#18181b';
      ctx.fillRect(cn.dir === 1 ? cn.x - 6 : cn.x - 6, cn.y - 7, 12, 14);
      for (const p of shotsAt(cn, t)) {
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(p.x, p.y, SHOT_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(p.x - cn.dir * 6, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const s of lv.saws) {
      const p = sawAt(s, t);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(t / 60);
      ctx.fillStyle = '#a1a1aa';
      ctx.beginPath();
      const teeth = 12;
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const rr = i % 2 ? s.r * 0.78 : s.r;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#52525b';
      ctx.beginPath();
      ctx.arc(0, 0, s.r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawChaser(ctx: CanvasRenderingContext2D, t: number): void {
    const x = chaserX(this.lv, this.meta!.pace, t);
    if (!Number.isFinite(x) || x < this.cam.x - 40) return;
    const top = this.cam.y - 10;
    const h = VIEW_H + 20;
    const g = ctx.createLinearGradient(x - 160, 0, x, 0);
    g.addColorStop(0, 'rgba(127,29,29,.95)');
    g.addColorStop(1, 'rgba(239,68,68,.95)');
    ctx.fillStyle = g;
    ctx.fillRect(this.cam.x - 10, top, x - this.cam.x + 10, h);
    // A column of spinning teeth along the leading edge.
    ctx.fillStyle = '#e4e4e7';
    for (let y = top; y < top + h; y += 22) {
      const wob = Math.sin(t / 90 + y) * 4;
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 16 + wob, y + 11);
      ctx.lineTo(x - 4, y + 22);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(254,202,202,.6)';
    ctx.fillRect(x - 8, top, 4, h);
  }

  private drawRunner(
    ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number, flags: number,
    color: string, alpha: number, name: string | null,
  ): void {
    const left = (flags & GF.FACING_LEFT) !== 0;
    const ground = (flags & GF.GROUND) !== 0;
    // Squash and stretch: long when fast vertically, wide on the ground at speed.
    const st = Math.min(0.25, Math.abs(vy) / 40);
    const sx = ground ? 1 + Math.min(0.12, Math.abs(vx) / 60) : 1 - st;
    const sy = ground ? 1 - Math.min(0.1, Math.abs(vx) / 70) : 1 + st;
    const cx = x + RW / 2;
    const by = y + RH;
    const w = RW * sx + 4;
    const h = RH * sy;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (flags & GF.GLIDE) {
      // A little cape, spread for the glide.
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath();
      ctx.moveTo(cx - 4, by - h + 6);
      ctx.lineTo(cx - 26, by - h + 16);
      ctx.lineTo(cx + 26, by - h + 16);
      ctx.lineTo(cx + 4, by - h + 6);
      ctx.fill();
    }
    ctx.fillStyle = '#1c1917';
    roundRect(ctx, cx - w / 2 - 2, by - h - 2, w + 4, h + 4, 7);
    ctx.fillStyle = color;
    roundRect(ctx, cx - w / 2, by - h, w, h, 6);
    // Eyes, looking where it runs.
    const ex = cx + (left ? -4 : 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(ex - 6, by - h + 7, 5, 6);
    ctx.fillRect(ex + 1, by - h + 7, 5, 6);
    ctx.fillStyle = '#111';
    ctx.fillRect(ex - 4 + (left ? -1 : 1), by - h + 9, 2, 3);
    ctx.fillRect(ex + 3 + (left ? -1 : 1), by - h + 9, 2, 3);
    if (name) {
      ctx.globalAlpha = 0.9;
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(name, cx, by - h - 8);
    }
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D, t: number): void {
    const meta = this.meta;
    if (!meta) return;
    const lv = this.lv;

    // Progress strip: every racer, the wall, and the flag.
    const px0 = 180;
    const pw = VIEW_W - 360;
    const py = 18;
    const span = lv.finish.x + lv.finish.w;
    const at = (x: number) => px0 + Math.max(0, Math.min(1, x / span)) * pw;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(px0 - 6, py - 8, pw + 12, 16);
    const cx = chaserX(lv, meta.pace, t);
    if (Number.isFinite(cx) && cx > 0) {
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(px0, py - 3, at(cx) - px0, 6);
    }
    ctx.fillStyle = '#fde047';
    ctx.fillRect(px0 + pw - 2, py - 8, 4, 16);
    for (const q of meta.racers) {
      const g = q.id === meta.me ? (meta.racing ? [this.runner.x] : null) : this.ghostAt(q.id);
      if (!g) continue;
      ctx.fillStyle = q.color;
      ctx.strokeStyle = q.id === meta.me ? '#fff' : '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(at(g[0]!), py, q.id === meta.me ? 6 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.font = '800 16px "Baloo 2", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(lv.name, 14, 24);
    ctx.textAlign = 'right';
    ctx.fillText(t > 0 ? `${(t / 1000).toFixed(1)}s` : '0.0s', VIEW_W - 14, 24);
    if (meta.racing) {
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.fillText(`☠ ${this.deaths}`, VIEW_W - 14, 42);
    }

    // Feed, top left under the name.
    ctx.textAlign = 'left';
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    const now = performance.now();
    this.feed = this.feed.filter((f) => now - f.at < 5000);
    this.feed.forEach((f, i) => {
      ctx.globalAlpha = Math.min(1, (5000 - (now - f.at)) / 600);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, 14, 48 + i * 16);
    });
    ctx.globalAlpha = 1;

    // Countdown.
    ctx.textAlign = 'center';
    if (t < 0 && t > -4000) {
      const n = Math.ceil(-t / 1000);
      this.bigText(ctx, String(n), '#fde047', 1 - ((-t % 1000) / 1000) * 0.3);
    } else if (t >= 0 && t < 700 && meta.racing) {
      this.bigText(ctx, 'GO!', '#4ade80', 1);
    }

    const b = this.banner;
    if (b && now - b.at < 2600) {
      this.bigText(ctx, b.text, b.color, 1);
      if (b.sub) {
        ctx.font = '700 20px "Baloo 2", system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(b.sub, VIEW_W / 2, VIEW_H / 2 + 44);
      }
    }
    if (!meta.racing && t > 0) {
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.fillText('Watching — you join the next level', VIEW_W / 2, VIEW_H - 16);
    } else if (this.mode === 'done' || this.mode === 'caught') {
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.fillText('Waiting for the others…', VIEW_W / 2, VIEW_H - 16);
    }
  }

  private bigText(ctx: CanvasRenderingContext2D, text: string, color: string, k: number): void {
    ctx.save();
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.scale(k, k);
    ctx.font = '800 84px "Baloo 2", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.fill();
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

