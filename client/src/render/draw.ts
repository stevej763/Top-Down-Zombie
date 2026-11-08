import { rand, TAU } from '../core/math';
import {
  BLEEDOUT, KNIFE, PERKS, PLAYER_RADIUS, REVIVE_TIME, WEAPONS, ZOMBIE_RADIUS, type PerkDef, type WeaponDef,
} from '../game/defs';
import { Tile, TILE, TileMap } from '../game/TileMap';
import { shadowText } from '../ui/text';
import type { Fixture, WindowFixture } from '../view/Level';
import { heldWeapon, type DropView, type InteractableView, type PlayerView, type ZombieView } from '../view/WorldView';
import {
  LOCAL_BODY, PERK_VISUALS, POWERUP_VISUALS, TEAM_BODIES, WEAPON_FX, type PlayerFx, type ZombieFx,
} from './visuals';

/** Pre-render the static map (floors, walls, crates, yard) to an offscreen canvas. */
export function renderMap(map: TileMap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = map.pxW;
  c.height = map.pxH;
  const ctx = c.getContext('2d')!;

  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const x = tx * TILE;
      const y = ty * TILE;
      const t = map.get(tx, ty);
      if (t === Tile.Outside) {
        ctx.fillStyle = '#1b2117';
        ctx.fillRect(x, y, TILE, TILE);
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = Math.random() < 0.5 ? '#232b1e' : '#141911';
          ctx.fillRect(x + rand(0, TILE - 3), y + rand(0, TILE - 3), rand(2, 4), rand(2, 4));
        }
      } else if (t === Tile.Floor || t === Tile.Window || t === Tile.Door) {
        // Wooden floorboards: 4 boards per tile with staggered seams.
        for (let i = 0; i < 4; i++) {
          const shade = 34 + ((tx * 7 + ty * 13 + i * 5) % 6);
          ctx.fillStyle = `hsl(28, 30%, ${shade * 0.55}%)`;
          ctx.fillRect(x, y + i * 8, TILE, 8);
          ctx.fillStyle = '#21180f';
          ctx.fillRect(x, y + i * 8 + 7, TILE, 1);
          const seam = ((tx * 11 + ty * 5 + i * 17) % 4) * 8;
          ctx.fillRect(x + seam, y + i * 8, 1, 8);
        }
      }
    }
  }

  // Shadows cast by walls/crates onto the floor below them.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const t = map.get(tx, ty);
      if ((t === Tile.Wall || t === Tile.Crate) && map.get(tx, ty + 1) !== Tile.Wall) {
        ctx.fillRect(tx * TILE, (ty + 1) * TILE, TILE, 7);
      }
    }
  }

  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const x = tx * TILE;
      const y = ty * TILE;
      const t = map.get(tx, ty);
      if (t === Tile.Wall) {
        ctx.fillStyle = '#3d3d46';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#4c4c57';
        ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
        ctx.fillStyle = '#44444e';
        ctx.fillRect(x + 1, y + TILE / 2, TILE - 2, 1);
      } else if (t === Tile.Crate) {
        ctx.fillStyle = '#4a361f';
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        ctx.fillStyle = '#6d5130';
        ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
        ctx.strokeStyle = '#4a361f';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 5);
        ctx.lineTo(x + TILE - 5, y + TILE - 5);
        ctx.moveTo(x + TILE - 5, y + 5);
        ctx.lineTo(x + 5, y + TILE - 5);
        ctx.stroke();
      }
    }
  }
  return c;
}

/** Fixed per-plank tilt, so each window's boards look hand-nailed but don't jump about. */
function plankJitter(b: WindowFixture, i: number): number {
  const h = Math.sin(b.def.tx * 12.9898 + b.def.ty * 78.233 + i * 37.719) * 43758.5453;
  return (h - Math.floor(h) - 0.5) * 0.56;
}

export function drawWindow(ctx: CanvasRenderingContext2D, b: WindowFixture, planks: number): void {
  const x = b.def.tx * TILE;
  const y = b.def.ty * TILE;
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = '#5e5e6a';
  if (b.horizontal) {
    ctx.fillRect(x, y, 3, TILE);
    ctx.fillRect(x + TILE - 3, y, 3, TILE);
  } else {
    ctx.fillRect(x, y, TILE, 3);
    ctx.fillRect(x, y + TILE - 3, TILE, 3);
  }

  ctx.save();
  ctx.translate(b.center.x, b.center.y);
  if (!b.horizontal) ctx.rotate(Math.PI / 2);
  for (let i = 0; i < planks; i++) {
    ctx.save();
    ctx.translate(0, -12.5 + i * 5);
    ctx.rotate(plankJitter(b, i));
    ctx.fillStyle = i % 2 ? '#8a6438' : '#765330';
    ctx.fillRect(-19, -2.5, 38, 5);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-16, -1, 2, 2);
    ctx.fillRect(14, -1, 2, 2);
    ctx.restore();
  }
  ctx.restore();
}

