import {
  CINEMATIC_FRAMES, FATAL_BEATS, FIGHTERS, MAX_HEALTH, METER_BAR, STAGE_W, moveOf, worldBox,
  type Announce, type FightEvent, type FightFrame, type FightSide, type FighterFrame, type FighterId,
} from '@pic-game/shared';
import { Particles } from './particles.js';
import { poseFor, victoryPose } from './poses.js';
import { BONES, LEN, STANCE, joints, with_, type Joints, type Pose } from './skeleton.js';

export const VIEW_W = STAGE_W;
export const VIEW_H = 600;
const GROUND = 540;
const STEP_MS = 1000 / 60;
const toY = (y: number) => GROUND - y;

const ANNOUNCE_FONT = '"Anton", Impact, "Arial Black", sans-serif';

/** A second colour for the right-hand fighter in a mirror match. */
const ALT_COLOR: Record<FighterId, string> = {
  ember: '#dc2626',
  rime: '#3b82f6',
  volt: '#e5e7eb',
  vex: '#ec4899',
};

export interface FightMeta {
  picks: Record<FightSide, FighterId>;
  /** The players' own names, under the fighters'. */
  names: Record<FightSide, string>;
  blood: boolean;
  roundsToWin: number;
}

interface Banner {
  text: string;
  sub?: string;
  start: number;
  dur: number;
  style: 'gold' | 'red' | 'small';
}

interface Loser {
  hidden: boolean;
  noHead: boolean;
  /** Upper body sliding off, for the split. */
  split: { dx: number; dy: number; rot: number } | null;
  tint: string | null;
  jitter: number;
}

