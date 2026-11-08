import { dist, rand, TAU } from '../core/math';
import type { Game } from '../core/Game';
import { Player } from '../entities/Player';

export type PowerUpId = 'ammo' | 'instakill' | 'double' | 'nuke';

export const POWERUPS: Record<PowerUpId, { name: string; label: string; color: string }> = {
  ammo: { name: 'Full Ammo', label: 'A', color: '#5ad15a' },
  instakill: { name: 'Instakill', label: 'K', color: '#e04040' },
  double: { name: 'Double Points', label: '2x', color: '#f2d15c' },
  nuke: { name: 'Detonation', label: 'N', color: '#ff8a30' },
};
const IDS = Object.keys(POWERUPS) as PowerUpId[];

const DROP_CHANCE = 0.03;
const MAX_PER_ROUND = 4;
const LIFETIME = 25;
export const POWERUP_DURATION = 20;
const PICKUP_RADIUS = 24;

interface Drop {
  id: PowerUpId;
  x: number;
  y: number;
  life: number;
}

export class PowerUps {
  drops: Drop[] = [];
  /** Seconds remaining on timed power-ups. */
  instakill = 0;
  double = 0;
  private droppedThisRound = 0;

  resetRound(): void {
    this.droppedThisRound = 0;
  }

  maybeDrop(x: number, y: number): void {
    if (this.droppedThisRound >= MAX_PER_ROUND || Math.random() > DROP_CHANCE) return;
    this.droppedThisRound++;
    this.drops.push({ id: IDS[Math.floor(rand(0, IDS.length))], x, y, life: LIFETIME });
  }

  update(dt: number, game: Game): void {
    this.instakill = Math.max(0, this.instakill - dt);
    this.double = Math.max(0, this.double - dt);
    const p = game.player;
    for (const d of this.drops) {
      d.life -= dt;
      if (dist(d.x, d.y, p.x, p.y) < PICKUP_RADIUS + Player.RADIUS) {
        d.life = 0;
        game.applyPowerUp(d.id);
      }
    }
    this.drops = this.drops.filter((d) => d.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D, time: number): void {
    for (const d of this.drops) {
      if (d.life < 5 && Math.floor(time * 6) % 2 === 0) continue;
      const def = POWERUPS[d.id];
      const y = d.y + Math.sin(time * 3 + d.x) * 3;
      const g = ctx.createRadialGradient(d.x, y, 0, d.x, y, 34);
      g.addColorStop(0, def.color);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = g;
      ctx.fillRect(d.x - 34, y - 34, 68, 68);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#111';
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(d.x, y, 13, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = def.color;
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.label, d.x, y + 1);
    }
  }
}
