import type { Vec2 } from '../core/math';
import type { WindowDef } from './MapData';
import type { Zombie } from './Zombie';
import { TILE } from './TileMap';

export const MAX_PLANKS = 6;

export class Barricade {
  planks = MAX_PLANKS;
  /** Zombie currently climbing through (only one at a time). */
  climber: Zombie | null = null;
  readonly center: Vec2;
  /** Where zombies stand to tear planks. */
  readonly outsidePoint: Vec2;
  /** Where zombies land after climbing in; also where the player rebuilds from. */
  readonly insidePoint: Vec2;
  readonly spawnPoint: Vec2;
  /** True when the window sits in a horizontal (top/bottom) wall. */
  readonly horizontal: boolean;

  constructor(readonly def: WindowDef) {
    const cx = def.tx * TILE + TILE / 2;
    const cy = def.ty * TILE + TILE / 2;
    this.center = { x: cx, y: cy };
    this.outsidePoint = { x: cx + def.dx * TILE, y: cy + def.dy * TILE };
    this.insidePoint = { x: cx - def.dx * TILE, y: cy - def.dy * TILE };
    this.spawnPoint = { x: cx + def.dx * TILE * 3, y: cy + def.dy * TILE * 3 };
    this.horizontal = def.dy !== 0;
  }

  tear(): boolean {
    if (this.planks <= 0) return false;
    this.planks--;
    return true;
  }

  rebuild(): boolean {
    if (this.planks >= MAX_PLANKS || this.climber) return false;
    this.planks++;
    return true;
  }
}
