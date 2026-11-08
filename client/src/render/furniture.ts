import { TAU } from '../core/math';
import type { DecorDef } from '../game/MapData';
import { Tile, TILE, type TileMap } from '../game/TileMap';

/**
 * Map decor, drawn once into the pre-rendered map: floor finishes and rugs under everything,
 * furniture over the C/T tiles that make it solid. Every piece is drawn in its own frame with the
 * front pointing down (+y), then rotated to its `face`. Kinds the client doesn't know are skipped.
 */

type Ctx = CanvasRenderingContext2D;
/** Draws a piece in a local frame centred on it: `w` across, `h` deep, the front edge at +h/2. */
type PieceFn = (ctx: Ctx, w: number, h: number, seed: number) => void;
type FloorFn = (ctx: Ctx, x: number, y: number, seed: number) => void;

const ANGLE = { s: 0, w: Math.PI / 2, n: Math.PI, e: -Math.PI / 2 } as const;

/** Stable 0..1 noise, so the map looks the same every time it's drawn. */
function hash(a: number, b: number, c = 0): number {
  const h = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function box(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string): void {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

// ------------------------------------------------------------------ floors

const FLOORS: Record<string, FloorFn> = {
  checker(ctx, x, y) {
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = (i + j) % 2 ? '#2c2b2e' : '#7f7a6e';
        ctx.fillRect(x + i * 16, y + j * 16, 16, 16);
      }
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(x, y, TILE, 1);
    ctx.fillRect(x, y, 1, TILE);
  },
  carpet(ctx, x, y, seed) {
    ctx.fillStyle = '#35304a';
    ctx.fillRect(x, y, TILE, TILE);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = hash(seed, i) < 0.5 ? '#3d3754' : '#2e2a40';
      ctx.fillRect(x + hash(seed, i, 1) * 30, y + hash(seed, i, 2) * 30, 2, 2);
    }
  },
  tile(ctx, x, y) {
    ctx.fillStyle = '#5f686c';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#8c979b';
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 8 + 1, y + j * 8 + 1, 7, 7);
  },
  /** Packed earth strewn with straw, for the barn. */
  straw(ctx, x, y, seed) {
    ctx.fillStyle = '#3e3324';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const sx = x + hash(seed, i) * TILE;
      const sy = y + hash(seed, i, 1) * TILE;
      const a = hash(seed, i, 2) * Math.PI;
      ctx.strokeStyle = hash(seed, i, 3) < 0.5 ? '#7a6638' : '#5e4e2c';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(a) * 7, sy + Math.sin(a) * 7);
      ctx.stroke();
    }
  },
  concrete(ctx, x, y, seed) {
    ctx.fillStyle = '#4a4946';
    ctx.fillRect(x, y, TILE, TILE);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = hash(seed, i) < 0.5 ? '#53524e' : '#3f3e3b';
      ctx.fillRect(x + hash(seed, i, 1) * 30, y + hash(seed, i, 2) * 30, 2, 2);
    }
    // Expansion joints every few tiles.
    ctx.fillStyle = '#353431';
    if ((x / TILE) % 4 === 0) ctx.fillRect(x, y, 1, TILE);
    if ((y / TILE) % 4 === 0) ctx.fillRect(x, y, TILE, 1);
    if (hash(seed, 99) < 0.05) {
      ctx.strokeStyle = '#2f2e2b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + hash(seed, 5) * TILE);
      ctx.lineTo(x + 16, y + hash(seed, 6) * TILE);
      ctx.lineTo(x + 28, y + hash(seed, 7) * TILE);
      ctx.stroke();
    }
  },
};

const RUGS = [
  { base: '#5a2424', border: '#7a5a2a', inner: '#3e1818' },
  { base: '#24304f', border: '#8a7a50', inner: '#1a2238' },
  { base: '#3e4a2a', border: '#7a6a3a', inner: '#2c3620' },
];