/** Chalk outline of the weapon on its wall tile. */
export function drawWallBuy(ctx: CanvasRenderingContext2D, tx: number, ty: number, def: WeaponDef): void {
  ctx.save();
  ctx.translate(tx * TILE + TILE / 2, ty * TILE + TILE / 2);
  ctx.fillStyle = '#2c2c33';
  ctx.fillRect(-14, -12, 28, 24);
  ctx.strokeStyle = 'rgba(235, 235, 220, 0.85)';
  ctx.lineWidth = 1.2;
  const barrel = WEAPON_FX[def.id].barrel * 0.6;
  ctx.strokeRect(-10, -3, 10, 6);
  ctx.strokeRect(0, -1.5, barrel, 3);
  ctx.beginPath();
  ctx.moveTo(-8, 3);
  ctx.lineTo(-10, 9);
  ctx.moveTo(-4, 3);
  ctx.lineTo(-6, 9);
  ctx.stroke();
  ctx.restore();
}

/** A vending-machine style perk dispenser filling its wall tile. */
export function drawPerkMachine(ctx: CanvasRenderingContext2D, tx: number, ty: number, perk: PerkDef, time: number): void {
  const x = tx * TILE;
  const y = ty * TILE;
  ctx.fillStyle = '#1a1a1f';
  ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
  const look = PERK_VISUALS[perk.id];
  ctx.fillStyle = look.color;
  ctx.globalAlpha = 0.75 + Math.sin(time * 3 + tx) * 0.15;
  ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(look.letter, x + TILE / 2, y + TILE / 2 + 1);
}

