import { TILE, TileMap } from '../game/TileMap';
import type { Level } from '../view/Level';
import { heldWeapon, type WorldView } from '../view/WorldView';
import { glowOf, WEAPON_FX, type PlayerFx } from './visuals';

const DARKNESS = 'rgba(4, 5, 10, 0.86)';
const FLASHLIGHT_RANGE = 430;
const FLASHLIGHT_HALF_ANGLE = 0.5;
/** Rays cast across the torch cone to stop it at walls. */
const FLASHLIGHT_RAYS = 120;
/** How far the beam reaches into the wall it stops at, so the wall's face is lit. */
const FLASHLIGHT_WALL_BLEED = 10;
/** Share of the torch that shows through walls, so you can just make out rooms you haven't opened. */
const FLASHLIGHT_LEAK = 0.1;
/** The small glow around every player, so the floor at their feet is never pitch black. */
const PLAYER_GLOW_RADIUS = 55;
const PLAYER_GLOW = 0.75;
/** "r, g, b" of the room lights. */
const ROOM_LIGHT = '255, 225, 170';
/** How much of the darkness the room lights lift: evenly across a room, and extra under each lamp. */
const ROOM_FILL = 0.5;
const LAMP_GLOW = 0.5;
const LAMP_RADIUS = 6 * TILE;
/** Share of the darkness the lights mask removes at full strength; the rest keeps the mood. */
const ROOM_LIGHT_STRENGTH = 0.92;
/** Warm tint the lights add on top. */
const ROOM_TINT = 0.07;

/** Darkness overlay with lights punched out of it (each player's glow and torch, windows, room lights). */
export class Lighting {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** The room lights for `roomsOf`, drawn once per level at map size. */
  private rooms: HTMLCanvasElement | null = null;
  private roomsOf: Level | null = null;

