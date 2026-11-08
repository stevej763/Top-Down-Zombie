import { angleDiff, rayCircle } from '../core/math';
import type { GameSim } from './GameSim';
import { Zombie } from './Zombie';

/** Half-angle of the assist cone. Set to 0 to disable aim assist. */
export const AIM_ASSIST_CONE = (8 * Math.PI) / 180;

/**
 * Returns the angle to actually fire at. If the raw aim already hits a zombie it's left alone
 * (so precise shots stay precise); otherwise it bends toward the zombie closest to the aim
 * line within the cone.
 */
export function aimAssist(sim: GameSim, ox: number, oy: number, aim: number, range: number): number {
  if (AIM_ASSIST_CONE <= 0) return aim;
  const dx = Math.cos(aim);
  const dy = Math.sin(aim);
  const wallD = sim.map.rayWall(ox, oy, dx, dy, range);

  let best: Zombie | null = null;
  let bestDiff = AIM_ASSIST_CONE;
  for (const z of sim.zombies) {
    if (z.dead) continue;
    const t = rayCircle(ox, oy, dx, dy, z.x, z.y, Zombie.RADIUS);
    if (t >= 0 && t <= wallD) return aim;

    const d = Math.hypot(z.x - ox, z.y - oy);
    if (d > range + Zombie.RADIUS) continue;
    const diff = Math.abs(angleDiff(aim, Math.atan2(z.y - oy, z.x - ox)));
    if (diff < bestDiff && sim.map.hasLOS(ox, oy, z.x, z.y)) {
      best = z;
      bestDiff = diff;
    }
  }
  if (!best) return aim;

  // Aim at a random point across the body rather than dead centre, so assisted shots
  // don't all count as headshots.
  const d = Math.hypot(best.x - ox, best.y - oy);
  const lateral = sim.rng.range(-0.6, 0.6) * Zombie.RADIUS;
  return Math.atan2(best.y - oy, best.x - ox) + Math.atan2(lateral, d);
}
