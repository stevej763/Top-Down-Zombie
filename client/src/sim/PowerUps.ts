import { dist } from '../core/math';
import { POWERUP_IDS, POWERUP_TUNING, type PowerUpId } from './defs';
import type { GameSim } from './GameSim';
import { Player } from './Player';

export interface Drop {
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

  maybeDrop(sim: GameSim, x: number, y: number): void {
    if (this.droppedThisRound >= POWERUP_TUNING.maxPerRound || sim.rng.next() > POWERUP_TUNING.dropChance) return;
    this.droppedThisRound++;
    this.drops.push({ id: sim.rng.pick(POWERUP_IDS), x, y, life: POWERUP_TUNING.lifetime });
  }

  update(dt: number, sim: GameSim): void {
    this.instakill = Math.max(0, this.instakill - dt);
    this.double = Math.max(0, this.double - dt);
    const p = sim.player;
    for (const d of this.drops) {
      d.life -= dt;
      if (dist(d.x, d.y, p.x, p.y) < POWERUP_TUNING.pickupRadius + Player.RADIUS) {
        d.life = 0;
        sim.applyPowerUp(d.id);
      }
    }
    this.drops = this.drops.filter((d) => d.life > 0);
  }
}
