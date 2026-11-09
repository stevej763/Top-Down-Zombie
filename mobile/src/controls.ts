/** Where the on-screen controls sit, and how they're drawn. Everything here is in CSS pixels of the screen. */

export type ButtonId = 'use' | 'reload' | 'knife' | 'swap' | 'pause';

export interface Button {
  id: ButtonId;
  /** The key it stands for (what Game reads). */
  code: string;
  label: string;
  x: number;
  y: number;
  r: number;
}

export interface Layout {
  buttons: Button[];
  /** How far a stick's knob travels from its centre. */
  stickR: number;
  /** Where the sticks rest when no thumb is on them (drawn as hints). */
  moveHome: { x: number; y: number };
  aimHome: { x: number; y: number };
}

export interface Insets { top: number; right: number; bottom: number; left: number }

const MARGIN = 18;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function layout(w: number, h: number, safe: Insets): Layout {
  const r = clamp(h * 0.07, 24, 40);
  const stickR = clamp(h * 0.14, 44, 80);
  // USE is the big one, upper right, with the small buttons in an arc above and to its left.
  const ux = w - safe.right - MARGIN - r * 1.35;
  const uy = h * 0.38;
  const buttons: Button[] = [
    { id: 'use', code: 'KeyE', label: 'USE', x: ux, y: uy, r: r * 1.35 },
    { id: 'reload', code: 'KeyR', label: 'R', x: ux - r * 2.8, y: uy + r * 0.3, r },
    { id: 'knife', code: 'KeyF', label: 'KNIFE', x: ux - r * 2.1, y: uy - r * 2.1, r },
    { id: 'swap', code: 'KeyQ', label: 'SWAP', x: ux + r * 0.2, y: uy - r * 2.7, r },
    { id: 'pause', code: 'Escape', label: 'II', x: safe.left + MARGIN + r * 0.8, y: safe.top + MARGIN + r * 0.8, r: r * 0.8 },
  ];
  const homeY = h - safe.bottom - MARGIN - stickR * 1.3;
  return {
    buttons,
    stickR,
    moveHome: { x: safe.left + MARGIN + stickR * 1.5, y: homeY },
    aimHome: { x: w - safe.right - MARGIN - stickR * 1.5, y: homeY },
  };
}

export function hitButton(buttons: Button[], x: number, y: number): Button | undefined {
  // A little slack around each button: thumbs are blunt.
  return buttons.find((b) => Math.hypot(x - b.x, y - b.y) <= b.r * 1.2);
}

export interface Stick { ox: number; oy: number; x: number; y: number }

export function drawStick(ctx: CanvasRenderingContext2D, home: { x: number; y: number }, s: Stick | undefined, r: number, tint: string): void {
  const ox = s?.ox ?? home.x;
  const oy = s?.oy ?? home.y;
  ctx.globalAlpha = s ? 0.5 : 0.18;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(ox, oy, r, 0, Math.PI * 2);
  ctx.stroke();
  let kx = ox;
  let ky = oy;
  if (s) {
    const dx = s.x - ox;
    const dy = s.y - oy;
    const d = Math.hypot(dx, dy);
    const k = d > r ? r / d : 1;
    kx = ox + dx * k;
    ky = oy + dy * k;
  }
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.arc(kx, ky, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawButton(ctx: CanvasRenderingContext2D, b: Button, held: boolean, lit: boolean, label = b.label): void {
  ctx.globalAlpha = held ? 0.75 : lit ? 0.6 : 0.32;
  ctx.fillStyle = lit ? '#f2d15c' : '#000000';
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.globalAlpha = held ? 1 : 0.8;
  ctx.fillStyle = lit ? '#000000' : '#ffffff';
  ctx.font = `bold ${Math.round(b.r * (label.length > 3 ? 0.42 : 0.6))}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, b.x, b.y + 1);
  ctx.globalAlpha = 1;
}
