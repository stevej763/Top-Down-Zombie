import type { Vec2 } from '../core/math';
import type { PerkId, WeaponId } from './defs';
import { Tile, TILE, TileMap, type TileType } from './TileMap';

/** Room names are per map (e.g. 'tl', 'back'); they only have to agree within one map. */
export type RoomId = string;

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

/**
 * A map document as served by GET /api/maps/{id}, from the repo's maps/*.json. The server
 * (MapDoc.java / MapValidator.java) guarantees it is well formed and playable.
 * Tiles are one string per row: `.` outside, `_` floor, `#` wall, `W` window, `C` crate, `D` door.
 */
export interface MapDoc {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: string[];
  rooms: RoomId[];
  startRoom: RoomId;
  playerStart: { tx: number; ty: number };
  windows: WindowDef[];
  doors: DoorDef[];
  wallBuys: WallBuyDef[];
  perks: PerkSpot[];
  armour: WallSpot;
  upgrade: WallSpot;
  /** Left tile of the 2-tile mystery box; it's used from the tile row below. */
  box: { tx: number; ty: number };
  /** Optional. With one, the box, perks and upgrade bench need the power on, and the buildings have lights. */
  power?: WallSpot | null;
}

export interface MapData {
  id: string;
  name: string;
  map: TileMap;
  windows: WindowDef[];
  wallBuys: WallBuyDef[];
  perks: PerkSpot[];
  armour: WallSpot;
  upgrade: WallSpot;
  box: { tx: number; ty: number };
  doors: DoorDef[];
  power: WallSpot | null;
  startRoom: RoomId;
  playerStart: Vec2;
}

const TILE_CHARS: Record<string, TileType> = {
  '.': Tile.Outside, _: Tile.Floor, '#': Tile.Wall, W: Tile.Window, C: Tile.Crate, D: Tile.Door,
};

/** Build the playable map from a document. Returns fresh objects, so each run can mutate its own copy. */
export function parseMap(doc: MapDoc): MapData {
  const tiles: TileType[] = [];
  for (const row of doc.tiles) for (const c of row) tiles.push(TILE_CHARS[c] ?? Tile.Wall);
  return {
    id: doc.id,
    name: doc.name,
    map: new TileMap(doc.width, doc.height, tiles),
    windows: doc.windows.map((w) => ({ ...w })),
    wallBuys: doc.wallBuys.map((w) => ({ ...w })),
    perks: doc.perks.map((p) => ({ ...p })),
    armour: { ...doc.armour },
    upgrade: { ...doc.upgrade },
    box: { ...doc.box },
    doors: doc.doors.map((d) => ({ ...d, tiles: d.tiles.map(([x, y]) => [x, y] as [number, number]) })),
    power: doc.power ? { ...doc.power } : null,
    startRoom: doc.startRoom,
    playerStart: { x: doc.playerStart.tx * TILE + TILE / 2, y: doc.playerStart.ty * TILE + TILE / 2 },
  };
}
