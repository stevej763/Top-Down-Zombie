import { rand, TAU } from '../core/math';

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

  sparks(x: number, y: number): void {
    for (let i = 0; i < 4; i++) {
      const a = rand(0, TAU);
      const s = rand(40, 120);
      this.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.08, 0.2), maxLife: 0.2, size: 1.5, color: '#ffd27a', stain: false,
      });
    }
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

  tracer(x1: number, y1: number, x2: number, y2: number, color = '255, 230, 160'): void {
    this.tracers.push({ x1, y1, x2, y2, life: 0.06, color });
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
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 30 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
  }

  drawDecals(ctx: CanvasRenderingContext2D): void {
    ctx.drawImage(this.decals, 0, 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.parts) {
      ctx.globalAlpha = Math.min(1, p.life / p.maxLife + 0.3);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    for (const t of this.tracers) {
      ctx.strokeStyle = `rgba(${t.color}, ${t.life / 0.06})`;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
    }
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
