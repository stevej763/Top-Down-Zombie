import { PERKS, WEAPONS } from '../../client/src/game/defs';
import { parseMap, type WallSpot } from '../../client/src/game/MapData';
import { TILE } from '../../client/src/game/TileMap';
import {
  drawArmourBench, drawDoor, drawMysteryBox, drawPerkMachine, drawPowerSwitch, drawUpgradeBench, drawWallBuy,
  drawWindow, renderMap,
} from '../../client/src/render/draw';
import { drawFurniture } from '../../client/src/render/furniture';
import type { Editor, Rect } from './editor';
import { footprint, TILES, toDoc, type Draft } from './model';

/** Seeded like scripts/render-maps.ts, so the yard speckle doesn't shimmer on every re-render. */
function seededRandom<T>(fn: () => T): T {
  let seed = 42;
  const real = Math.random;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

function hue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h * 137) % 360;
}

interface RoomLabel {
  name: string;
  x: number;
  y: number;
  hue: number;
}

export class View {
  zoom = 0.75;
  panX = 40;
  panY = 40;
  showGrid = true;
  showRooms = true;
  /** Hide editor overlays to see the map as the game draws it. */
  clean = false;

  private base: HTMLCanvasElement | null = null;
  private baseVersion = -1;
  private labels: RoomLabel[] = [];

  /** Map pixel → screen pixel is `p * zoom + pan`. */
  toTile(sx: number, sy: number): { tx: number; ty: number; fx: number; fy: number } {
    const mx = (sx - this.panX) / this.zoom / TILE;
    const my = (sy - this.panY) / this.zoom / TILE;
    const tx = Math.floor(mx), ty = Math.floor(my);
    return { tx, ty, fx: mx - tx, fy: my - ty };
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const z = Math.max(0.15, Math.min(4, this.zoom * factor));
    this.panX = sx - ((sx - this.panX) * z) / this.zoom;
    this.panY = sy - ((sy - this.panY) * z) / this.zoom;
    this.zoom = z;
  }

  fit(d: Draft, w: number, h: number): void {
    this.zoom = Math.max(0.15, Math.min(2, Math.min((w - 40) / (d.width * TILE), (h - 40) / (d.height * TILE))));
    this.panX = (w - d.width * TILE * this.zoom) / 2;
    this.panY = (h - d.height * TILE * this.zoom) / 2;
  }

  private rebuild(e: Editor): void {
    const d = e.draft;
    // parseMap needs a start; the unplaced fixtures are only drawn as overlays anyway.
    const doc = { ...toDoc(d), playerStart: d.playerStart ?? { tx: 0, ty: 0 } };
    this.base = seededRandom(() => renderMap(parseMap(doc)));
    this.baseVersion = e.version;

    // Room labels at the floor tile nearest each room's centre.
    const sums = new Map<string, { x: number; y: number; n: number; cells: number[] }>();
    d.roomNames.forEach((name, i) => {
      if (!name || d.cells[i] !== '_') return;
      const s = sums.get(name) ?? { x: 0, y: 0, n: 0, cells: [] };
      s.x += i % d.width;
      s.y += Math.floor(i / d.width);
      s.n++;
      s.cells.push(i);
      sums.set(name, s);
    });
    this.labels = [...sums].map(([name, s]) => {
      const cx = s.x / s.n, cy = s.y / s.n;
      let best = s.cells[0], bestD = Infinity;
      for (const i of s.cells) {
        const dd = (i % d.width - cx) ** 2 + (Math.floor(i / d.width) - cy) ** 2;
        if (dd < bestD) { bestD = dd; best = i; }
      }
      return { name, x: (best % d.width + 0.5) * TILE, y: (Math.floor(best / d.width) + 0.5) * TILE, hue: hue(name) };
    });
  }

