import type { Vec2 } from '../core/math';
import { PLAYER_RADIUS, PLAYER_SPEED } from '../game/defs';
import type { PlayerInput } from '../game/input';
import { Tile, type TileMap, type TileType } from '../game/TileMap';

const playerSolid = (t: TileType) => t !== Tile.Floor;

/**
 * One tick of a living player's movement: the first half of the Java `Player.update`, so the
 * client can predict itself. The server also pushes players out of zombies, which this doesn't
 * know about; those differences come back as small corrections.
 */
export function movePlayer(map: TileMap, p: Vec2, inp: Pick<PlayerInput, 'moveX' | 'moveY'>, dt: number): void {
  const mx = Math.sign(inp.moveX);
  const my = Math.sign(inp.moveY);
  if (mx || my) {
    const l = Math.hypot(mx, my);
    p.x += (mx / l) * PLAYER_SPEED * dt;
    p.y += (my / l) * PLAYER_SPEED * dt;
  }
  map.collideCircle(p, PLAYER_RADIUS, playerSolid);
}
