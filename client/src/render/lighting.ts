import type { Game } from '../core/Game';
import { glowOf, WEAPON_FX } from './visuals';

const DARKNESS = 'rgba(4, 5, 10, 0.86)';
const FLASHLIGHT_RANGE = 430;
const FLASHLIGHT_HALF_ANGLE = 0.5;

/** Darkness overlay with lights punched out of it (player glow, flashlight cone, windows). */
export class Lighting {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(private w: number, private h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
  }

  draw(target: CanvasRenderingContext2D, game: Game, camX: number, camY: number): void {
    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = DARKNESS;
    c.fillRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'destination-out';

    const sim = game.sim;
    const p = sim.player;
    const flash = game.playerFx.flash > 0;
    const px = p.x - camX;
    const py = p.y - camY;
    this.glow(px, py, 150, 0.95);

    const g = c.createRadialGradient(px, py, 20, px, py, FLASHLIGHT_RANGE);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
    g.addColorStop(0.7, 'rgba(0, 0, 0, 0.6)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(px, py);
    c.arc(px, py, FLASHLIGHT_RANGE, p.aim - FLASHLIGHT_HALF_ANGLE, p.aim + FLASHLIGHT_HALF_ANGLE);
    c.closePath();
    c.fill();

    for (const b of sim.barricades) this.glow(b.center.x - camX, b.center.y - camY, 110, 0.55);
    for (const it of sim.interactables) {
      if (glowOf(it)) this.glow(it.standX - camX, it.standY - camY, 60, 0.45);
    }
    for (const d of sim.powerUps.drops) this.glow(d.x - camX, d.y - camY, 70, 0.6);
    if (flash) this.glow(px, py, 260, 0.7);

    target.drawImage(this.canvas, 0, 0);

    // Coloured light from machines, added on top of the darkness.
    target.save();
    target.globalCompositeOperation = 'lighter';
    for (const it of sim.interactables) {
      const glow = glowOf(it);
      if (!glow) continue;
      const x = it.standX - camX;
      const y = it.standY - camY;
      const g = target.createRadialGradient(x, y, 0, x, y, 70);
      g.addColorStop(0, `rgba(${glow}, 0.22)`);
      g.addColorStop(1, `rgba(${glow}, 0)`);
      target.fillStyle = g;
      target.fillRect(x - 70, y - 70, 140, 140);
    }
    if (flash) {
      // Muzzle light in the gun's own colour.
      const fx = WEAPON_FX[p.weapon.def.id];
      const md = 24 + fx.barrel;
      const x = px + Math.cos(p.aim) * md;
      const y = py + Math.sin(p.aim) * md;
      const r = 110 * fx.flashSize;
      const g = target.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${fx.flash}, 0.35)`);
      g.addColorStop(1, `rgba(${fx.flash}, 0)`);
      target.fillStyle = g;
      target.fillRect(x - r, y - r, r * 2, r * 2);
    }
    target.restore();
  }

  private glow(x: number, y: number, r: number, strength: number): void {
    const c = this.ctx;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0, 0, 0, ${strength})`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