  render(ctx: CanvasRenderingContext2D, e: Editor, time: number): void {
    const d = e.draft;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#101114';
    ctx.fillRect(0, 0, cw, ch);
    if (e.version !== this.baseVersion) this.rebuild(e);

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(this.zoom * dpr, 0, 0, this.zoom * dpr, this.panX * dpr, this.panY * dpr);
    ctx.imageSmoothingEnabled = this.zoom < 1;
    if (this.base) ctx.drawImage(this.base, 0, 0);

    // Doors, windows and fixtures as the game draws them.
    for (const dr of d.doors) drawDoor(ctx, dr.tiles);
    for (const w of d.windows) {
      drawWindow(ctx, { def: w, center: { x: w.tx * TILE + TILE / 2, y: w.ty * TILE + TILE / 2 }, horizontal: w.dy !== 0 }, 6);
    }
    for (const s of d.wallBuys) if (s.weapon in WEAPONS) drawWallBuy(ctx, s.tx, s.ty, WEAPONS[s.weapon]);
    for (const s of d.perks) if (s.perk in PERKS) drawPerkMachine(ctx, s.tx, s.ty, PERKS[s.perk], time, true);
    if (d.armour) drawArmourBench(ctx, d.armour.tx, d.armour.ty);
    if (d.upgrade) drawUpgradeBench(ctx, d.upgrade.tx, d.upgrade.ty, time, true);
    if (d.box) drawMysteryBox(ctx, d.box.tx, d.box.ty, false, true);
    if (d.power) drawPowerSwitch(ctx, d.power, false, time);
    if (d.playerStart) this.drawStart(ctx, d.playerStart.tx, d.playerStart.ty);

    if (!this.clean) {
      if (this.showRooms) this.drawRooms(ctx, d);
      for (const s of [...d.wallBuys, ...d.perks, d.armour, d.upgrade, d.power]) if (s) this.drawFacing(ctx, s);
      if (this.showGrid && this.zoom * TILE >= 8) this.drawGrid(ctx, d);
      this.drawDoorCosts(ctx, d);
      this.drawProblems(ctx, e, time);
      const sel = e.boundsOf(e.selection);
      if (sel) this.outline(ctx, sel, '#ffd94a', time);
      this.drawTool(ctx, e);
    }

    // Map edge.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1 / this.zoom;
    ctx.strokeRect(0, 0, d.width * TILE, d.height * TILE);
  }

