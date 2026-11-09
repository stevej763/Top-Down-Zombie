import { clamp, type Vec2 } from '../core/math';

export const TILE = 32;

export const Tile = {
  Outside: 0,
  Floor: 1,
  Wall: 2,
  Window: 3,
  Crate: 4,
  /** Closed, purchasable door. Becomes Floor when opened. */
  Door: 5,
  /** Low furniture (tables, beds, counters): blocks walking but not bullets. */
  Low: 6,
} as const;
export type TileType = (typeof Tile)[keyof typeof Tile];

export type SolidFn = (t: TileType) => boolean;

export class TileMap {
  readonly pxW: number;
  readonly pxH: number;

  constructor(readonly w: number, readonly h: number, private tiles: TileType[]) {
    this.pxW = w * TILE;
    this.pxH = h * TILE;
  }

  get(tx: number, ty: number): TileType {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return Tile.Wall;
    return this.tiles[ty * this.w + tx];
  }

  set(tx: number, ty: number, t: TileType): void {
    if (tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) this.tiles[ty * this.w + tx] = t;
  }

  tileAt(x: number, y: number): TileType {
    return this.get(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  static blocksBullets(t: TileType): boolean {
    return t === Tile.Wall || t === Tile.Crate || t === Tile.Door;
  }

  /** Distance along a normalized ray before it hits a bullet-blocking tile (capped at `max`). */
  rayWall(ox: number, oy: number, dx: number, dy: number, max: number): number {
    for (let d = 0; d < max; d += 4) {
      if (TileMap.blocksBullets(this.tileAt(ox + dx * d, oy + dy * d))) return d;
    }
    return max;
  }

  /** Exact distance along a normalized ray to the first tile `blocks` accepts (capped at `max`), stepping tile by tile. */
  rayTo(ox: number, oy: number, dx: number, dy: number, max: number, blocks: SolidFn): number {
    let tx = Math.floor(ox / TILE);
    let ty = Math.floor(oy / TILE);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const spanX = dx !== 0 ? TILE / Math.abs(dx) : Infinity;
    const spanY = dy !== 0 ? TILE / Math.abs(dy) : Infinity;
    let nextX = dx !== 0 ? (dx > 0 ? (tx + 1) * TILE - ox : ox - tx * TILE) / Math.abs(dx) : Infinity;
    let nextY = dy !== 0 ? (dy > 0 ? (ty + 1) * TILE - oy : oy - ty * TILE) / Math.abs(dy) : Infinity;
    let t = 0;
    while (t < max) {
      if (blocks(this.get(tx, ty))) return t;
      if (nextX < nextY) {
        tx += stepX;
        t = nextX;
        nextX += spanX;
      } else {
        ty += stepY;
        t = nextY;
        nextY += spanY;
      }
    }
    return max;
  }

  hasLOS(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    if (d < 1) return true;
    return this.rayWall(ax, ay, (bx - ax) / d, (by - ay) / d, d) >= d;
  }

  /** Push a circle out of every solid tile it overlaps. */
  collideCircle(p: Vec2, r: number, solid: SolidFn): void {
    for (let pass = 0; pass < 2; pass++) {
      const minTx = Math.floor((p.x - r) / TILE);
      const maxTx = Math.floor((p.x + r) / TILE);
      const minTy = Math.floor((p.y - r) / TILE);
      const maxTy = Math.floor((p.y + r) / TILE);
      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          if (!solid(this.get(tx, ty))) continue;
          const x0 = tx * TILE, y0 = ty * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
          const nx = clamp(p.x, x0, x1);
          const ny = clamp(p.y, y0, y1);
          const dx = p.x - nx, dy = p.y - ny;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (r - d) / d;
            p.x += dx * push;
            p.y += dy * push;
          } else {
            // Centre is inside the tile: eject along the axis of least penetration.
            const left = p.x - x0, right = x1 - p.x, top = p.y - y0, bottom = y1 - p.y;
            const m = Math.min(left, right, top, bottom);
            if (m === left) p.x = x0 - r;
            else if (m === right) p.x = x1 + r;
            else if (m === top) p.y = y0 - r;
            else p.y = y1 + r;
          }
        }
      }
    }
  }
}