/** Rugs and stains cover their whole rectangle in one piece rather than tile by tile. */
const OVERLAYS: Record<string, (ctx: Ctx, x: number, y: number, w: number, h: number, seed: number) => void> = {
  rug(ctx, x, y, w, h, seed) {
    const c = RUGS[Math.floor(hash(seed, 1) * RUGS.length)];
    const x0 = x + 6, y0 = y + 6, w0 = w - 12, h0 = h - 12;
    // Fringe on the short ends.
    ctx.fillStyle = '#b8a888';
    const long = w0 >= h0;
    for (let i = 3; i < (long ? h0 : w0) - 2; i += 3) {
      if (long) {
        ctx.fillRect(x0 - 4, y0 + i, 4, 1);
        ctx.fillRect(x0 + w0, y0 + i, 4, 1);
      } else {
        ctx.fillRect(x0 + i, y0 - 4, 1, 4);
        ctx.fillRect(x0 + i, y0 + h0, 1, 4);
      }
    }
    ctx.fillStyle = c.base;
    ctx.fillRect(x0, y0, w0, h0);
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 3;
    ctx.strokeRect(x0 + 5, y0 + 5, w0 - 10, h0 - 10);
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 10, y0 + 10, w0 - 20, h0 - 20);
    ctx.fillStyle = c.inner;
    const cx = x0 + w0 / 2, cy = y0 + h0 / 2;
    const r = Math.min(w0, h0) / 2 - 16;
    if (r > 4) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 1.4, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r * 1.4, cy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = c.border;
      ctx.stroke();
    }
  },
  oilStain(ctx, x, y, w, h, seed) {
    for (let i = 0; i < 6; i++) {
      const px = x + w * (0.25 + hash(seed, i) * 0.5);
      const py = y + h * (0.25 + hash(seed, i, 1) * 0.5);
      const r = 8 + hash(seed, i, 2) * Math.min(w, h) * 0.3;
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(10, 10, 12, 0.55)');
      g.addColorStop(1, 'rgba(10, 10, 12, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
  },
};

// ---------------------------------------------------------------- furniture

const WOOD = '#5c3f24';
const WOOD_LIGHT = '#7a5634';
const WOOD_DARK = '#3b2816';

function seat(ctx: Ctx, w: number, h: number, seed: number): void {
  const fabric = ['#5a3434', '#34484a', '#4a4232'][Math.floor(hash(seed, 3) * 3)];
  const arm = 7;
  const back = 9;
  box(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 5, fabric, 'rgba(0, 0, 0, 0.5)');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, back);
  ctx.fillRect(-w / 2 + 2, -h / 2 + 2, arm, h - 4);
  ctx.fillRect(w / 2 - 2 - arm, -h / 2 + 2, arm, h - 4);
  const x0 = -w / 2 + 2 + arm, x1 = w / 2 - 2 - arm;
  const n = Math.max(1, Math.round(w / TILE));
  const cw = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    box(ctx, x0 + i * cw + 1, -h / 2 + 2 + back + 1, cw - 2, h - back - 7, 3, 'rgba(255, 255, 255, 0.07)');
  }
}

function lamp(ctx: Ctx, x: number, y: number): void {
  disc(ctx, x, y, 7, '#8a7a5a');
  disc(ctx, x, y, 5, '#b8a678');
  disc(ctx, x, y, 1.5, '#4a4030');
}

