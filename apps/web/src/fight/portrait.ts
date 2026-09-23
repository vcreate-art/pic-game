import { FIGHTERS, type FighterId } from '@pic-game/shared';
import { drawHead, shade } from './renderer.js';
import { BONES, STANCE, joints, with_ } from './skeleton.js';

/**
 * A fighter standing in their stance, for the select screen. Small enough to
 * draw every frame for four cards at once.
 */
export function drawPortrait(canvas: HTMLCanvasElement, id: FighterId, clock: number, facing: 1 | -1 = 1): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  // The figure is about 210 tall; fit it with a little headroom for Volt's hat.
  const scale = (h / 240) * dpr;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const vw = w / (h / 240);
  const ground = 228;
  const bob = Math.sin(clock * 0.09) * 2.2;
  const pose = with_(STANCE, { hip: STANCE.hip + bob, fe: STANCE.fe + bob * 2, be: STANCE.be - bob * 2 });
  const j = joints(pose, vw / 2, 0, facing);
  const low = Math.min(j.fFoot.y, j.bFoot.y);
  const P = (k: keyof typeof j) => ({ x: j[k].x, y: ground - (j[k].y - low) });

  const color = FIGHTERS[id].color;
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse(vw / 2, ground + 4, 38, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of ['outline', 'fill'] as const) {
    for (const [p, q, layer] of BONES) {
      const a = P(p);
      const b = P(q);
      ctx.strokeStyle = pass === 'outline' ? 'rgba(10,6,4,.85)' : layer === 'back' ? shade(color, 0.62) : color;
      ctx.lineWidth = (layer === 'body' ? 10 : 8) + (pass === 'outline' ? 4 : 0);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  drawHead(ctx, id, P('head'), P('neck'), facing, color, clock);
}
