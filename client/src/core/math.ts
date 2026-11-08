export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

export function randInt(lo: number, hi: number): number {
  return Math.floor(rand(lo, hi + 1));
}

/** Signed shortest angle from `from` to `to`, in [-PI, PI]. */
export function angleDiff(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Rotate angle `a` toward `target` by at most `maxStep` radians. */
export function turnToward(a: number, target: number, maxStep: number): number {
  const d = angleDiff(a, target);
  return Math.abs(d) <= maxStep ? target : a + Math.sign(d) * maxStep;
}

/** Distance along a normalized ray to its first intersection with a circle, or -1 on a miss. */
export function rayCircle(
  ox: number, oy: number, dx: number, dy: number,
  cx: number, cy: number, r: number,
): number {
  const fx = ox - cx;
  const fy = oy - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const b = fx * dx + fy * dy;
  if (b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b - Math.sqrt(disc);
}