const other = (s: FightSide): FightSide => (s === 'a' ? 'b' : 'a');
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`;
}

/**
 * Draws the fight. Frames and events arrive straight from the socket and never
 * pass through React, so sixty snapshots a second cost no re-renders at all.
 * The component only mounts this and hands it a canvas.
 */
export class FightView {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private bg: HTMLCanvasElement | null = null;

  private prev: FightFrame | null = null;
  private cur: FightFrame | null = null;
  private curAt = 0;
  private meta: FightMeta | null = null;

  private fx = new Particles();
  private banners: Banner[] = [];
  private shake = 0;
  private flash = 0;
  private clock = 0;
  private krush: { side: FightSide; start: number } | null = null;
  private combo: { side: FightSide; hits: number; dmg: number; start: number } | null = null;
  private trail: Record<FightSide, number> = { a: MAX_HEALTH, b: MAX_HEALTH };
  private cam = { x: VIEW_W / 2, y: VIEW_H / 2, z: 1 };
  private loser: Loser = { hidden: false, noHead: false, split: null, tint: null, jitter: 0 };
  private fatalityLast = 0;
  private debug = false;

  // ----------------------------------------------------------- lifecycle

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    window.addEventListener('keydown', this.onKey);
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.draw();
    };
    this.raf = requestAnimationFrame(tick);
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.ro = null;
    window.removeEventListener('keydown', this.onKey);
    this.canvas = null;
    this.ctx = null;
  }

  private onKey = (e: KeyboardEvent) => {
    // A hitbox overlay for tuning poses against the sim's boxes.
    if (e.key === 'F2') {
      this.debug = !this.debug;
      e.preventDefault();
    }
  };

  private resize(): void {
    const c = this.canvas;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(c.clientHeight * dpr);
  }

  setMeta(meta: FightMeta): void {
    this.meta = meta;
  }

  /** Forget the last match: a rematch starts clean. */
  reset(): void {
    this.prev = this.cur = null;
    this.fx.clear();
    this.banners = [];
    this.krush = this.combo = null;
    this.trail = { a: MAX_HEALTH, b: MAX_HEALTH };
    this.resetLoser();
  }

  private resetLoser(): void {
    this.loser = { hidden: false, noHead: false, split: null, tint: null, jitter: 0 };
    this.fatalityLast = 0;
  }

  // -------------------------------------------------------------- input

  pushFrame(f: FightFrame): void {
    const cur = this.cur;
    if (cur && f.t <= cur.t) {
      // A frame that is merely late is a few ticks behind. One from seconds
      // earlier can only be a new match that the reset on start missed.
      if (cur.t - f.t < 120) return;
      this.reset();
    }
    if (cur && f.r !== cur.r) {
      this.fx.clearFloor();
      this.resetLoser();
    }
    for (const s of ['a', 'b'] as const) {
      const was = cur?.[s].v ?? 0;
      const now = f[s].v;
      if (was !== now) {
        const at = now ? cur![s] : f[s];
        this.fx.burst('ember', at.x, at.y + 90, 30, 0, 0.8);
        this.fx.burst('smoke', at.x, at.y + 60, 8, 0);
      }
    }
    if (f.p === 'fatality' && f.fat) this.runFatality(f, cur?.p === 'fatality' ? this.fatalityLast : 0);
    this.prev = cur;
    this.cur = f;
    this.curAt = performance.now();
  }

  pushEvents(evs: FightEvent[]): void {
    // A hidden tab gets no animation frames, so anything spawned now would
    // sit frozen and then play all at once when the player switches back.
    if (document.hidden) return;
    const now = performance.now();
    const f = this.cur;
    const blood = this.meta?.blood ?? true;
    for (const e of evs) {
      switch (e.t) {
        case 'hit': {
          const dir = f ? f[e.side].f : 1;
          if (blood) this.fx.burst('blood', e.x, e.y, e.heavy ? 28 : 12, dir, e.heavy ? 1.3 : 0.9);
          this.fx.burst('spark', e.x, e.y, e.heavy ? 12 : 6, dir);
          this.shake = Math.max(this.shake, e.heavy ? 10 : 4);
          break;
        }
        case 'block':
          this.fx.burst('bolt', e.x, e.y, 10, f ? -f[e.side].f : 1, 0.8);
          this.shake = Math.max(this.shake, 2);
          break;
        case 'krush':
          this.krush = { side: e.side, start: now };
          this.shake = 14;
          this.banner('KRUSHING BLOW', 'small', 1400);
          break;
        case 'fatalBlow':
          if (e.landed) {
            this.flash = 1;
            const who = this.meta ? FIGHTERS[this.meta.picks[e.side]].fatalBlow : '';
            this.banner('FATAL BLOW', 'red', 1800, who.toUpperCase());
          }
          break;
        case 'throwBreak':
          this.fx.burst('spark', e.x, e.y, 16, 1);
          this.fx.burst('spark', e.x, e.y, 16, -1);
          this.banner('BREAKAWAY', 'small', 900);
          break;
        case 'clash':
          this.fx.burst('bolt', e.x, e.y, 24, 1);
          this.fx.burst('bolt', e.x, e.y, 24, -1);
          this.shake = Math.max(this.shake, 5);
          break;
        case 'amplify':
          this.flash = Math.max(this.flash, 0.35);
          if (f) this.fx.burst('bolt', f[e.side].x, f[e.side].y + 120, 16, 0);
          break;
        case 'breaker':
          this.flash = 0.6;
          this.shake = 10;
          this.banner('BREAKER', 'small', 900);
          break;
        case 'combo':
          this.combo = { side: e.side, hits: e.hits, dmg: e.dmg, start: now };
          break;
        case 'special':
          if (e.move === 'fatal') this.flash = Math.max(this.flash, 0.5);
          break;
        case 'announce':
          this.announce(e.what, e.side, e.round);
          break;
        case 'fatality':
          this.resetLoser();
          break;
      }
    }
  }

  private banner(text: string, style: Banner['style'], dur: number, sub?: string): void {
    // A newer big call replaces the one on screen rather than stacking on it.
    if (style !== 'small') this.banners = this.banners.filter((b) => b.style === 'small');
    this.banners.push({ text, sub, style, dur, start: performance.now() });
  }

  private announce(what: Announce, side?: FightSide, round?: number): void {
    const name = side && this.meta ? FIGHTERS[this.meta.picks[side]].name.toUpperCase() : '';
    switch (what) {
      case 'round': this.banner(`ROUND ${round ?? ''}`, 'gold', 1400); break;
      case 'fight': this.banner('FIGHT!', 'red', 1000); break;
      case 'ko': this.banner('K.O.', 'red', 1600); break;
      case 'time': this.banner('TIME', 'gold', 1400); break;
      case 'draw': this.banner('DRAW', 'gold', 1600); break;
      case 'flawless': this.banner('FLAWLESS VICTORY', 'gold', 2000); break;
      case 'finish': this.banner('FINISH THEM!', 'red', 2600); break;
      case 'fatality': this.banner('FATALITY', 'red', 3200); break;
      case 'wins': this.banner(side ? `${name} WINS` : 'NO CONTEST', 'gold', 3000); break;
    }
  }

  // ------------------------------------------------------------ fatality

  /** Fires each scripted moment once as the fatality's frame count passes it. */
  private runFatality(f: FightFrame, from: number): void {
    const meta = this.meta;
    if (!meta || !f.fat) return;
    const to = f.pf;
    this.fatalityLast = to;
    const crossed = (at: number) => from < at && to >= at;
    const w = f.fat;
    const l = other(w);
    const who = meta.picks[w];
    const lf = f[l];
    const wf = f[w];
    const dir = lf.x > wf.x ? 1 : -1;
    const blood = meta.blood;
    const color = this.colorOf(l);
    const J = this.jointsFor(f, l);

    const splash = (x: number, y: number, n: number, d: number, force = 1) => {
      if (blood) this.fx.burst('blood', x, y, n, d, force);
      else this.fx.burst('spark', x, y, Math.ceil(n / 2), d, force);
    };
    const gibAll = (force: number, tint?: string) => {
      this.loser.hidden = true;
      for (const [p, q] of BONES) {
        const a = J[p];
        const b = J[q];
        this.fx.gibs.push({
          x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
          vx: (Math.random() - 0.5) * 10 * force + dir * 3 * force,
          vy: 4 + Math.random() * 8 * force,
          a: Math.atan2(b.y - a.y, b.x - a.x), va: (Math.random() - 0.5) * 0.5,
          len: Math.hypot(b.x - a.x, b.y - a.y), width: 8,
          color: tint ?? color, bleeds: blood, resting: false,
        });
      }
      if (!this.loser.noHead) {
        this.fx.gibs.push({
          x: J.head.x, y: J.head.y, vx: dir * 4 * force + (Math.random() - 0.5) * 6, vy: 8 * force,
          a: 0, va: 0.2, len: 0, width: 0, color: tint ?? color, head: true, bleeds: blood, resting: false,
        });
      }
    };

    switch (who) {
      case 'ember':
        if (crossed(70)) {
          this.loser.noHead = true;
          this.fx.gibs.push({
            x: J.head.x, y: J.head.y, vx: -dir * 9, vy: 6, a: 0, va: 0.3,
            len: 0, width: 0, color, head: true, bleeds: blood, resting: false,
          });
          splash(J.neck.x, J.neck.y, 30, -dir);
          this.shake = 10;
        }
        if (to > 70 && to < 140 && blood && to % 2 === 0) this.fx.fountain(J.neck.x, J.neck.y, 3);
        if (to > 90 && to < 200 && to % 2 === 0) this.fx.burst('ember', lf.x, lf.y + 40 + Math.random() * 100, 3, 0, 0.6);
        if (to > 90) this.loser.tint = '#2a1d17';
        if (crossed(150)) {
          gibAll(0.4, '#2a1d17');
          this.fx.burst('smoke', lf.x, 60, 20, 0);
        }
        break;

      case 'rime':
        if (to > 40) this.loser.tint = '#bdefff';
        if (to > 10 && to < 70 && to % 2 === 0) {
          const t = (to - 10) / 60;
          this.fx.burst('ice', lerp(wf.x + dir * 60, lf.x, t), 140, 2, dir, 0.3);
        }
        if (crossed(122)) {
          gibAll(1.4, '#bdefff');
          this.fx.burst('ice', lf.x, 110, 80, dir, 1.4);
          splash(lf.x, 110, 40, dir, 1.3);
          this.shake = 14;
          this.flash = 0.5;
        }
        break;

      case 'volt':
        if (to > 20 && to < 170) {
          this.loser.jitter = 2 + (to - 20) / 30;
          this.loser.tint = to % 6 < 3 ? '#fefce8' : null;
          if (to % 3 === 0) this.fx.burst('bolt', lf.x, lf.y + 60 + Math.random() * 100, 4, 0, 0.8);
        }
        if (crossed(170)) {
          this.loser.jitter = 0;
          gibAll(2);
          splash(lf.x, 110, 60, 0, 1.6);
          this.fx.burst('bolt', lf.x, 110, 60, 0, 1.6);
          this.shake = 18;
          this.flash = 1;
        }
        break;

      case 'vex':
        if (to >= 70 && to < 110) {
          const t = (to - 70) / 40;
          this.loser.split = { dx: dir * 30 * t, dy: -10 * t * t, rot: 40 * t * t };
          if (blood && to % 2 === 0) this.fx.fountain(J.hip.x, J.hip.y + 4, 2);
        }
        if (crossed(70)) {
          splash(J.hip.x, J.hip.y, 30, dir);
          this.shake = 8;
        }
        if (crossed(110)) {
          gibAll(0.5);
          this.loser.split = null;
        }
        break;
    }
  }

  /** The winner's own movement during their fatality. */
  private fatalityPose(who: FighterId, pf: number): Pose {
    const at = (a: number, b: number) => pf >= a && pf < b;
    switch (who) {
      case 'ember':
        if (at(20, 60)) return with_(STANCE, { fs: 92, fe: 0, torso: 18, hx: 8 });
        if (at(60, 90)) return with_(STANCE, { fs: 50, fe: 60, torso: -14, hx: -6 });
        break;
      case 'rime':
        if (at(10, 75)) return with_(STANCE, { fs: 92, fe: 0, bs: 86, be: 0, torso: 14 });
        if (at(100, 130)) return with_(STANCE, { hip: 92, bs: 172, be: 0, torso: 4 });
        break;
      case 'volt':
        if (at(20, 170)) return with_(STANCE, { fs: 95, fe: 0, bs: 90, be: 0, torso: 10 });
        break;
      case 'vex':
        if (at(30, 45)) return with_(STANCE, { fs: -20, fe: 90, torso: -6 });
        if (at(45, 80)) return with_(STANCE, { fs: 100, fe: 0, torso: 16 });
        break;
    }
    return pf > 150 ? victoryPose(this.clock) : STANCE;
  }

  // ---------------------------------------------------------------- draw

  private colorOf(side: FightSide): string {
    const m = this.meta;
    if (!m) return '#ddd';
    const id = m.picks[side];
    if (side === 'b' && m.picks.a === id) return ALT_COLOR[id];
    return FIGHTERS[id].color;
  }

  private poseOf(f: FightFrame, side: FightSide): Pose {
    const ff = f[side];
    const id = this.meta!.picks[side];
    if (f.cin) {
      return f.cin.s === side ? this.fatalBlowPose(f.cin.f) : this.fatalBlowVictimPose(f.cin.f);
    }
    if (f.fat === side) return this.fatalityPose(id, f.p === 'fatality' ? f.pf : 999);
    if (f.p === 'matchOver' && ff.s !== 'ko' && ff.s !== 'dizzy') return victoryPose(this.clock);
    return poseFor(ff, id, this.clock);
  }

  private fatalBlowPose(t: number): Pose {
    const [b1, b2, b3] = FATAL_BEATS;
    if (t < b1 - 5) return with_(STANCE, { bs: -40, be: 60, torso: -10, fs: 60, fe: 100 });
    if (t < b2 - 5) return with_(STANCE, { hip: 92, bs: 172, be: 0, torso: 4 });
    if (t < b3 - 5) return with_(STANCE, { fh: 118, fk: 0, torso: -28 });
    if (t < CINEMATIC_FRAMES - 10) return with_(STANCE, { bs: 105, be: 20, torso: 28, hx: 10 });
    return STANCE;
  }

  private fatalBlowVictimPose(t: number): Pose {
    const since = Math.min(...FATAL_BEATS.map((b) => (t >= b ? t - b : 999)));
    const k = since < 20 ? 1 - since / 20 : 0;
    return with_(STANCE, { torso: -30 * k - 5, head: -25 * k, fs: -20, fe: 30, bs: -35, be: 20, hx: -10 * k });
  }

  private jointsFor(f: FightFrame, side: FightSide, x = f[side].x, y = f[side].y): Joints {
    const ff = f[side];
    const p = this.poseOf(f, side);
    const j = joints(p, x, y, ff.f);
    // Plant the feet: poses are drawn freehand, so rather than tune every hip
    // height by eye, a grounded fighter is lowered until a foot meets the floor.
    if (y <= 0.5 && !p.rot && ff.s !== 'juggle') {
      const low = Math.min(j.fFoot.y, j.bFoot.y);
      for (const k of Object.keys(j) as (keyof Joints)[]) j[k] = { x: j[k].x, y: j[k].y - low };
    }
    return j;
  }

  private draw(): void {
    const ctx = this.ctx;
    const c = this.canvas;
    if (!ctx || !c || c.width === 0) return;
    this.clock++;
    const scale = c.width / VIEW_W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    this.drawBackground(ctx);
    const f = this.cur;
    const meta = this.meta;
    if (!f || !meta) return;

    // Hitstop holds the picture, as the sim does; particles keep moving so
    // the freeze reads as impact rather than a stall.
    this.fx.update();

    const alpha = clamp((performance.now() - this.curAt) / STEP_MS, 0, 1);
    const pos = (s: FightSide) => {
      const p = this.prev?.[s];
      const q = f[s];
      if (!p || this.prev!.r !== f.r || Math.abs(p.x - q.x) > 80) return { x: q.x, y: q.y };
      return { x: lerp(p.x, q.x, alpha), y: lerp(p.y, q.y, alpha) };
    };

    // Camera: pulls in for cinematics and Krushing Blows.
    const now = performance.now();
    const krushOn = this.krush && now - this.krush.start < 650;
    let tz = 1;
    let tx = VIEW_W / 2;
    let ty = VIEW_H / 2;
    if (f.cin || f.p === 'fatality' || krushOn) {
      tz = krushOn ? 1.7 : 1.45;
      const focus = krushOn ? f[other(this.krush!.side)] : null;
      tx = focus ? focus.x : (f.a.x + f.b.x) / 2;
      ty = GROUND - 120;
    }
    this.cam.z = lerp(this.cam.z, tz, 0.12);
    this.cam.x = lerp(this.cam.x, tx, 0.12);
    this.cam.y = lerp(this.cam.y, ty, 0.12);
    const hw = VIEW_W / 2 / this.cam.z;
    const hh = VIEW_H / 2 / this.cam.z;
    const cx = clamp(this.cam.x, hw, VIEW_W - hw);
    const cy = clamp(this.cam.y, hh, VIEW_H - hh);

    ctx.save();
    if (this.shake > 0.3) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= 0.86;
    }
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-cx, -cy);
    if (this.cam.z > 1.02) this.drawBackground(ctx, true);

    this.fx.drawFloor(ctx, toY);

    const ja = this.jointsFor(f, 'a', pos('a').x, pos('a').y);
    const jb = this.jointsFor(f, 'b', pos('b').x, pos('b').y);
    const J: Record<FightSide, Joints> = { a: ja, b: jb };

    for (const s of ['a', 'b'] as const) this.drawShadow(ctx, J[s], f[s]);
    // Whoever is attacking draws on top, so a strike reads over the body it hits.
    const order: FightSide[] = f.b.s === 'attack' && f.a.s !== 'attack' ? ['a', 'b'] : ['b', 'a'];
    for (const s of order) this.drawFighter(ctx, s, f[s], J[s]);

    this.drawProjectiles(ctx, f, J);
    this.drawFatalityProps(ctx, f, J);
    this.fx.draw(ctx, toY);
    if (this.debug) this.drawBoxes(ctx, f);
    ctx.restore();

    // Screen-space layers.
    if (f.cin) this.drawCinematicShade(ctx, f.cin.f);
    if (krushOn) this.drawXray(ctx, J[other(this.krush!.side)], (now - this.krush!.start) / 650, cx, cy);
    if (f.cin && FATAL_BEATS.some((b) => f.cin!.f >= b && f.cin!.f < b + 10)) {
      this.drawXray(ctx, J[other(f.cin.s)], 0.5, cx, cy);
    }
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      this.flash *= 0.85;
    }
    this.drawHud(ctx, f, meta);
    this.drawBanners(ctx);
  }

  private drawBackground(ctx: CanvasRenderingContext2D, zoomed = false): void {
    if (!this.bg) this.bg = paintStage();
    ctx.drawImage(this.bg, 0, 0, VIEW_W, VIEW_H);
    // Torches, flickering.
    for (const tx of [150, 1050]) {
      const fl = Math.sin(this.clock * 0.3 + tx) * 3 + Math.random() * 2;
      const g = ctx.createRadialGradient(tx, 300, 2, tx, 300, 90 + fl * 3);
      g.addColorStop(0, 'rgba(255,170,60,.35)');
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(tx - 120, 180, 240, 240);
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.moveTo(tx - 9, 305);
      ctx.quadraticCurveTo(tx - 6, 285 - fl, tx, 272 - fl * 2);
      ctx.quadraticCurveTo(tx + 6, 285 - fl, tx + 9, 305);
      ctx.fill();
      ctx.fillStyle = '#fff1b8';
      ctx.beginPath();
      ctx.ellipse(tx, 298, 4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (zoomed) return;
  }

  private drawShadow(ctx: CanvasRenderingContext2D, j: Joints, ff: FighterFrame): void {
    if (ff.v) return;
    const lift = Math.min(1, ff.y / 200);
    ctx.fillStyle = `rgba(0,0,0,${0.45 - lift * 0.25})`;
    ctx.beginPath();
    ctx.ellipse(j.hip.x, GROUND + 4, 38 * (1 - lift * 0.4), 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawFighter(ctx: CanvasRenderingContext2D, side: FightSide, ff: FighterFrame, j: Joints): void {
    if (ff.v) return;
    const f = this.cur!;
    const meta = this.meta!;
    const id = meta.picks[side];
    const isLoser = !!f.fat && side !== f.fat;
    const L = isLoser ? this.loser : null;
    if (L?.hidden) return;

    let color = this.colorOf(side);
    if (L?.tint) color = L.tint;
    if (ff.s === 'frozen') color = '#bdefff';
    const back = shade(color.startsWith('#') ? color : '#cccccc', 0.62);

    const jit = L?.jitter ? () => (Math.random() - 0.5) * L.jitter : () => 0;
    const P = (k: keyof Joints) => {
      const upper = k !== 'hip' && k !== 'fKnee' && k !== 'fFoot' && k !== 'bKnee' && k !== 'bFoot';
      const q = j[k];
      let x = q.x + jit();
      let y = q.y + jit();
      if (L?.split && upper) {
        // Rotate the upper half about the waist and slide it off.
        const a = (-L.split.rot * Math.PI) / 180 * (f[side].f);
        const dx = x - j.hip.x;
        const dy = y - j.hip.y;
        x = j.hip.x + dx * Math.cos(a) - dy * Math.sin(a) + L.split.dx;
        y = j.hip.y + dx * Math.sin(a) + dy * Math.cos(a) + L.split.dy;
      }
      return { x, y: toY(y) };
    };

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // A dark outline under everything keeps the figure legible over the stage.
    for (const pass of ['outline', 'fill'] as const) {
      for (const [p, q, layer] of BONES) {
        const a = P(p);
        const b = P(q);
        ctx.strokeStyle = pass === 'outline' ? 'rgba(10,6,4,.85)' : layer === 'back' ? back : color;
        ctx.lineWidth = (layer === 'body' ? 10 : 8) + (pass === 'outline' ? 4 : 0);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    const neck = P('neck');
    const head = P('head');
    if (!L?.noHead) drawHead(ctx, id, head, neck, ff.f, color, this.clock, side === 'a' ? 0 : 2);

    if (ff.s === 'frozen') {
      ctx.fillStyle = 'rgba(190,240,255,.28)';
      ctx.strokeStyle = 'rgba(224,251,255,.8)';
      ctx.lineWidth = 2;
      const x0 = Math.min(j.fHand.x, j.bHand.x, j.fFoot.x, j.bFoot.x, j.head.x) - 16;
      const x1 = Math.max(j.fHand.x, j.bHand.x, j.fFoot.x, j.bFoot.x, j.head.x) + 16;
      ctx.beginPath();
      ctx.rect(x0, toY(j.head.y + 22), x1 - x0, j.head.y + 22 - Math.min(j.fFoot.y, j.bFoot.y));
      ctx.fill();
      ctx.stroke();
    }
    if (ff.s === 'dizzy' || ff.s === 'stunned') {
      for (let i = 0; i < 3; i++) {
        const a = this.clock * 0.1 + (i * Math.PI * 2) / 3;
        ctx.fillStyle = '#fde047';
        ctx.font = '14px sans-serif';
        ctx.fillText('✦', head.x + Math.cos(a) * 22 - 5, head.y - 24 + Math.sin(a) * 6);
      }
    }
    if (ff.bl && (ff.s === 'idle' || ff.s === 'crouch' || ff.s === 'blockstun')) {
      ctx.strokeStyle = ff.s === 'blockstun' ? 'rgba(186,230,253,.9)' : 'rgba(186,230,253,.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      const r = ff.cr ? 60 : 90;
      const cy = toY(ff.cr ? 60 : 100);
      const a0 = ff.f === 1 ? -0.9 : Math.PI - 0.9;
      ctx.arc(j.hip.x, cy, r, a0, a0 + 1.8);
      ctx.stroke();
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, f: FightFrame, J: Record<FightSide, Joints>): void {
    for (const p of f.pr) {
      const x = p.x;
      const y = toY(p.y);
      switch (p.k) {
        case 'spear': {
          const hand = J[p.o].fHand;
          ctx.strokeStyle = '#9ca3af';
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(hand.x, toY(hand.y));
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#e5e7eb';
          ctx.beginPath();
          ctx.moveTo(x + p.d * 18, y);
          ctx.lineTo(x - p.d * 4, y - 7);
          ctx.lineTo(x - p.d * 4, y + 7);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'ice': {
          const g = ctx.createRadialGradient(x, y, 2, x, y, 20);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.5, '#67e8f9');
          g.addColorStop(1, 'rgba(34,211,238,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, 20, 0, Math.PI * 2);
          ctx.fill();
          if (this.clock % 3 === 0) this.fx.burst('ice', p.x - p.d * 10, p.y, 1, -p.d, 0.2);
          break;
        }
        case 'bolt': {
          ctx.strokeStyle = '#fef9c3';
          ctx.shadowColor = '#7dd3fc';
          ctx.shadowBlur = 14;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x - p.d * 60, y);
          for (let i = 1; i <= 6; i++) ctx.lineTo(x - p.d * 60 + p.d * i * 12, y + (Math.random() - 0.5) * 18);
          ctx.stroke();
          ctx.shadowBlur = 0;
          break;
        }
        case 'fan': {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.clock * 0.5 * p.d);
          ctx.fillStyle = '#a855f7';
          ctx.strokeStyle = '#e9d5ff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, 18, -0.2, Math.PI + 0.2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          break;
        }
      }
    }
  }

  /** The spear, beam, lightning and fan that the fatalities are made of. */
  private drawFatalityProps(ctx: CanvasRenderingContext2D, f: FightFrame, J: Record<FightSide, Joints>): void {
    if (f.p !== 'fatality' || !f.fat || !this.meta) return;
    const w = f.fat;
    const l = other(w);
    const pf = f.pf;
    const hand = J[w].fHand;
    const target = J[l];
    const who = this.meta.picks[w];

    if (who === 'ember' && pf >= 20 && pf < 90) {
      const t = pf < 50 ? (pf - 20) / 30 : 1;
      const head = this.loser.noHead ? { x: lerp(target.head.x, hand.x, Math.min(1, (pf - 70) / 20)), y: target.head.y } : target.head;
      const x = lerp(hand.x, head.x, t);
      const y = lerp(hand.y, head.y, t);
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(hand.x, toY(hand.y));
      ctx.lineTo(x, toY(y));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (who === 'rime' && pf >= 10 && pf < 75) {
      ctx.strokeStyle = 'rgba(165,243,252,.8)';
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 20;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(hand.x, toY(hand.y));
      ctx.lineTo(target.neck.x, toY(target.neck.y - 20));
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (who === 'volt' && pf >= 20 && pf < 170) {
      for (let arc = 0; arc < 3; arc++) {
        ctx.strokeStyle = arc === 0 ? '#fef9c3' : 'rgba(125,211,252,.8)';
        ctx.shadowColor = '#7dd3fc';
        ctx.shadowBlur = 12;
        ctx.lineWidth = arc === 0 ? 3 : 2;
        const from = arc === 2 ? J[w].bHand : hand;
        const to = [target.neck, target.hip, target.head][arc]!;
        ctx.beginPath();
        ctx.moveTo(from.x, toY(from.y));
        for (let i = 1; i < 8; i++) {
          const t = i / 8;
          ctx.lineTo(lerp(from.x, to.x, t) + (Math.random() - 0.5) * 20, toY(lerp(from.y, to.y, t)) + (Math.random() - 0.5) * 20);
        }
        ctx.lineTo(to.x, toY(to.y));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    if (who === 'vex' && pf >= 45 && pf < 100) {
      const t = (pf - 45) / 35;
      const x = lerp(hand.x, target.hip.x + (target.hip.x - hand.x) * 1.2, t);
      const y = lerp(hand.y, target.hip.y + 6, Math.min(1, t * 1.5));
      ctx.save();
      ctx.translate(x, toY(y));
      ctx.rotate(this.clock * 0.6);
      ctx.fillStyle = '#a855f7';
      ctx.strokeStyle = '#e9d5ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 20, -0.2, Math.PI + 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawCinematicShade(ctx: CanvasRenderingContext2D, t: number): void {
    const k = Math.min(1, t / 12, (CINEMATIC_FRAMES - t) / 12);
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 120, VIEW_W / 2, VIEW_H / 2, 700);
    g.addColorStop(0, 'rgba(60,0,0,0)');
    g.addColorStop(1, `rgba(40,0,0,${0.75 * k})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  /** The bone-crunch close-up: the victim's skeleton, white on black, cracking. */
  private drawXray(ctx: CanvasRenderingContext2D, j: Joints, t: number, cx: number, cy: number): void {
    const k = Math.sin(Math.min(1, t) * Math.PI);
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.7 * k})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.translate(VIEW_W / 2, VIEW_H / 2);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = k;
    ctx.strokeStyle = '#f5f5f4';
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    for (const [p, q] of BONES) {
      ctx.beginPath();
      ctx.moveTo(j[p].x, toY(j[p].y));
      ctx.lineTo(j[q].x, toY(j[q].y));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(j.head.x, toY(j.head.y), LEN.head, 0, Math.PI * 2);
    ctx.stroke();
    // The crack, through the ribs.
    const mx = (j.hip.x + j.neck.x) / 2;
    const my = toY((j.hip.y + j.neck.y) / 2);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mx - 10, my - 12);
    ctx.lineTo(mx + 4, my - 2);
    ctx.lineTo(mx - 6, my + 4);
    ctx.lineTo(mx + 10, my + 14);
    ctx.stroke();
    ctx.restore();
  }

  private drawBoxes(ctx: CanvasRenderingContext2D, f: FightFrame): void {
    const meta = this.meta!;
    for (const s of ['a', 'b'] as const) {
      const ff = f[s];
      const low = ff.cr || ff.s === 'crouch';
      ctx.strokeStyle = 'rgba(74,222,128,.9)';
      ctx.lineWidth = 2;
      const h = low ? 110 : 185;
      ctx.strokeRect(ff.x - 30, toY(ff.y + h), 60, h);
      const mv = ff.m ? moveOf(meta.picks[s], ff.m) : undefined;
      if (!mv) continue;
      for (const hit of mv.hits) {
        if (ff.mf < hit.at || ff.mf >= hit.at + hit.active) continue;
        const r = worldBox({ x: ff.x, y: ff.y, facing: ff.f }, hit.box);
        ctx.strokeStyle = 'rgba(248,113,113,.95)';
        ctx.strokeRect(r.x1, toY(r.y2), r.x2 - r.x1, r.y2 - r.y1);
      }
    }
  }

  // ----------------------------------------------------------------- hud

  private drawHud(ctx: CanvasRenderingContext2D, f: FightFrame, meta: FightMeta): void {
    const barW = 470;
    const barH = 24;
    const top = 24;
    const pulse = (Math.sin(this.clock * 0.2) + 1) / 2;

    for (const s of ['a', 'b'] as const) {
      const ff = f[s];
      const left = s === 'a';
      const x0 = left ? 60 : VIEW_W - 60 - barW;
      const hp = clamp(ff.h / MAX_HEALTH, 0, 1);
      // The red trail catches up slowly, so a combo's damage stays readable.
      this.trail[s] = Math.max(ff.h, this.trail[s] - 6);
      if (this.trail[s] < ff.h) this.trail[s] = ff.h;
      const tr = clamp(this.trail[s] / MAX_HEALTH, 0, 1);

      ctx.fillStyle = 'rgba(0,0,0,.7)';
      ctx.fillRect(x0 - 3, top - 3, barW + 6, barH + 6);
      ctx.fillStyle = '#3f0d12';
      ctx.fillRect(x0, top, barW, barH);
      // Anchored at the outside edge; it drains toward the timer's side.
      const fill = (k: number, style: string | CanvasGradient) => {
        ctx.fillStyle = style;
        const w = barW * k;
        ctx.fillRect(left ? x0 : x0 + barW - w, top, w, barH);
      };
      fill(tr, '#c1121f');
      const g = ctx.createLinearGradient(0, top, 0, top + barH);
      g.addColorStop(0, '#fff3a3');
      g.addColorStop(0.45, '#ffd60a');
      g.addColorStop(1, '#c99700');
      fill(hp, g);
      ctx.strokeStyle = ff.fb ? `rgba(239,68,68,${0.5 + pulse * 0.5})` : '#b08d3a';
      ctx.lineWidth = ff.fb ? 3 : 2;
      ctx.strokeRect(x0 - 1, top - 1, barW + 2, barH + 2);

      const fighter = FIGHTERS[meta.picks[s]];
      ctx.font = `22px ${ANNOUNCE_FONT}`;
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.lineWidth = 4;
      const nx = left ? x0 : x0 + barW;
      ctx.strokeText(fighter.name.toUpperCase(), nx, top + barH + 26);
      ctx.fillText(fighter.name.toUpperCase(), nx, top + barH + 26);
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillText(meta.names[s], nx, top + barH + 44);

      // Round medallions, by the timer.
      for (let i = 0; i < meta.roundsToWin; i++) {
        const mx = left ? x0 + barW - 12 - i * 24 : x0 + 12 + i * 24;
        const my = top + barH + 16;
        const won = i < f.w[left ? 0 : 1];
        ctx.fillStyle = won ? '#fbbf24' : 'rgba(0,0,0,.6)';
        ctx.strokeStyle = won ? '#fff7d6' : '#b08d3a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mx, my, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (won) {
          ctx.fillStyle = '#7c2d12';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('◆', mx, my + 4);
          ctx.textAlign = left ? 'left' : 'right';
        }
      }

      // Meter, two bars, along the bottom.
      const segW = 110;
      const my = VIEW_H - 26;
      for (let i = 0; i < 2; i++) {
        const k = clamp((ff.me - i * METER_BAR) / METER_BAR, 0, 1);
        const sx = left ? 40 + i * (segW + 6) : VIEW_W - 40 - segW - i * (segW + 6);
        ctx.fillStyle = 'rgba(0,0,0,.65)';
        ctx.fillRect(sx - 2, my - 2, segW + 4, 14);
        ctx.fillStyle = k >= 1 ? '#38bdf8' : '#1e6a94';
        const w = segW * k;
        ctx.fillRect(left ? sx : sx + segW - w, my, w, 10);
        if (k >= 1) {
          ctx.fillStyle = `rgba(224,242,254,${0.3 + pulse * 0.3})`;
          ctx.fillRect(sx, my, segW, 3);
        }
      }
      if (ff.fb) {
        ctx.font = `16px ${ANNOUNCE_FONT}`;
        ctx.fillStyle = `rgba(248,113,113,${0.6 + pulse * 0.4})`;
        ctx.textAlign = left ? 'left' : 'right';
        ctx.fillText('FATAL BLOW READY', left ? 40 : VIEW_W - 40, my - 10);
      }

      // Live combo count, on the attacker's side.
      const victim = f[other(s)];
      if (victim.cb >= 2) {
        ctx.font = `30px ${ANNOUNCE_FONT}`;
        ctx.textAlign = left ? 'left' : 'right';
        ctx.fillStyle = '#fde68a';
        ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.lineWidth = 5;
        const t = `${victim.cb} HITS`;
        ctx.strokeText(t, left ? 40 : VIEW_W - 40, 190);
        ctx.fillText(t, left ? 40 : VIEW_W - 40, 190);
      }
    }

    // Timer.
    ctx.fillStyle = 'rgba(0,0,0,.75)';
    ctx.fillRect(VIEW_W / 2 - 38, 14, 76, 56);
    ctx.strokeStyle = '#b08d3a';
    ctx.lineWidth = 2;
    ctx.strokeRect(VIEW_W / 2 - 38, 14, 76, 56);
    ctx.font = `42px ${ANNOUNCE_FONT}`;
    ctx.textAlign = 'center';
    const secs = Math.ceil(f.tm / 60);
    ctx.fillStyle = secs <= 10 && f.p === 'fighting' ? '#f87171' : '#fff';
    ctx.fillText(String(secs).padStart(2, '0'), VIEW_W / 2, 60);

    // The combo that just finished, with its damage.
    const c = this.combo;
    if (c) {
      const age = performance.now() - c.start;
      if (age > 1600) this.combo = null;
      else {
        const left = c.side === 'a';
        ctx.globalAlpha = Math.min(1, (1600 - age) / 300);
        ctx.textAlign = left ? 'left' : 'right';
        ctx.font = `26px ${ANNOUNCE_FONT}`;
        ctx.fillStyle = '#fde68a';
        ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.lineWidth = 5;
        const x = left ? 40 : VIEW_W - 40;
        const t1 = `${c.hits} HIT COMBO`;
        const t2 = `${Math.round((c.dmg / MAX_HEALTH) * 100)}% DAMAGE`;
        ctx.strokeText(t1, x, 150);
        ctx.fillText(t1, x, 150);
        ctx.font = `18px ${ANNOUNCE_FONT}`;
        ctx.strokeText(t2, x, 172);
        ctx.fillText(t2, x, 172);
        ctx.globalAlpha = 1;
      }
    }
    ctx.textAlign = 'left';
  }

  private drawBanners(ctx: CanvasRenderingContext2D): void {
    const now = performance.now();
    this.banners = this.banners.filter((b) => now - b.start < b.dur);
    for (const b of this.banners) {
      const age = now - b.start;
      const t = age / b.dur;
      const pop = age < 160 ? 1.6 - (age / 160) * 0.6 : 1;
      const alpha = t > 0.8 ? (1 - t) / 0.2 : 1;
      const small = b.style === 'small';
      const size = small ? 34 : b.text.length > 12 ? 72 : 96;
      const y = small ? 250 : 300;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(VIEW_W / 2, y);
      ctx.scale(pop, pop);
      ctx.font = `${size}px ${ANNOUNCE_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = small ? 6 : 10;
      ctx.strokeStyle = 'rgba(10,4,2,.9)';
      ctx.strokeText(b.text, 0, 0);
      const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
      if (b.style === 'red') {
        g.addColorStop(0, '#ff6b6b');
        g.addColorStop(0.5, '#d00000');
        g.addColorStop(1, '#6a040f');
      } else {
        g.addColorStop(0, '#fff7d6');
        g.addColorStop(0.5, '#fbbf24');
        g.addColorStop(1, '#b45309');
      }
      ctx.fillStyle = small ? '#fde68a' : g;
      ctx.fillText(b.text, 0, 0);
      if (b.style === 'red' && !small) {
        // Drips.
        ctx.fillStyle = '#9d0208';
        const w = ctx.measureText(b.text).width;
        for (let i = 0; i < 7; i++) {
          const dx = -w / 2 + ((i * 97) % w);
          const len = Math.min(40, age / 30) * (0.4 + ((i * 37) % 10) / 10);
          ctx.fillRect(dx, size * 0.32, 4, len);
          ctx.beginPath();
          ctx.arc(dx + 2, size * 0.32 + len, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (b.sub) {
        ctx.font = `28px ${ANNOUNCE_FONT}`;
        ctx.lineWidth = 5;
        ctx.strokeText(b.sub, 0, size * 0.75);
        ctx.fillStyle = '#fde68a';
        ctx.fillText(b.sub, 0, size * 0.75);
      }
      ctx.restore();
    }
  }
}

/** A head, with each fighter's mask, hat, scarf or ponytail. Shared with the
 *  lobby's portraits. `phase` offsets the scarf's flutter. */
export function drawHead(
  ctx: CanvasRenderingContext2D, id: FighterId, h: { x: number; y: number },
  neck: { x: number; y: number }, facing: number, color: string, clock: number, phase = 0,
): void {
  const r = LEN.head;
  // Things that sit behind the head.
  if (id === 'ember') {
    ctx.strokeStyle = shade(color.startsWith('#') ? color : '#f97316', 0.8);
    ctx.lineWidth = 4;
    const wave = Math.sin(clock * 0.2 + phase) * 6;
    ctx.beginPath();
    ctx.moveTo(neck.x, neck.y);
    ctx.quadraticCurveTo(neck.x - facing * 20, neck.y + 4 + wave, neck.x - facing * 38, neck.y + 10 - wave);
    ctx.stroke();
  }
  if (id === 'vex') {
    ctx.strokeStyle = '#1e1b2e';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(h.x - facing * 8, h.y - 6);
    ctx.quadraticCurveTo(h.x - facing * 26, h.y + 4, h.x - facing * 22, h.y + 26 + Math.sin(clock * 0.1) * 3);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(10,6,4,.85)';
  ctx.beginPath();
  ctx.arc(h.x, h.y, r + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
  ctx.fill();

  if (id === 'volt') {
    ctx.fillStyle = '#d9c38a';
    ctx.strokeStyle = 'rgba(10,6,4,.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(h.x - 30, h.y - 6);
    ctx.lineTo(h.x, h.y - 26);
    ctx.lineTo(h.x + 30, h.y - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e0f2fe';
    ctx.shadowColor = '#7dd3fc';
    ctx.shadowBlur = 8;
    ctx.fillRect(h.x + facing * 3 - 2, h.y + 1, 4, 3);
    ctx.fillRect(h.x + facing * 9 - 2, h.y + 1, 4, 3);
    ctx.shadowBlur = 0;
    return;
  }
  // A ninja mask band with the eyes showing through.
  ctx.fillStyle = id === 'vex' ? '#2e1065' : '#111';
  ctx.fillRect(h.x - r, h.y - 3, r * 2, 7);
  ctx.fillStyle = id === 'rime' ? '#e0fbff' : '#fff';
  if (id === 'rime') {
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 8;
  }
  ctx.fillRect(h.x + facing * 3 - 2, h.y - 1, 4, 3);
  ctx.fillRect(h.x + facing * 9 - 2, h.y - 1, 4, 3);
  ctx.shadowBlur = 0;
}

/** The arena: painted once to an offscreen canvas and reused every frame. */
function paintStage(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = VIEW_W;
  c.height = VIEW_H;
  const ctx = c.getContext('2d')!;

  const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#1a0b1e');
  sky.addColorStop(0.55, '#4a1020');
  sky.addColorStop(1, '#8a2a12');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, GROUND);

  // Moon.
  const moon = ctx.createRadialGradient(860, 150, 10, 860, 150, 140);
  moon.addColorStop(0, 'rgba(255,236,200,.95)');
  moon.addColorStop(0.35, 'rgba(255,200,150,.55)');
  moon.addColorStop(1, 'rgba(255,160,120,0)');
  ctx.fillStyle = moon;
  ctx.fillRect(700, 0, 320, 320);
  ctx.fillStyle = '#ffe8c2';
  ctx.beginPath();
  ctx.arc(860, 150, 46, 0, Math.PI * 2);
  ctx.fill();

  // Far mountains.
  ctx.fillStyle = '#2a0c18';
  ctx.beginPath();
  ctx.moveTo(0, 380);
  const peaks = [[80, 300], [190, 350], [300, 260], [420, 340], [540, 290], [680, 360], [790, 280], [930, 340], [1060, 270], [1200, 330]];
  for (const [x, y] of peaks) ctx.lineTo(x!, y!);
  ctx.lineTo(VIEW_W, GROUND);
  ctx.lineTo(0, GROUND);
  ctx.fill();

  // Temple: pillars and a roofline in silhouette.
  ctx.fillStyle = '#12060c';
  for (const x of [70, 230, 970, 1130]) {
    ctx.fillRect(x - 18, 210, 36, GROUND - 210);
    ctx.fillRect(x - 28, 200, 56, 16);
    ctx.fillRect(x - 28, GROUND - 24, 56, 24);
  }
  ctx.beginPath();
  ctx.moveTo(10, 205);
  ctx.lineTo(290, 205);
  ctx.lineTo(260, 180);
  ctx.lineTo(40, 180);
  ctx.closePath();
  ctx.moveTo(910, 205);
  ctx.lineTo(1190, 205);
  ctx.lineTo(1160, 180);
  ctx.lineTo(940, 180);
  ctx.closePath();
  ctx.fill();
  // Torch stands.
  for (const x of [150, 1050]) {
    ctx.fillRect(x - 4, 305, 8, GROUND - 305);
    ctx.fillRect(x - 14, 300, 28, 8);
  }

  // Floor.
  const floor = ctx.createLinearGradient(0, GROUND - 40, 0, VIEW_H);
  floor.addColorStop(0, '#3b1f16');
  floor.addColorStop(1, '#140806');
  ctx.fillStyle = floor;
  ctx.fillRect(0, GROUND - 30, VIEW_W, VIEW_H - GROUND + 30);
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const y = GROUND - 30 + i * i * 7 + 8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(VIEW_W, y);
    ctx.stroke();
  }
  for (let x = -600; x <= VIEW_W + 600; x += 90) {
    ctx.beginPath();
    ctx.moveTo(VIEW_W / 2 + (x - VIEW_W / 2) * 0.55, GROUND - 30);
    ctx.lineTo(x, VIEW_H);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,140,60,.08)';
  ctx.fillRect(0, GROUND - 30, VIEW_W, 3);
  return c;
}
