import { clamp, rand } from './math';

export class Camera {
  x = 0;
  y = 0;
  /** Shake offset, applied at render time only (aim uses the unshaken position). */
  ox = 0;
  oy = 0;
  private shake = 0;

  constructor(
    private viewW: number, private viewH: number,
    private worldW: number, private worldH: number,
  ) {}

  snap(tx: number, ty: number): void {
    this.x = tx - this.viewW / 2;
    this.y = ty - this.viewH / 2;
    this.clampToWorld();
  }

  follow(tx: number, ty: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    this.x += (tx - this.viewW / 2 - this.x) * k;
    this.y += (ty - this.viewH / 2 - this.y) * k;
    this.clampToWorld();

    this.shake = Math.max(0, this.shake - dt * 30);
    this.ox = rand(-1, 1) * this.shake;
    this.oy = rand(-1, 1) * this.shake;
  }

  addShake(amount: number): void {
    this.shake = Math.min(14, this.shake + amount);
  }

  private clampToWorld(): void {
    this.x = this.worldW <= this.viewW ? (this.worldW - this.viewW) / 2 : clamp(this.x, 0, this.worldW - this.viewW);
    this.y = this.worldH <= this.viewH ? (this.worldH - this.viewH) / 2 : clamp(this.y, 0, this.worldH - this.viewH);
  }
}
