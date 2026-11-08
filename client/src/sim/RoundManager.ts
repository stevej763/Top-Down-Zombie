import { clamp } from '../core/math';
import type { GameSim } from './GameSim';
import { TILE } from './TileMap';
import { Zombie } from './Zombie';

export const MAX_ALIVE = 24;
const INTERMISSION = 10;
const FIRST_ROUND_DELAY = 3;

// Health grows linearly up to LINEAR_ROUNDS, then by a percentage each round after.
const BASE_HEALTH = 150;
const HEALTH_PER_ROUND = 60;
const LINEAR_ROUNDS = 9;
const LATE_HEALTH_GROWTH = 1.07;

export function zombieHealth(r: number): number {
  if (r <= LINEAR_ROUNDS) return BASE_HEALTH + HEALTH_PER_ROUND * (r - 1);
  const peak = BASE_HEALTH + HEALTH_PER_ROUND * (LINEAR_ROUNDS - 1);
  return Math.round(peak * Math.pow(LATE_HEALTH_GROWTH, r - LINEAR_ROUNDS));
}

export function zombieCount(r: number): number {
  return r < 10 ? 6 + 3 * (r - 1) : 30 + 5 * (r - 9);
}

export function runnerChance(r: number): number {
  return clamp((r - 3) * 0.1, 0, 0.7);
}

export function zombieDamage(r: number): number {
  return 50 + Math.min(r - 1, 20);
}

function tearInterval(r: number): number {
  return Math.max(0.7, 1.5 - r * 0.06);
}

function spawnInterval(r: number): number {
  return Math.max(0.4, 2.0 - r * 0.1);
}

export class RoundManager {
  round = 0;
  active = false;
  toSpawn = 0;
  intermission = FIRST_ROUND_DELAY;
  private spawnTimer = 0;

  remaining(game: GameSim): number {
    return this.toSpawn + game.zombies.length;
  }

  update(dt: number, game: GameSim): void {
    if (!this.active) {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startRound(game);
      return;
    }

    this.spawnTimer -= dt;
    if (this.toSpawn > 0 && this.spawnTimer <= 0 && game.zombies.length < MAX_ALIVE) {
      this.spawn(game);
      this.toSpawn--;
      this.spawnTimer = spawnInterval(this.round) * game.rng.range(0.7, 1.3);
    }

    if (this.toSpawn === 0 && game.zombies.length === 0) {
      this.active = false;
      this.intermission = INTERMISSION;
      game.emit({ type: 'roundEnd', round: this.round });
    }
  }

  private startRound(game: GameSim): void {
    this.round++;
    this.active = true;
    this.toSpawn = zombieCount(this.round);
    this.spawnTimer = 0.5;
    game.economy.resetRound();
    game.powerUps.resetRound();
    game.emit({ type: 'roundStart', round: this.round });
  }

  private spawn(game: GameSim): void {
    const r = this.round;
    // Only windows in rooms the player has opened, so every zombie can reach them.
    const open = game.barricades.filter((w) => game.openRooms.has(w.def.room));
    const b = game.rng.pick(open);
    const lateral = game.rng.range(-TILE, TILE);
    const x = b.spawnPoint.x + (b.horizontal ? lateral : 0);
    const y = b.spawnPoint.y + (b.horizontal ? 0 : lateral);
    const runner = game.rng.next() < runnerChance(r);
    const speed = (runner ? game.rng.range(110, 128) : game.rng.range(42, 58)) * (1 + Math.min(r, 20) * 0.01);
    game.zombies.push(new Zombie(game.nextId(), b, x, y, zombieHealth(r), speed, zombieDamage(r), runner, tearInterval(r)));
  }
}