export function drawArmourBench(ctx: CanvasRenderingContext2D, tx: number, ty: number): void {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  ctx.fillStyle = '#23262e';
  ctx.fillRect(cx - 15, cy - 15, 30, 30);
  // Shield.
  ctx.fillStyle = '#5a8ad8';
  ctx.strokeStyle = '#c8d8f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 11);
  ctx.lineTo(cx + 9, cy - 7);
  ctx.lineTo(cx + 7, cy + 4);
  ctx.lineTo(cx, cy + 11);
  ctx.lineTo(cx - 7, cy + 4);
  ctx.lineTo(cx - 9, cy - 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export function drawUpgradeBench(ctx: CanvasRenderingContext2D, tx: number, ty: number, time: number): void {
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  ctx.fillStyle = '#221a2a';
  ctx.fillRect(cx - 15, cy - 15, 30, 30);
  ctx.fillStyle = `rgba(190, 110, 255, ${0.7 + Math.sin(time * 5) * 0.3})`;
  for (const off of [-5, 4]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + off - 7);
    ctx.lineTo(cx + 9, cy + off + 2);
    ctx.lineTo(cx - 9, cy + off + 2);
    ctx.closePath();
    ctx.fill();
  }
}

/** Two-tile wooden chest; `open` shows the lid raised with a glow inside. */
export function drawMysteryBox(ctx: CanvasRenderingContext2D, tx: number, ty: number, open: boolean): void {
  const x = tx * TILE + 2;
  const y = ty * TILE + 4;
  const w = TILE * 2 - 4;
  const h = TILE - 8;
  ctx.fillStyle = '#3d2814';
  ctx.fillRect(x, y, w, h);
  if (open) {
    ctx.fillStyle = '#ffe9a0';
    ctx.fillRect(x + 4, y + 3, w - 8, h - 6);
    ctx.fillStyle = '#5a3a1c';
    ctx.fillRect(x, y - 8, w, 6);
  } else {
    ctx.fillStyle = '#5a3a1c';
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.fillStyle = '#f2d15c';
    ctx.font = 'bold 16px Impact, "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + w / 2, y + h / 2 + 1);
  }
  ctx.strokeStyle = '#c9a040';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

export function drawDoor(ctx: CanvasRenderingContext2D, tiles: [number, number][]): void {
  for (const [tx, ty] of tiles) {
    const x = tx * TILE;
    const y = ty * TILE;
    ctx.fillStyle = '#2b1d10';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#5c4026';
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.strokeStyle = '#3a2814';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 3);
    ctx.lineTo(x + TILE - 3, y + TILE - 3);
    ctx.stroke();
  }
}

export function zombieColors(z: ZombieView, round: number): { body: string; skin: string } {
  const hue = z.runner ? 42 : 95;
  const light = Math.max(18, 34 - round * 0.8);
  return {
    body: `hsl(${hue}, 18%, ${light}%)`,
    skin: `hsl(${hue}, 26%, ${light + 14}%)`,
  };
}

export function drawZombie(ctx: CanvasRenderingContext2D, z: ZombieView, fx: ZombieFx, round: number): void {
  const { body, skin } = zombieColors(z, round);
  const r = ZOMBIE_RADIUS;
  const sway = Math.sin(fx.wobble) * 3;

  ctx.save();
  ctx.translate(z.x, z.y);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(2, 3, r + 1, r, 0, 0, TAU);
  ctx.fill();

  ctx.rotate(z.facing);
  ctx.fillStyle = skin;
  ctx.fillRect(2, -12, 15 + sway, 4.5);
  ctx.fillRect(2, 7.5, 15 - sway, 4.5);

  ctx.fillStyle = body;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(3, 0, 7.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ff3a20';
  ctx.fillRect(7, -3.5, 2, 2);
  ctx.fillRect(7, 1.5, 2, 2);

  if (fx.hitFlash > 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

const TIER_COLORS = ['#151515', '#5a2a8a', '#a02aa0'];

function bodyOf(p: PlayerView, local: boolean): { fill: string; stroke: string } {
  return local ? LOCAL_BODY : TEAM_BODIES[p.id % TEAM_BODIES.length];
}

/** Dead players (spectating until the next round) aren't drawn. */
export function drawPlayer(ctx: CanvasRenderingContext2D, p: PlayerView, anim: PlayerFx, local: boolean): void {
  if (p.state === 'dead') return;
  if (p.state === 'downed') {
    drawDownedPlayer(ctx, p, local);
    return;
  }
  const r = PLAYER_RADIUS;
  const w = heldWeapon(p);
  const wfx = WEAPON_FX[w.id];
  const barrel = wfx.barrel;
  const body = bodyOf(p, local);

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(2, 3, r + 1, r, 0, 0, TAU);
  ctx.fill();

  if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) ctx.globalAlpha = 0.4;
  ctx.rotate(p.aim);
  ctx.fillStyle = TIER_COLORS[w.tier];
  ctx.fillRect(6, -2.5, barrel + 8, 5);
  ctx.fillStyle = '#d9a877';
  ctx.beginPath();
  ctx.arc(9, -4, 3, 0, TAU);
  ctx.arc(11, 3.5, 3, 0, TAU);
  ctx.fill();

  ctx.fillStyle = body.fill;
  ctx.strokeStyle = body.stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3a2a1a';
  ctx.beginPath();
  ctx.arc(0, 0, 6.5, 0, TAU);
  ctx.fill();

  if (anim.knifeSwing > 0) {
    // Blade sweeps across the arc from one side to the other.
    const t = 1 - anim.knifeSwing / KNIFE.swing;
    const half = KNIFE.arc / 2;
    const a = -half + t * KNIFE.arc;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r + KNIFE.reach * 0.75, -half, a);
    ctx.stroke();
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(r - 2, -2, 7, 4);
    ctx.fillStyle = '#d8dde4';
    ctx.beginPath();
    ctx.moveTo(r + 5, -2.5);
    ctx.lineTo(r + 22, 0);
    ctx.lineTo(r + 5, 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  if (anim.flash > 0) {
    const mx = 14 + barrel + 4;
    const s = wfx.flashSize;
    ctx.fillStyle = `rgb(${wfx.flash})`;
    ctx.beginPath();
    ctx.moveTo(mx - 3 * s, -4 * s);
    ctx.lineTo(mx + 10 * s, 0);
    ctx.lineTo(mx - 3 * s, 4 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.arc(mx, 0, 3 * s, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Lying on their side, facing their aim, with the gun dropped. */
function drawDownedPlayer(ctx: CanvasRenderingContext2D, p: PlayerView, local: boolean): void {
  const r = PLAYER_RADIUS;
  const body = bodyOf(p, local);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.ellipse(2, 3, r + 5, r - 2, p.aim, 0, TAU);
  ctx.fill();
  ctx.rotate(p.aim);
  ctx.fillStyle = '#d9a877';
  ctx.beginPath();
  ctx.arc(4, -r + 1, 3, 0, TAU);
  ctx.arc(-6, r - 2, 3, 0, TAU);
  ctx.fill();
  ctx.fillStyle = body.fill;
  ctx.strokeStyle = body.stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(-2, 0, r + 4, r - 4, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3a2a1a';
  ctx.beginPath();
  ctx.arc(r - 1, 0, 6, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * Drawn on top of the lighting layer so it reads in the dark: teammates' name tags, and the
 * bleed-out ring (with revive progress inside it) around a downed player.
 */
export function drawPlayerOverlay(ctx: CanvasRenderingContext2D, p: PlayerView, local: boolean, time: number): void {
  if (p.state === 'dead') return;
  const r = PLAYER_RADIUS;
  if (p.state === 'downed') {
    const ring = r + 10;
    const start = -Math.PI / 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(80, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, ring, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = `rgba(230, 40, 30, ${0.75 + Math.sin(time * 6) * 0.25})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ring, start, start + TAU * Math.max(0, p.bleedout / BLEEDOUT));
    ctx.stroke();
    if (p.reviveProgress > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, ring - 5, start, start + TAU * Math.min(1, p.reviveProgress / REVIVE_TIME));
      ctx.stroke();
    }
  }
  if (!local) {
    // Clear of the bleed-out ring when downed; underlined in their body colour.
    const y = p.y - r - (p.state === 'downed' ? 16 : 8);
    shadowText(ctx, p.name, p.x, y, 'bold 11px monospace', '#e8e8e8', 'center', 'bottom');
    ctx.fillStyle = p.state === 'downed' ? '#e05040' : bodyOf(p, false).fill;
    ctx.fillRect(p.x - 10, y + 1, 20, 2);
  }
}

export function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, gap: number): void {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - gap - 7, y);
  ctx.lineTo(x - gap, y);
  ctx.moveTo(x + gap, y);
  ctx.lineTo(x + gap + 7, y);
  ctx.moveTo(x, y - gap - 7);
  ctx.lineTo(x, y - gap);
  ctx.moveTo(x, y + gap);
  ctx.lineTo(x, y + gap + 7);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillRect(x - 1, y - 1, 2, 2);
}

export function drawInteractable(ctx: CanvasRenderingContext2D, f: Fixture, s: InteractableView, time: number): void {
  switch (f.kind) {
    case 'wallBuy':
      drawWallBuy(ctx, f.spot.tx, f.spot.ty, WEAPONS[f.weapon]);
      break;
    case 'perk':
      drawPerkMachine(ctx, f.spot.tx, f.spot.ty, PERKS[f.perk], time);
      break;
    case 'armour':
      drawArmourBench(ctx, f.spot.tx, f.spot.ty);
      break;
    case 'upgrade':
      drawUpgradeBench(ctx, f.spot.tx, f.spot.ty, time);
      break;
    case 'box':
      drawMysteryBox(ctx, f.tx, f.ty, (s.state ?? 'closed') !== 'closed');
      break;
    case 'door':
      if (!s.open) drawDoor(ctx, f.def.tiles);
      break;
  }
}

/** Drawn on top of the lighting layer: the weapon name floating over an open mystery box. */
export function drawInteractableOverlay(ctx: CanvasRenderingContext2D, f: Fixture, s: InteractableView, time: number): void {
  if (f.kind !== 'box' || !s.state || s.state === 'closed' || !s.shown) return;
  const ready = s.state === 'ready';
  const x = (f.tx + 1) * TILE;
  const y = f.ty * TILE - 8 - (ready ? 4 + Math.sin(time * 4) * 2 : 0);
  const color = ready && (s.timer ?? 0) < 3 && Math.floor(time * 6) % 2 ? '#9a9a9a' : '#f2d15c';
  shadowText(ctx, WEAPONS[s.shown].name, x, y, 'bold 14px monospace', color, 'center', 'bottom');
}

export function drawPowerUps(ctx: CanvasRenderingContext2D, drops: DropView[], time: number): void {
  for (const d of drops) {
    if (d.life < 5 && Math.floor(time * 6) % 2 === 0) continue;
    const look = POWERUP_VISUALS[d.id];
    const y = d.y + Math.sin(time * 3 + d.x) * 3;
    const g = ctx.createRadialGradient(d.x, y, 0, d.x, y, 34);
    g.addColorStop(0, look.color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = g;
    ctx.fillRect(d.x - 34, y - 34, 68, 68);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#111';
    ctx.strokeStyle = look.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(d.x, y, 13, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = look.color;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(look.label, d.x, y + 1);
  }
}