  constructor(private w: number, private h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** `fxOf` gives each player's muzzle-flash state; `light` is how bright the room lights are, 0..1. */
  draw(
    target: CanvasRenderingContext2D, level: Level, world: WorldView, fxOf: (id: number) => PlayerFx, camX: number, camY: number,
    light: number,
  ): void {
    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = DARKNESS;
    c.fillRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'destination-out';

    const rooms = light > 0 ? this.roomLights(level) : null;
    if (rooms) {
      c.globalAlpha = light * ROOM_LIGHT_STRENGTH;
      c.drawImage(rooms, -camX, -camY);
      c.globalAlpha = 1;
    }

    // Each player gives off a small glow and, while the room lights are off, a torch;
    // a downed player's torch has dropped, so only their glow is left.
    const lit = world.players.filter((p) => p.state !== 'dead');
    for (const p of lit) this.glow(p.x - camX, p.y - camY, PLAYER_GLOW_RADIUS, PLAYER_GLOW);
    const torch = 1 - light;
    if (torch > 0) {
      for (const p of lit) {
        if (p.state !== 'alive') continue;
        const px = p.x - camX;
        const py = p.y - camY;
        const g = c.createRadialGradient(px, py, 20, px, py, FLASHLIGHT_RANGE);
        g.addColorStop(0, `rgba(0, 0, 0, ${0.95 * torch})`);
        g.addColorStop(0.7, `rgba(0, 0, 0, ${0.6 * torch})`);
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        c.fillStyle = g;
        // A faint copy of the whole cone leaks through walls; the traced beam goes on top.
        c.globalAlpha = FLASHLIGHT_LEAK;
        c.beginPath();
        c.moveTo(px, py);
        c.arc(px, py, FLASHLIGHT_RANGE, p.aim - FLASHLIGHT_HALF_ANGLE, p.aim + FLASHLIGHT_HALF_ANGLE);
        c.closePath();
        c.fill();
        c.globalAlpha = 1;
        this.torchShape(level.data.map, p.x, p.y, p.aim, camX, camY);
        c.fill();
      }
    }

    for (const b of level.windows) this.glow(b.center.x - camX, b.center.y - camY, 110, 0.55);
    for (const f of level.fixtures) {
      if (glowOf(f, world.power)) this.glow(f.x - camX, f.y - camY, 60, 0.45);
    }
    for (const d of world.powerUps.drops) this.glow(d.x - camX, d.y - camY, 70, 0.6);
    const firing = lit.filter((p) => p.state === 'alive' && fxOf(p.id).flash > 0);
    for (const p of firing) this.glow(p.x - camX, p.y - camY, 260, 0.7);

    target.drawImage(this.canvas, 0, 0);

    // Coloured light from machines, added on top of the darkness.
    target.save();
    target.globalCompositeOperation = 'lighter';
    if (rooms) {
      target.globalAlpha = light * ROOM_TINT;
      target.drawImage(rooms, -camX, -camY);
      target.globalAlpha = 1;
    }
    for (const f of level.fixtures) {
      const glow = glowOf(f, world.power);
      if (!glow) continue;
      const x = f.x - camX;
      const y = f.y - camY;
      const g = target.createRadialGradient(x, y, 0, x, y, 70);
      g.addColorStop(0, `rgba(${glow}, 0.22)`);
      g.addColorStop(1, `rgba(${glow}, 0)`);
      target.fillStyle = g;
      target.fillRect(x - 70, y - 70, 140, 140);
    }
    for (const p of firing) {
      // Muzzle light in the gun's own colour.
      const fx = WEAPON_FX[heldWeapon(p).id];
      const md = 24 + fx.barrel;
      const x = p.x - camX + Math.cos(p.aim) * md;
      const y = p.y - camY + Math.sin(p.aim) * md;
      const r = 110 * fx.flashSize;
      const g = target.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${fx.flash}, 0.35)`);
      g.addColorStop(1, `rgba(${fx.flash}, 0)`);
      target.fillStyle = g;
      target.fillRect(x - r, y - r, r * 2, r * 2);
    }
    target.restore();
  }

  /** Each room filled evenly plus a pool under each lamp, clipped to the room and its walls. Null without any. */
  private roomLights(level: Level): HTMLCanvasElement | null {
    if (this.roomsOf === level) return this.rooms;
    this.roomsOf = level;
    this.rooms = null;
    if (level.lights.length === 0) return null;
    const map = level.data.map;
    const canvas = document.createElement('canvas');
    canvas.width = map.pxW;
    canvas.height = map.pxH;
    const c = canvas.getContext('2d')!;
    for (const area of level.lights) {
      c.save();
      c.beginPath();
      for (const i of area.tiles) c.rect((i % map.w) * TILE, Math.floor(i / map.w) * TILE, TILE, TILE);
      c.clip();
      c.fillStyle = `rgba(${ROOM_LIGHT}, ${ROOM_FILL})`;
      c.fillRect(0, 0, map.pxW, map.pxH);
      for (const l of area.lamps) {
        const g = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, LAMP_RADIUS);
        g.addColorStop(0, `rgba(${ROOM_LIGHT}, ${LAMP_GLOW})`);
        g.addColorStop(1, `rgba(${ROOM_LIGHT}, 0)`);
        c.fillStyle = g;
        c.fillRect(l.x - LAMP_RADIUS, l.y - LAMP_RADIUS, LAMP_RADIUS * 2, LAMP_RADIUS * 2);
      }
      c.restore();
    }
    this.rooms = canvas;
    return canvas;
  }

  /** The torch cone as a path, cut short wherever a wall, crate or closed door blocks it (windows and open doors let it through). */
  private torchShape(map: TileMap, x: number, y: number, aim: number, camX: number, camY: number): void {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x - camX, y - camY);
    for (let i = 0; i <= FLASHLIGHT_RAYS; i++) {
      const a = aim - FLASHLIGHT_HALF_ANGLE + (2 * FLASHLIGHT_HALF_ANGLE * i) / FLASHLIGHT_RAYS;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const hit = map.rayTo(x, y, dx, dy, FLASHLIGHT_RANGE, TileMap.blocksBullets);
      const d = Math.min(FLASHLIGHT_RANGE, hit + (hit < FLASHLIGHT_RANGE ? FLASHLIGHT_WALL_BLEED : 0));
      c.lineTo(x + dx * d - camX, y + dy * d - camY);
    }
    c.closePath();
  }

  private glow(x: number, y: number, r: number, strength: number): void {
    const c = this.ctx;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0, 0, 0, ${strength})`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
