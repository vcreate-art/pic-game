/**
 * Everything that flies about and is purely for show: blood, sparks, ice,
 * embers, and the pieces of a fighter after a fatality. None of it is in the
 * sim, so none of it goes over the wire; each client makes its own from the
 * events it receives. Two screens will not match drop for drop, and nobody
 * could ever tell.
 */

export type Kind = 'blood' | 'spark' | 'ice' | 'ember' | 'bolt' | 'smoke';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface Splat {
  x: number;
  w: number;
  age: number;
  color: string;
}

/** A severed piece of stick figure: a segment spinning through the air. */
export interface Gib {
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  len: number;
  width: number;
  color: string;
  /** Drawn as a head rather than a line. */
  head?: boolean;
  /** Leaves a trail of blood while it flies. */
  bleeds: boolean;
  resting: boolean;
}

const GRAVITY = 0.45;
const BLOOD = ['#9f0712', '#b3001b', '#7a0010', '#c8102e'];

export class Particles {
  private ps: Particle[] = [];
  private splats: Splat[] = [];
  gibs: Gib[] = [];

  clear(): void {
    this.ps = [];
    this.splats = [];
    this.gibs = [];
  }

  /** Clears the floor between rounds but keeps anything still in flight. */
  clearFloor(): void {
    this.splats = [];
    this.gibs = [];
  }

  burst(kind: Kind, x: number, y: number, n: number, dir: number, force = 1): void {
    for (let i = 0; i < n; i++) {
      const spread = Math.random() * 2 - 1;
      const speed = (2 + Math.random() * 6) * force;
      const p: Particle = {
        kind, x, y,
        vx: dir * speed * (0.5 + Math.random()) + spread * 1.5,
        vy: 2 + Math.random() * 5 * force + spread,
        life: 0,
        max: 30 + Math.random() * 30,
        size: 2 + Math.random() * 3,
        color: BLOOD[i % BLOOD.length]!,
      };
      switch (kind) {
        case 'spark':
          p.max = 10 + Math.random() * 10;
          p.color = Math.random() < 0.5 ? '#fff7cc' : '#ffd166';
          p.size = 2;
          break;
        case 'ice':
          p.color = Math.random() < 0.5 ? '#e0fbff' : '#67e8f9';
          p.size = 3 + Math.random() * 3;
          break;
        case 'ember':
          p.color = Math.random() < 0.5 ? '#fb923c' : '#fde047';
          p.vy = 1 + Math.random() * 3;
          p.max = 25 + Math.random() * 25;
          break;
        case 'bolt':
          p.color = Math.random() < 0.5 ? '#fef08a' : '#e0f2fe';
          p.max = 8 + Math.random() * 10;
          p.size = 2;
          break;
        case 'smoke':
          p.color = 'rgba(60,60,70,.5)';
          p.vy = 0.5 + Math.random();
          p.vx *= 0.2;
          p.size = 8 + Math.random() * 10;
          p.max = 50;
          break;
      }
      this.ps.push(p);
    }
    if (this.ps.length > 1500) this.ps.splice(0, this.ps.length - 1500);
  }

  /** A column of blood, for a neck or a waist that no longer has anything on it. */
  fountain(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.ps.push({
        kind: 'blood', x, y,
        vx: (Math.random() - 0.5) * 3,
        vy: 6 + Math.random() * 6,
        life: 0, max: 60, size: 2 + Math.random() * 3,
        color: BLOOD[i % BLOOD.length]!,
      });
    }
  }

  update(): void {
    for (const p of this.ps) {
      p.life++;
      p.x += p.vx;
      p.y += p.vy;
      if (p.kind === 'blood' || p.kind === 'ice' || p.kind === 'spark') p.vy -= GRAVITY;
      else if (p.kind === 'ember' || p.kind === 'smoke') p.vy += 0.03;
      if (p.kind === 'blood' && p.y <= 0) {
        p.life = p.max;
        if (this.splats.length < 260) {
          this.splats.push({ x: p.x, w: 4 + Math.random() * 10, age: 0, color: p.color });
        }
      }
      if (p.y < -4) p.life = p.max;
    }
    this.ps = this.ps.filter((p) => p.life < p.max);
    for (const s of this.splats) s.age++;

    for (const g of this.gibs) {
      if (g.resting) continue;
      g.x += g.vx;
      g.y += g.vy;
      g.a += g.va;
      g.vy -= GRAVITY;
      if (g.bleeds && Math.random() < 0.6) {
        this.ps.push({
          kind: 'blood', x: g.x, y: g.y, vx: g.vx * 0.2, vy: 0, life: 0, max: 40, size: 2.5,
          color: BLOOD[0]!,
        });
      }
      if (g.y <= (g.head ? 13 : 3)) {
        g.y = g.head ? 13 : 3;
        g.vy = Math.abs(g.vy) > 3 ? -g.vy * 0.3 : 0;
        g.vx *= 0.6;
        g.va *= 0.5;
        if (Math.abs(g.vy) < 0.5 && Math.abs(g.vx) < 0.3) {
          g.resting = true;
          // Laid flat on the floor rather than balanced on an end.
          g.a = Math.round(g.a / Math.PI) * Math.PI;
        }
      }
    }
  }

  /** Floor stains: drawn under the fighters. */
  drawFloor(ctx: CanvasRenderingContext2D, toY: (y: number) => number): void {
    for (const s of this.splats) {
      ctx.globalAlpha = Math.max(0.25, 0.85 - s.age / 1200);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.ellipse(s.x, toY(0) + 3, s.w, s.w * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  draw(ctx: CanvasRenderingContext2D, toY: (y: number) => number): void {
    for (const g of this.gibs) {
      ctx.save();
      ctx.translate(g.x, toY(g.y));
      ctx.rotate(-g.a);
      if (g.head) {
        ctx.fillStyle = g.color;
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = g.color;
        ctx.lineWidth = g.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-g.len / 2, 0);
        ctx.lineTo(g.len / 2, 0);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const p of this.ps) {
      const k = 1 - p.life / p.max;
      ctx.globalAlpha = p.kind === 'blood' ? 1 : Math.max(0, k);
      ctx.fillStyle = p.color;
      const y = toY(p.y);
      if (p.kind === 'spark' || p.kind === 'bolt') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, y);
        ctx.lineTo(p.x - p.vx * 2, y + p.vy * 2);
        ctx.stroke();
      } else if (p.kind === 'ice') {
        ctx.save();
        ctx.translate(p.x, y);
        ctx.rotate(p.life * 0.2);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, y, p.kind === 'smoke' ? p.size * (1 + p.life / 30) : p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