  private drawStart(ctx: CanvasRenderingContext2D, tx: number, ty: number): void {
    const x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
    ctx.fillStyle = '#3a7bd5';
    ctx.strokeStyle = '#cfe2ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P', x, y + 1);
  }

  private drawRooms(ctx: CanvasRenderingContext2D, d: Draft): void {
    for (let i = 0; i < d.roomNames.length; i++) {
      const name = d.roomNames[i];
      if (!name) continue;
      ctx.fillStyle = `hsla(${hue(name)}, 70%, 55%, 0.16)`;
      ctx.fillRect((i % d.width) * TILE, Math.floor(i / d.width) * TILE, TILE, TILE);
    }
    // Which way each window opens: an arrow pointing out into the yard.
    ctx.strokeStyle = 'rgba(160, 220, 255, 0.9)';
    ctx.lineWidth = 2;
    for (const w of d.windows) {
      const cx = w.tx * TILE + TILE / 2 + w.dx * TILE * 0.55, cy = w.ty * TILE + TILE / 2 + w.dy * TILE * 0.55;
      this.arrow(ctx, cx - w.dx * 8, cy - w.dy * 8, cx + w.dx * 8, cy + w.dy * 8);
    }
    const size = Math.max(12, Math.min(28, 14 / this.zoom));
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of this.labels) {
      ctx.lineWidth = 4 / Math.max(this.zoom, 0.5);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.strokeText(l.name, l.x, l.y);
      ctx.fillStyle = `hsl(${l.hue}, 80%, 75%)`;
      ctx.fillText(l.name, l.x, l.y);
    }
  }

  private arrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - Math.cos(a - 0.6) * 6, y1 - Math.sin(a - 0.6) * 6);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - Math.cos(a + 0.6) * 6, y1 - Math.sin(a + 0.6) * 6);
    ctx.stroke();
  }

  /** A dot on the floor tile a wall fixture is used from. */
  private drawFacing(ctx: CanvasRenderingContext2D, s: WallSpot): void {
    const x = (s.tx + s.nx) * TILE + TILE / 2, y = (s.ty + s.ny) * TILE + TILE / 2;
    ctx.fillStyle = 'rgba(255, 217, 74, 0.55)';
    ctx.beginPath();
    ctx.arc(x - s.nx * 10, y - s.ny * 10, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, d: Draft): void {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1 / this.zoom;
    ctx.beginPath();
    for (let x = 0; x <= d.width; x++) { ctx.moveTo(x * TILE, 0); ctx.lineTo(x * TILE, d.height * TILE); }
    for (let y = 0; y <= d.height; y++) { ctx.moveTo(0, y * TILE); ctx.lineTo(d.width * TILE, y * TILE); }
    ctx.stroke();
    // Every 10th line a little brighter, to count tiles by.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    for (let x = 0; x <= d.width; x += 10) { ctx.moveTo(x * TILE, 0); ctx.lineTo(x * TILE, d.height * TILE); }
    for (let y = 0; y <= d.height; y += 10) { ctx.moveTo(0, y * TILE); ctx.lineTo(d.width * TILE, y * TILE); }
    ctx.stroke();
  }

  private drawDoorCosts(ctx: CanvasRenderingContext2D, d: Draft): void {
    if (this.zoom < 0.35) return;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const dr of d.doors) {
      const [tx, ty] = dr.tiles[Math.floor(dr.tiles.length / 2)];
      const x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
      const s = String(dr.cost);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x - s.length * 3.5 - 3, y - 7, s.length * 7 + 6, 14);
      ctx.fillStyle = '#f2d15c';
      ctx.fillText(s, x, y + 1);
    }
  }

  private drawProblems(ctx: CanvasRenderingContext2D, e: Editor, time: number): void {
    const a = 0.55 + Math.sin(time * 5) * 0.3;
    ctx.strokeStyle = `rgba(255, 70, 60, ${a})`;
    ctx.lineWidth = 3 / Math.max(this.zoom, 0.6);
    for (const p of e.problems) if (p.at) ctx.strokeRect(p.at[0] * TILE + 1, p.at[1] * TILE + 1, TILE - 2, TILE - 2);
  }

  private outline(ctx: CanvasRenderingContext2D, r: Rect, color: string, time = 0): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / Math.max(this.zoom, 0.5);
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -time * 20;
    ctx.strokeRect(r.x0 * TILE, r.y0 * TILE, (r.x1 - r.x0 + 1) * TILE, (r.y1 - r.y0 + 1) * TILE);
    ctx.restore();
  }

  /** What the current tool would do at the pointer. */
  private drawTool(ctx: CanvasRenderingContext2D, e: Editor): void {
    const h = e.hover;
    const tileColor = TILES.find((t) => t.ch === e.tile)?.color ?? '#fff';
    if (e.dragRect) {
      const r = e.dragRect;
      const w = (r.x1 - r.x0 + 1) * TILE, hh = (r.y1 - r.y0 + 1) * TILE;
      if (e.tool === 'rect') {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = tileColor;
        ctx.fillRect(r.x0 * TILE, r.y0 * TILE, w, hh);
        ctx.globalAlpha = 1;
      } else if (e.tool === 'room') {
        ctx.fillStyle = 'rgba(122, 90, 58, 0.45)';
        ctx.fillRect(r.x0 * TILE, r.y0 * TILE, w, hh);
        ctx.strokeStyle = 'rgba(200, 200, 215, 0.9)';
        ctx.lineWidth = TILE * 0.5;
        ctx.strokeRect(r.x0 * TILE + TILE / 4, r.y0 * TILE + TILE / 4, w - TILE / 2, hh - TILE / 2);
      } else {
        ctx.fillStyle = 'rgba(255, 217, 74, 0.25)';
        ctx.fillRect(r.x0 * TILE, r.y0 * TILE, w, hh);
      }
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(12, 12 / this.zoom)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${r.x1 - r.x0 + 1}×${r.y1 - r.y0 + 1}`, r.x0 * TILE, r.y0 * TILE - 4);
      this.outline(ctx, r, '#fff');
      return;
    }
    if (!h) return;
    const one = { x0: h.tx, y0: h.ty, x1: h.tx, y1: h.ty };
    switch (e.tool) {
      case 'brush':
      case 'rect':
      case 'fill':
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = tileColor;
        ctx.fillRect(h.tx * TILE, h.ty * TILE, TILE, TILE);
        ctx.globalAlpha = 1;
        this.outline(ctx, one, '#fff');
        break;
      case 'room':
        this.outline(ctx, one, '#fff');
        break;
      case 'erase':
        this.outline(ctx, one, '#ff6b5a');
        break;
      case 'place': {
        this.outline(ctx, e.place === 'box' ? { ...one, x1: h.tx + 1 } : one, '#ffd94a');
        if (e.place !== 'start' && e.place !== 'box') {
          const opts = e.wallFacings(h.tx, h.ty);
          if (opts.length) {
            const px = h.fx - 0.5, py = h.fy - 0.5;
            const [nx, ny] = opts.reduce((b, o) => (o[0] * px + o[1] * py > b[0] * px + b[1] * py ? o : b));
            ctx.strokeStyle = '#ffd94a';
            ctx.lineWidth = 2.5;
            const cx = h.tx * TILE + TILE / 2, cy = h.ty * TILE + TILE / 2;
            this.arrow(ctx, cx, cy, cx + nx * TILE, cy + ny * TILE);
          }
        }
        break;
      }
      case 'decor': {
        const k = e.decorDef();
        if (k.area) {
          this.outline(ctx, one, '#ffd94a');
          break;
        }
        const { w, h: fh } = footprint(k, e.face);
        ctx.globalAlpha = 0.7;
        drawFurniture(ctx, [{ kind: k.kind, tx: h.tx, ty: h.ty, w, h: fh, face: e.face }]);
        ctx.globalAlpha = 1;
        this.outline(ctx, { x0: h.tx, y0: h.ty, x1: h.tx + w - 1, y1: h.ty + fh - 1 }, '#ffd94a');
        break;
      }
      case 'select':
        if (e.objectAt(h.tx, h.ty)) this.outline(ctx, e.boundsOf(e.objectAt(h.tx, h.ty))!, 'rgba(255,255,255,0.6)');
        break;
    }
  }
}