function counterTop(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#3a3026';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = '#8c877c';
  ctx.fillRect(-w / 2, -h / 2, w, h - 4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(-w / 2, h / 2 - 6, w, 2);
}

const PIECES: Record<string, PieceFn> = {
  sofa: seat,
  armchair: seat,
  coffeeTable(ctx, w, h) {
    box(ctx, -w / 2 + 4, -h / 2 + 6, w - 8, h - 12, 3, WOOD, WOOD_DARK);
    box(ctx, -w / 2 + 7, -h / 2 + 9, w - 14, h - 18, 2, WOOD_LIGHT);
    ctx.save();
    ctx.rotate(0.2);
    ctx.fillStyle = '#9a8c70';
    ctx.fillRect(-14, -5, 12, 9);
    ctx.restore();
    disc(ctx, 12, 0, 3.5, '#d8d4c8');
    disc(ctx, 12, 0, 2, '#3a2416');
  },
  tv(ctx, w, h) {
    box(ctx, -w / 2 + 3, -h / 2 + 2, w - 6, h - 8, 2, '#2e2620', '#191410');
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(-w / 2 + 12, -h / 2 + 4, w - 24, 6);
    ctx.fillStyle = 'rgba(120, 160, 220, 0.35)';
    ctx.fillRect(-w / 2 + 14, -h / 2 + 8, w - 28, 1);
    ctx.fillStyle = '#1a1a1e';
    ctx.fillRect(-8, -h / 2 + 10, 16, 3);
  },
  bookshelf(ctx, w, h, seed) {
    box(ctx, -w / 2 + 1, -h / 2 + 1, w - 2, h - 4, 1, WOOD_DARK);
    const colours = ['#7a2a24', '#2a4a6a', '#5a6a2a', '#8a6a2a', '#4a2a5a', '#6a6a6a', '#2a5a4a'];
    let x = -w / 2 + 4;
    let i = 0;
    while (x < w / 2 - 5) {
      const bw = 3 + Math.floor(hash(seed, i) * 4);
      ctx.fillStyle = colours[Math.floor(hash(seed, i, 1) * colours.length)];
      ctx.fillRect(x, -h / 2 + 4 + hash(seed, i, 2) * 3, Math.min(bw, w / 2 - 5 - x), h - 12);
      x += bw + 1;
      i++;
    }
  },
  endTable(ctx, w, h) {
    box(ctx, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 2, WOOD, WOOD_DARK);
    lamp(ctx, 0, 0);
  },
  nightstand(ctx, w, h) {
    box(ctx, -w / 2 + 4, -h / 2 + 3, w - 8, h - 8, 2, WOOD, WOOD_DARK);
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(-4, h / 2 - 7, 8, 2);
    lamp(ctx, 0, -2);
  },
  plant(ctx, _w, _h, seed) {
    disc(ctx, 0, 0, 10, '#6a3c22');
    disc(ctx, 0, 0, 8, '#2a1c12');
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + hash(seed, i) * 0.6;
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = i % 2 ? '#2f5a2a' : '#3e6e32';
      ctx.beginPath();
      ctx.ellipse(8, 0, 8, 3.5, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    disc(ctx, 0, 0, 3, '#4a7a3a');
  },
  counter(ctx, w, h) {
    counterTop(ctx, w, h);
  },
  island(ctx, w, h) {
    // Stools along the front.
    for (let x = -w / 2 + TILE / 2; x < w / 2; x += TILE) disc(ctx, x, h / 2 + 3, 6, '#2a2420');
    box(ctx, -w / 2 + 2, -h / 2 + 3, w - 4, h - 6, 2, '#8c877c', '#3a3026');
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 5, w - 8, 2);
    // A chopping board and a fruit bowl.
    box(ctx, -w / 2 + 10, -6, 18, 11, 2, '#a07a4a');
    disc(ctx, w / 2 - 18, 0, 7, '#d8d4c8');
    disc(ctx, w / 2 - 20, -2, 2.5, '#b03a2a');
    disc(ctx, w / 2 - 16, 1, 2.5, '#d8a830');
  },
  sink(ctx, w, h) {
    counterTop(ctx, w, h);
    box(ctx, -w / 2 + 8, -h / 2 + 6, w - 16, h - 16, 4, '#6a7076', '#4a5056');
    box(ctx, -w / 2 + 11, -h / 2 + 9, w - 22, h - 22, 3, '#3e4448');
    ctx.fillStyle = '#b8bec4';
    ctx.fillRect(-1.5, -h / 2 + 2, 3, 7);
  },
  stove(ctx, w, h) {
    counterTop(ctx, w, h);
    box(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 8, 2, '#24242a');
    ctx.strokeStyle = '#55555e';
    ctx.lineWidth = 1.5;
    for (const [x, y] of [[-6, -6], [6, -6], [-6, 4], [6, 4]]) {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, TAU);
      ctx.stroke();
    }
  },
  fridge(ctx, w, h) {
    box(ctx, -w / 2 + 2, -h / 2 + 1, w - 4, h - 3, 2, '#b4b8bc', '#6a6e72');
    ctx.fillStyle = '#d0d4d8';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 3, w - 8, h - 12);
    ctx.fillStyle = '#7a7e82';
    ctx.fillRect(-w / 2 + 6, h / 2 - 6, w - 12, 2);
  },
  diningTable(ctx, w, h) {
    // Chairs pushed in around it, poking out a little.
    const chair = (x: number, y: number, rot: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      box(ctx, -6, -5, 12, 10, 2, WOOD_DARK);
      ctx.fillStyle = '#2a1c10';
      ctx.fillRect(-6, 3, 12, 3);
      ctx.restore();
    };
    for (let x = -w / 2 + TILE / 2; x < w / 2; x += TILE) {
      chair(x, -h / 2 + 3, Math.PI);
      chair(x, h / 2 - 3, 0);
    }
    chair(-w / 2 + 3, 0, Math.PI / 2);
    chair(w / 2 - 3, 0, -Math.PI / 2);
    box(ctx, -w / 2 + 6, -h / 2 + 8, w - 12, h - 16, 3, WOOD, WOOD_DARK);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    for (let y = -h / 2 + 16; y < h / 2 - 8; y += 8) ctx.fillRect(-w / 2 + 7, y, w - 14, 1);
    disc(ctx, 0, 0, 5, '#c8c0a8');
    disc(ctx, 0, 0, 2, '#d8a830');
  },
  bed(ctx, w, h, seed) {
    box(ctx, -w / 2 + 2, -h / 2 + 1, w - 4, h - 3, 3, WOOD_DARK);
    ctx.fillStyle = '#2a1c10';
    ctx.fillRect(-w / 2 + 2, -h / 2 + 1, w - 4, 6);
    box(ctx, -w / 2 + 5, -h / 2 + 7, w - 10, h - 12, 3, '#cfc8b6');
    const n = Math.max(1, Math.round(w / TILE));
    const pw = (w - 14) / n;
    for (let i = 0; i < n; i++) box(ctx, -w / 2 + 7 + i * pw + 1, -h / 2 + 10, pw - 2, 13, 4, '#e8e2d4', '#a8a090');
    const blanket = ['#4a3a6a', '#6a2a2a', '#2a4a4a'][Math.floor(hash(seed, 2) * 3)];
    const top = -h / 2 + 28;
    box(ctx, -w / 2 + 4, top, w - 8, h / 2 - 4 - top, 3, blanket);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(-w / 2 + 4, top, w - 8, 4);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(-w / 2 + 12, top + 14, w - 30, 2);
  },
  wardrobe(ctx, w, h) {
    box(ctx, -w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 2, WOOD, WOOD_DARK);
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(-w / 2 + 1, h / 2 - 5, w - 2, 4);
    ctx.fillRect(-0.5, -h / 2 + 3, 1, h - 8);
    ctx.fillStyle = '#b8a070';
    ctx.fillRect(-5, h / 2 - 4, 3, 2);
    ctx.fillRect(2, h / 2 - 4, 3, 2);
  },
  desk(ctx, w, h) {
    disc(ctx, 6, h / 2 + 2, 8, '#222226');
    disc(ctx, 6, h / 2 + 2, 5, '#303036');
    box(ctx, -w / 2 + 2, -h / 2 + 3, w - 4, h - 7, 2, WOOD, WOOD_DARK);
    ctx.save();
    ctx.translate(-w / 2 + 18, -1);
    ctx.rotate(-0.25);
    ctx.fillStyle = '#d8d4c8';
    ctx.fillRect(-6, -7, 12, 15);
    ctx.restore();
    box(ctx, 0, -h / 2 + 7, 18, 13, 1, '#2a2a30');
    ctx.fillStyle = '#4a6a8a';
    ctx.fillRect(2, -h / 2 + 8, 14, 4);
    lamp(ctx, w / 2 - 12, -2);
  },
  toilet(ctx, w, h) {
    box(ctx, -w / 2 + 7, -h / 2 + 1, w - 14, 8, 2, '#d8dcdc', '#8a8e8e');
    ctx.fillStyle = '#e4e8e8';
    ctx.beginPath();
    ctx.ellipse(0, 4, 8, 10, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#8a8e8e';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#9ab0b6';
    ctx.beginPath();
    ctx.ellipse(0, 5, 4.5, 6, 0, 0, TAU);
    ctx.fill();
  },
  basin(ctx, w, h) {
    box(ctx, -w / 2 + 3, -h / 2 + 1, w - 6, h - 8, 3, '#d8dcdc', '#8a8e8e');
    ctx.fillStyle = '#9ab0b6';
    ctx.beginPath();
    ctx.ellipse(0, -1, 8, 6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#b8bec4';
    ctx.fillRect(-1.5, -h / 2 + 2, 3, 5);
  },
  bath(ctx, w, h) {
    box(ctx, -w / 2 + 2, -h / 2 + 1, w - 4, h - 3, 8, '#d8dcdc', '#8a8e8e');
    box(ctx, -w / 2 + 7, -h / 2 + 5, w - 14, h - 11, 7, '#a8bcc2');
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(-w / 2 + 14, -h / 2 + 7, w - 34, 2);
    ctx.fillStyle = '#b8bec4';
    ctx.fillRect(-w / 2 + 3, -3, 6, 6);
    disc(ctx, -w / 2 + 14, 0, 1.5, '#4a5458');
  },
  car(ctx, w, h) {
    // Wheels, then the body over them. Front is +y.
    ctx.fillStyle = '#121214';
    for (const y of [-h / 2 + 22, h / 2 - 26]) {
      ctx.fillRect(-w / 2 + 2, y, 6, 16);
      ctx.fillRect(w / 2 - 8, y, 6, 16);
    }
    box(ctx, -w / 2 + 5, -h / 2 + 4, w - 10, h - 8, 12, '#5e2a24', '#2a1210');
    // Rust.
    ctx.fillStyle = 'rgba(120, 70, 30, 0.45)';
    ctx.beginPath();
    ctx.ellipse(-w / 2 + 14, -h / 2 + 30, 6, 11, 0.3, 0, TAU);
    ctx.ellipse(w / 2 - 16, h / 2 - 22, 5, 7, -0.4, 0, TAU);
    ctx.fill();
    // Windscreen, roof, rear window.
    ctx.fillStyle = '#1a242c';
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 11, h / 2 - 44);
    ctx.lineTo(w / 2 - 11, h / 2 - 44);
    ctx.lineTo(w / 2 - 14, h / 2 - 62);
    ctx.lineTo(-w / 2 + 14, h / 2 - 62);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 230, 240, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-6, h / 2 - 48);
    ctx.lineTo(4, h / 2 - 58);
    ctx.stroke();
    box(ctx, -w / 2 + 13, h / 2 - 98, w - 26, 36, 4, '#6e342c');
    ctx.fillStyle = '#1a242c';
    ctx.fillRect(-w / 2 + 13, -h / 2 + 12, w - 26, 16);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(-0.5, h / 2 - 42, 1, 36);
    // Lights.
    ctx.fillStyle = '#c8c098';
    ctx.fillRect(-w / 2 + 9, h / 2 - 7, 9, 3);
    ctx.fillRect(w / 2 - 18, h / 2 - 7, 9, 3);
    ctx.fillStyle = '#7a1a14';
    ctx.fillRect(-w / 2 + 9, -h / 2 + 4, 8, 3);
    ctx.fillRect(w / 2 - 17, -h / 2 + 4, 8, 3);
  },
  shelves(ctx, w, h, seed) {
    box(ctx, -w / 2 + 1, -h / 2 + 1, w - 2, h - 3, 1, '#3a3e44', '#5a5e64');
    const colours = ['#7a6040', '#5a5048', '#8a3a2a', '#3a5a6a', '#6a6a4a', '#9a8a60'];
    for (let x = -w / 2 + 4, i = 0; x < w / 2 - 8; i++) {
      const bw = 6 + Math.floor(hash(seed, i) * 10);
      const bh = h - 10 - hash(seed, i, 1) * 8;
      ctx.fillStyle = colours[Math.floor(hash(seed, i, 2) * colours.length)];
      ctx.fillRect(x, -h / 2 + 4, Math.min(bw, w / 2 - 4 - x), bh);
      x += bw + 2;
    }
    ctx.fillStyle = '#5a5e64';
    for (let x = -w / 2 + TILE; x < w / 2 - 1; x += TILE) ctx.fillRect(x - 1, -h / 2 + 1, 2, h - 3);
  },
  washer(ctx, w, h) {
    box(ctx, -w / 2 + 2, -h / 2 + 1, w - 4, h - 3, 2, '#c4c8cc', '#6a6e72');
    ctx.fillStyle = '#9a9ea2';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 2, w - 6, 5);
    disc(ctx, -6, -h / 2 + 4.5, 1.5, '#3a3e42');
    disc(ctx, 6, -h / 2 + 4.5, 1.5, '#3a3e42');
    disc(ctx, 0, 3, 8, '#7a7e82');
    disc(ctx, 0, 3, 6, '#5a6a74');
  },
  workbench(ctx, w, h) {
    box(ctx, -w / 2 + 1, -h / 2 + 2, w - 2, h - 5, 1, '#6b4e2e', '#3a2816');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    for (let y = -h / 2 + 8; y < h / 2 - 4; y += 6) ctx.fillRect(-w / 2 + 2, y, w - 4, 1);
    // Vice, hammer, saw.
    box(ctx, w / 2 - 14, -h / 2 + 4, 10, 12, 1, '#4a5a6a');
    ctx.fillStyle = '#8a6a40';
    ctx.fillRect(-w / 2 + 10, -2, 16, 3);
    ctx.fillStyle = '#5a5e64';
    ctx.fillRect(-w / 2 + 24, -6, 5, 11);
    ctx.fillStyle = '#9aa0a6';
    ctx.beginPath();
    ctx.moveTo(-6, -8);
    ctx.lineTo(18, -6);
    ctx.lineTo(18, 0);
    ctx.lineTo(-6, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6a4a2a';
    ctx.fillRect(-12, -6, 7, 6);
  },
  toolChest(ctx, w, h) {
    box(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 2, '#8a2a22', '#4a1210');
    ctx.fillStyle = '#5a1a14';
    for (let y = -h / 2 + 8; y < h / 2 - 4; y += 5) ctx.fillRect(-w / 2 + 5, y, w - 10, 1);
    ctx.fillStyle = '#c8c8c8';
    ctx.fillRect(-w / 2 + 5, h / 2 - 6, w - 10, 2);
  },
  bin(ctx) {
    disc(ctx, 0, 0, 9, '#4a4e52');
    disc(ctx, 0, 0, 7, '#5e6266');
    ctx.fillStyle = '#3a3e42';
    ctx.fillRect(-5, -1, 10, 2);
  },
  /** A kitchen dresser: shelves of plates and jugs. */
  hutch(ctx, w, h, seed) {
    box(ctx, -w / 2 + 1, -h / 2 + 1, w - 2, h - 3, 1, WOOD_DARK, '#2a1c10');
    ctx.fillStyle = '#2a1c10';
    for (let x = -w / 2 + TILE; x < w / 2 - 1; x += TILE) ctx.fillRect(x - 1, -h / 2 + 1, 2, h - 3);
    for (let x = -w / 2 + 7, i = 0; x < w / 2 - 6; x += 10, i++) {
      const plate = hash(seed, i) < 0.7;
      disc(ctx, x + 2, 1, plate ? 4.5 : 3.5, plate ? '#d8d4c4' : '#4a6a8a');
      if (plate) disc(ctx, x + 2, 1, 2.5, '#b8b2a0');
    }
  },
  /** Stacked hay bales, one per tile, with twine. */
  hay(ctx, w, h, seed) {
    for (let y = -h / 2; y < h / 2 - 1; y += TILE) {
      for (let x = -w / 2; x < w / 2 - 1; x += TILE) {
        const i = x * 3 + y;
        const jx = (hash(seed, i) - 0.5) * 3;
        box(ctx, x + 2 + jx, y + 3, TILE - 4, TILE - 6, 3, '#a8893e', '#6a5424');
        ctx.fillStyle = '#c4a650';
        for (let k = 0; k < 6; k++) ctx.fillRect(x + 5 + jx + hash(seed, i, k) * 20, y + 6 + hash(seed, i, k + 9) * 18, 4, 1);
        ctx.fillStyle = '#5a4420';
        ctx.fillRect(x + 10 + jx, y + 3, 1.5, TILE - 6);
        ctx.fillRect(x + 21 + jx, y + 3, 1.5, TILE - 6);
      }
    }
  },
  /** An old tractor, front (+y) with the small wheels, big wheels at the back. */
  tractor(ctx, w, h) {
    ctx.fillStyle = '#141414';
    ctx.fillRect(-w / 2 + 1, -h / 2 + 10, 9, 34);
    ctx.fillRect(w / 2 - 10, -h / 2 + 10, 9, 34);
    ctx.fillRect(-w / 2 + 6, h / 2 - 30, 6, 18);
    ctx.fillRect(w / 2 - 12, h / 2 - 30, 6, 18);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let y = -h / 2 + 12; y < -h / 2 + 44; y += 5) {
      ctx.fillRect(-w / 2 + 1, y, 9, 1);
      ctx.fillRect(w / 2 - 10, y, 9, 1);
    }
    // Bonnet and engine at the front, seat and fenders at the back.
    box(ctx, -11, -h / 2 + 46, 22, h - 52, 4, '#3a5a2a', '#1e3016');
    ctx.fillStyle = '#2a4420';
    for (let y = -h / 2 + 52; y < h / 2 - 10; y += 6) ctx.fillRect(-8, y, 16, 2);
    box(ctx, -w / 2 + 8, -h / 2 + 8, w - 16, 40, 4, '#46682f', '#1e3016');
    box(ctx, -7, -h / 2 + 18, 14, 14, 4, '#1c1c1c');
    disc(ctx, 0, -h / 2 + 40, 5, '#222');
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(6, h / 2 - 40, 4, 10);
    ctx.fillStyle = 'rgba(120, 70, 30, 0.5)';
    ctx.beginPath();
    ctx.ellipse(-w / 2 + 16, -h / 2 + 14, 4, 6, 0.4, 0, TAU);
    ctx.fill();
  },
  trough(ctx, w, h) {
    box(ctx, -w / 2 + 3, -h / 2 + 2, w - 6, h - 4, 3, '#5a5e62', '#2e3236');
    box(ctx, -w / 2 + 6, -h / 2 + 5, w - 12, h - 10, 2, '#1e2a2e');
    ctx.fillStyle = 'rgba(140, 170, 160, 0.25)';
    ctx.fillRect(-w / 2 + 8, -h / 2 + 7, w - 20, 2);
  },
  barrel(ctx) {
    disc(ctx, 0, 0, 12, '#3e2a18');
    disc(ctx, 0, 0, 10.5, '#6a4626');
    ctx.strokeStyle = '#2a2a2e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, TAU);
    ctx.stroke();
    disc(ctx, 4, -3, 1.5, '#1a1a1a');
  },
  /** An upright piano against the wall, keys toward the room. */
  piano(ctx, w, h) {
    box(ctx, -w / 2 + 1, -h / 2 + 1, w - 2, h - 10, 2, '#1e1612', '#0e0a08');
    ctx.fillStyle = '#e8e4d8';
    ctx.fillRect(-w / 2 + 3, h / 2 - 10, w - 6, 7);
    ctx.fillStyle = '#141010';
    for (let x = -w / 2 + 5; x < w / 2 - 4; x += 4.5) ctx.fillRect(x, h / 2 - 10, 2, 4);
    box(ctx, -8, h / 2 - 2, 16, 6, 1, WOOD_DARK);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, 2);
  },
  /** The farm's diesel generator: engine block, radiator grille, exhaust and a fuel tank. */
  generator(ctx, w, h) {
    box(ctx, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 3, '#4a4a3a', '#22221a');
    box(ctx, -w / 2 + 6, -h / 2 + 6, w * 0.45, h - 12, 2, '#6a6a4a');
    ctx.fillStyle = '#3a3a2a';
    for (let y = -h / 2 + 10; y < h / 2 - 8; y += 4) ctx.fillRect(-w / 2 + 9, y, w * 0.45 - 6, 2);
    box(ctx, w / 2 - 34, -h / 2 + 8, 26, 18, 6, '#8a6a2a', '#4a3a14');
    disc(ctx, w / 2 - 16, h / 2 - 14, 5, '#222');
    disc(ctx, w / 2 - 16, h / 2 - 14, 2.5, '#0a0a0a');
    ctx.fillStyle = '#d8b030';
    ctx.fillRect(-w / 2 + 4, h / 2 - 6, w - 8, 2);
  },
  /** A brick fireplace built into a wall, with a few embers still glowing in the grate. */
  fireplace(ctx, w, h, seed) {
    ctx.fillStyle = '#5a3328';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#3e221a';
    for (let y = -h / 2 + 5; y < h / 2; y += 6) {
      ctx.fillRect(-w / 2, y, w, 1);
      const off = (Math.round((y + h / 2) / 6) % 2) * 6;
      for (let x = -w / 2 + off; x < w / 2; x += 12) ctx.fillRect(x, y - 5, 1, 5);
    }
    box(ctx, -w / 2 + 12, -h / 2 + 10, w - 24, h - 10, 3, '#120a07');
    for (let i = 0; i < 6; i++) {
      const x = -w / 2 + 16 + hash(seed, i) * (w - 32);
      const y = h / 2 - 12 + hash(seed, i, 1) * 8;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 6);
      g.addColorStop(0, 'rgba(255, 120, 40, 0.8)');
      g.addColorStop(1, 'rgba(255, 80, 20, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 6, y - 6, 12, 12);
    }
    // Stone hearth slab, just proud of the wall.
    ctx.fillStyle = '#6a6660';
    ctx.fillRect(-w / 2 + 6, h / 2 - 2, w - 12, 5);
  },
};

