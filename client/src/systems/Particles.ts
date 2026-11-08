import { rand, TAU } from '../core/math';
import type { CasingKind, Halo, WeaponFx } from '../render/visuals';

/** Casings and bullet holes fade out instead of staining the floor forever. */
const DECAL_LIFE = 18;
const DECAL_FADE = 3;
const MAX_TIMED_DECALS = 300;
const CASING_COLORS: Record<CasingKind, string> = { brass: '#c9a24a', shell: '#a8322a' };

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  /** Leave a stain on the floor when it dies. */
  stain: boolean;
}

interface Tracer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
  /** "r, g, b" */
  color: string;
  width: number;
  halo: Halo | null;
}

interface Casing {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  life: number;
  kind: CasingKind;
}

interface TimedDecal {
  x: number;
  y: number;
  angle: number;
  kind: CasingKind | 'hole';
  life: number;
}

interface Ring {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  /** "r, g, b" */
  color: string;
}

interface FloatText {
  text: string;
  x: number;
  y: number;
  life: number;
  color: string;
}

const BLOOD = ['#6e0a0a', '#7f0d0d', '#560707'];

export class Particles {
  private parts: Particle[] = [];
  private tracers: Tracer[] = [];
  private casings: Casing[] = [];
  private timedDecals: TimedDecal[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];
  private decals: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;

  constructor(w: number, h: number) {
    this.decals = document.createElement('canvas');
    this.decals.width = w;
    this.decals.height = h;
    this.dctx = this.decals.getContext('2d')!;
  }

