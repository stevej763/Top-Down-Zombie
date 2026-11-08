import type { Vec2 } from '../core/math';
import type { PerkId } from '../systems/Perks';
import type { WeaponId } from '../weapons/WeaponDefs';
import { Tile, TILE, TileMap, type TileType } from './TileMap';

export type RoomId = 'tl' | 'tr' | 'bl' | 'br';

/** A window in an outer wall. (dx, dy) points outward, away from the building. */
export interface WindowDef {
  tx: number;
  ty: number;
  dx: number;
  dy: number;
  room: RoomId;
}

/** Something mounted on a wall tile. (nx, ny) points from the wall toward the floor you use it from. */
export interface WallSpot {
  tx: number;
  ty: number;
  nx: number;
  ny: number;
}

export interface WallBuyDef extends WallSpot {
  weapon: WeaponId;
}

export interface PerkSpot extends WallSpot {
  perk: PerkId;
}

export interface DoorDef {
  tiles: [number, number][];
  cost: number;
  rooms: [RoomId, RoomId];
}

export interface MapData {
  map: TileMap;
  windows: WindowDef[];
  wallBuys: WallBuyDef[];
  perks: PerkSpot[];
  armour: WallSpot;
  upgrade: WallSpot;
  /** Left tile of the 2-tile mystery box; it's used from the tile row below. */
  box: { tx: number; ty: number };
  doors: DoorDef[];
  startRoom: RoomId;
  playerStart: Vec2;
}

const W = 40;
const H = 30;

/**
 * One building with four rooms, surrounded by yard. You start in the top-left room;
 * the others are behind doors.
 *   Outer walls: x=4..35, y=4..25
 *   Interior walls: x=19 (doors at y 9-11, 18-20); y=14 (doors at x 10-12, 26-28)
 *
 *   TL (start): Shotgun, Second Wind      TR: Rapid Fire, Mystery Box
 *   BL: SMG, Tough Hide, Armour           BR: Rifle, Quick Hands, Upgrade bench
 */
export function buildMap(): MapData {
  const tiles: TileType[] = new Array(W * H).fill(Tile.Outside);
  const set = (x: number, y: number, t: TileType) => { tiles[y * W + x] = t; };

  for (let y = 4; y <= 25; y++) {
    for (let x = 4; x <= 35; x++) {
      set(x, y, x === 4 || x === 35 || y === 4 || y === 25 ? Tile.Wall : Tile.Floor);
    }
  }
  for (let y = 4; y <= 25; y++) set(19, y, Tile.Wall);
  for (let x = 4; x <= 35; x++) set(x, 14, Tile.Wall);

  const doors: DoorDef[] = [
    { tiles: [[19, 9], [19, 10], [19, 11]], cost: 750, rooms: ['tl', 'tr'] },
    { tiles: [[10, 14], [11, 14], [12, 14]], cost: 750, rooms: ['tl', 'bl'] },
    { tiles: [[26, 14], [27, 14], [28, 14]], cost: 1000, rooms: ['tr', 'br'] },
    { tiles: [[19, 18], [19, 19], [19, 20]], cost: 1000, rooms: ['bl', 'br'] },
  ];
  for (const d of doors) for (const [x, y] of d.tiles) set(x, y, Tile.Door);

  const box = { tx: 31, ty: 5 };
  // Crates for cover, plus the two tiles the mystery box sits on.
  for (const [x, y] of [[14, 10], [15, 10], [14, 11], [15, 11], [25, 20], [26, 20], [25, 21], [26, 21], [27, 11], [box.tx, box.ty], [box.tx + 1, box.ty]]) {
    set(x, y, Tile.Crate);
  }

  const windows: WindowDef[] = [
    { tx: 11, ty: 4, dx: 0, dy: -1, room: 'tl' },
    { tx: 4, ty: 9, dx: -1, dy: 0, room: 'tl' },
    { tx: 28, ty: 4, dx: 0, dy: -1, room: 'tr' },
    { tx: 35, ty: 9, dx: 1, dy: 0, room: 'tr' },
    { tx: 4, ty: 19, dx: -1, dy: 0, room: 'bl' },
    { tx: 12, ty: 25, dx: 0, dy: 1, room: 'bl' },
    { tx: 29, ty: 25, dx: 0, dy: 1, room: 'br' },
    { tx: 35, ty: 22, dx: 1, dy: 0, room: 'br' },
  ];
  for (const w of windows) set(w.tx, w.ty, Tile.Window);

  return {
    map: new TileMap(W, H, tiles),
    windows,
    wallBuys: [
      { tx: 15, ty: 4, nx: 0, ny: 1, weapon: 'shotgun' },
      { tx: 4, ty: 22, nx: 1, ny: 0, weapon: 'smg' },
      { tx: 35, ty: 18, nx: -1, ny: 0, weapon: 'rifle' },
    ],
    perks: [
      { tx: 19, ty: 6, nx: -1, ny: 0, perk: 'secondWind' },
      { tx: 24, ty: 4, nx: 0, ny: 1, perk: 'rapidFire' },
      { tx: 19, ty: 23, nx: -1, ny: 0, perk: 'toughHide' },
      { tx: 19, ty: 16, nx: 1, ny: 0, perk: 'quickHands' },
    ],
    armour: { tx: 8, ty: 25, nx: 0, ny: -1 },
    upgrade: { tx: 23, ty: 25, nx: 0, ny: -1 },
    box,
    doors,
    startRoom: 'tl',
    playerStart: { x: 9 * TILE + TILE / 2, y: 9 * TILE + TILE / 2 },
  };
}
