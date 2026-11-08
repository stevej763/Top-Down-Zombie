import type { Vec2 } from '../core/math';
import { TILE, TileMap, type TileType } from '../world/TileMap';

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** BFS distance field over passable tiles, rooted at the player's tile. */
export class FlowField {
  private dist: Int32Array;
  private originTx = -1;
  private originTy = -1;

  constructor(private map: TileMap, private passable: (t: TileType) => boolean) {
    this.dist = new Int32Array(map.w * map.h);
  }

  /** Force a recompute on the next update (e.g. after a door opens). */
  invalidate(): void {
    this.originTx = -1;
  }

  update(px: number, py: number): void {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    if (tx === this.originTx && ty === this.originTy) return;
    this.originTx = tx;
    this.originTy = ty;

    const { w, h } = this.map;
    this.dist.fill(-1);
    const queue = new Int32Array(w * h);
    let head = 0;
    let tail = 0;
    this.dist[ty * w + tx] = 0;
    queue[tail++] = ty * w + tx;
    while (head < tail) {
      const i = queue[head++];
      const cx = i % w;
      const cy = (i - cx) / w;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS[k][0];
        const ny = cy + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (this.dist[n] !== -1 || !this.passable(this.map.get(nx, ny))) continue;
        this.dist[n] = this.dist[i] + 1;
        queue[tail++] = n;
      }
    }
  }

  /** Centre of the neighbouring tile that leads toward the player, or null if already there / unreachable. */
  nextTarget(x: number, y: number): Vec2 | null {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const { w, h } = this.map;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
    const here = this.dist[ty * w + tx];
    if (here <= 0) return null;

    let best = here;
    let bx = -1;
    let by = -1;
    for (const [ox, oy] of DIRS) {
      const nx = tx + ox;
      const ny = ty + oy;
      if (!this.passable(this.map.get(nx, ny))) continue;
      // No corner cutting.
      if (ox && oy && (!this.passable(this.map.get(tx + ox, ty)) || !this.passable(this.map.get(tx, ty + oy)))) continue;
      const d = this.dist[ny * w + nx];
      if (d >= 0 && d < best) {
        best = d;
        bx = nx;
        by = ny;
      }
    }
    if (bx < 0) return null;
    return { x: bx * TILE + TILE / 2, y: by * TILE + TILE / 2 };
  }
}