  blood(x: number, y: number, angle: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-0.6, 0.6);
      const s = rand(40, 180);
      this.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.15, 0.4), maxLife: 0.4, size: rand(1.5, 3.5),
        color: BLOOD[i % BLOOD.length], stain: true,
      });
    }
  }

  bloodPool(x: number, y: number): void {
    const c = this.dctx;
    for (let i = 0; i < 7; i++) {
      c.fillStyle = BLOOD[i % BLOOD.length];
      c.globalAlpha = rand(0.5, 0.85);
      c.beginPath();
      c.arc(x + rand(-10, 10), y + rand(-10, 10), rand(4, 11), 0, TAU);
      c.fill();
    }
    c.globalAlpha = 1;
  }

  /** A bullet hitting a wall: sparks and dust thrown back along `angle`, and a hole that fades. */
  impact(x: number, y: number, angle: number, color: string): void {
    for (let i = 0; i < 7; i++) {
      const a = angle + rand(-1.1, 1.1);
      const s = rand(60, 200);
      this.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.08, 0.22), maxLife: 0.22, size: 1.5, color: `rgb(${color})`, stain: false,
      });
    }
    for (let i = 0; i < 3; i++) {
      const a = angle + rand(-0.7, 0.7);
      const s = rand(10, 40);
      this.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.3, 0.5), maxLife: 0.5, size: rand(3, 5), color: 'rgba(150, 140, 125, 0.5)', stain: false,
      });
    }
    this.addTimedDecal({ x, y, angle: 0, kind: 'hole', life: DECAL_LIFE });
  }

  /** Eject a casing to the right of the aim direction. */
  casing(x: number, y: number, aim: number, kind: CasingKind): void {
    const a = aim + Math.PI / 2 + rand(-0.4, 0.4);
    const s = rand(70, 120);
    this.casings.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      angle: rand(0, TAU), spin: rand(-20, 20), life: rand(0.35, 0.5), kind,
    });
  }

  ring(x: number, y: number, radius: number, color: string): void {
    this.rings.push({ x, y, radius, life: 0.3, maxLife: 0.3, color });
  }

  private addTimedDecal(d: TimedDecal): void {
    this.timedDecals.push(d);
    if (this.timedDecals.length > MAX_TIMED_DECALS) this.timedDecals.shift();
  }

  debris(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      const a = rand(0, TAU);
      const s = rand(30, 140);
      this.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.3, 0.6), maxLife: 0.6, size: rand(2, 4), color: '#7a5630', stain: false,
      });
    }
  }

  tracer(x1: number, y1: number, x2: number, y2: number, fx: WeaponFx, halo: Halo | null): void {
    this.tracers.push({ x1, y1, x2, y2, life: fx.life, maxLife: fx.life, color: fx.tracer, width: fx.width, halo });
  }

  explosion(x: number, y: number, color: string): void {
    for (let i = 0; i < 24; i++) {
      const a = rand(0, TAU);
      const s = rand(60, 260);
      this.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.2, 0.5), maxLife: 0.5, size: rand(2, 5), color, stain: false,
      });
    }
    this.dctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    this.dctx.beginPath();
    this.dctx.arc(x, y, 22, 0, TAU);
    this.dctx.fill();
  }

  text(text: string, x: number, y: number, color = '#f2d15c'): void {
    this.texts.push({ text, x: x + rand(-6, 6), y, life: 0.9, color });
  }

  update(dt: number): void {
    for (const p of this.parts) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = Math.exp(-dt * 8);
      p.vx *= drag;
      p.vy *= drag;
      p.life -= dt;
      if (p.life <= 0 && p.stain) {
        this.dctx.fillStyle = p.color;
        this.dctx.globalAlpha = 0.7;
        this.dctx.fillRect(p.x, p.y, p.size, p.size);
        this.dctx.globalAlpha = 1;
      }
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
    for (const c of this.casings) {
      const drag = Math.exp(-dt * 6);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.vx *= drag;
      c.vy *= drag;
      c.angle += c.spin * dt;
      c.life -= dt;
      if (c.life <= 0) this.addTimedDecal({ x: c.x, y: c.y, angle: c.angle, kind: c.kind, life: DECAL_LIFE });
    }
    this.casings = this.casings.filter((c) => c.life > 0);
    for (const d of this.timedDecals) d.life -= dt;
    this.timedDecals = this.timedDecals.filter((d) => d.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 30 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  drawDecals(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.decals, 0, 0);
    for (const d of this.timedDecals) {
      ctx.globalAlpha = Math.min(1, d.life / DECAL_FADE);
      if (d.kind === 'hole') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.beginPath();
        ctx.arc(d.x, d.y, 1.8, 0, TAU);
        ctx.fill();
      } else {
        drawCasing(ctx, d.x, d.y, d.angle, d.kind);
      }
    }
    ctx.globalAlpha = 1;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.parts) {
      ctx.globalAlpha = Math.min(1, p.life / p.maxLife + 0.3);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    for (const c of this.casings) drawCasing(ctx, c.x, c.y, c.angle, c.kind);
  }

  /** Tracers and shockwaves, drawn after the lighting overlay so they glow in the dark. */
  drawGlow(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const t of this.tracers) {
      const a = t.life / t.maxLife;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.strokeStyle = t.halo ? `rgba(${t.halo.color}, ${a * 0.45})` : `rgba(${t.color}, ${a * 0.25})`;
      ctx.lineWidth = t.halo ? t.halo.width : t.width * 3.5;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${t.color}, ${a})`;
      ctx.lineWidth = t.width;
      ctx.stroke();
    }
    for (const r of this.rings) {
      const t = 1 - r.life / r.maxLife;
      ctx.strokeStyle = `rgba(${r.color}, ${(1 - t) * 0.8})`;
      ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * (0.2 + 0.8 * t), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTexts(ctx: CanvasRenderingContext2D): void {
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.life * 2);
      ctx.fillStyle = '#000';
      ctx.fillText(t.text, t.x + 1, t.y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}

function drawCasing(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, kind: CasingKind): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (kind === 'shell') {
    ctx.fillStyle = CASING_COLORS.shell;
    ctx.fillRect(-3, -1.5, 5, 3);
    ctx.fillStyle = CASING_COLORS.brass;
    ctx.fillRect(2, -1.5, 1.5, 3);
  } else {
    ctx.fillStyle = CASING_COLORS.brass;
    ctx.fillRect(-1.5, -0.8, 3, 1.6);
  }
  ctx.restore();
}