const FLAT = new Set(['fireplace', 'plant', 'bin', 'barrel']);

function isFloorKind(kind: string): boolean {
  return kind in FLOORS || kind in OVERLAYS;
}

/** Tile indices under furniture the client can draw, so the map skips the plain crate there. */
export function furnitureTiles(map: TileMap, decor: DecorDef[]): Set<number> {
  const out = new Set<number>();
  for (const d of decor) {
    if (!(d.kind in PIECES)) continue;
    for (let y = d.ty; y < d.ty + d.h; y++) for (let x = d.tx; x < d.tx + d.w; x++) out.add(y * map.w + x);
  }
  return out;
}

/** Floor finishes (only on floor and furniture tiles, never walls or doorways), then rugs and stains. */
export function drawFloorDecor(ctx: Ctx, map: TileMap, decor: DecorDef[]): void {
  for (const d of decor) {
    const floor = FLOORS[d.kind];
    if (floor) {
      for (let ty = d.ty; ty < d.ty + d.h; ty++) {
        for (let tx = d.tx; tx < d.tx + d.w; tx++) {
          const t = map.get(tx, ty);
          if (t === Tile.Floor || t === Tile.Crate || t === Tile.Low) floor(ctx, tx * TILE, ty * TILE, tx * 31 + ty * 17);
        }
      }
      continue;
    }
    OVERLAYS[d.kind]?.(ctx, d.tx * TILE, d.ty * TILE, d.w * TILE, d.h * TILE, d.tx * 7 + d.ty * 13);
  }
}

export function drawFurniture(ctx: Ctx, decor: DecorDef[]): void {
  for (const d of decor) {
    const draw = PIECES[d.kind];
    if (!draw || isFloorKind(d.kind)) continue;
    const pw = d.w * TILE;
    const ph = d.h * TILE;
    const x = d.tx * TILE;
    const y = d.ty * TILE;
    if (!FLAT.has(d.kind)) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      rr(ctx, x + 4, y + 5, pw - 4, ph - 4, 4);
      ctx.fill();
    }
    const face = d.face ?? 's';
    const side = face === 'e' || face === 'w';
    ctx.save();
    ctx.translate(x + pw / 2, y + ph / 2);
    ctx.rotate(ANGLE[face]);
    draw(ctx, side ? ph : pw, side ? pw : ph, d.tx * 7 + d.ty * 13);
    ctx.restore();
  }
}
