import type { Vec2 } from '../core/math';
import type { PerkId, WeaponId } from '../sim/defs';
import { parseMap, type DoorDef, type MapData, type MapDoc, type WallSpot, type WindowDef } from '../sim/MapData';
import { TILE } from '../sim/TileMap';

/**
 * The static half of what the client draws: the parsed map plus where each window and buyable
 * thing sits. `WorldView.windows` and `WorldView.interactables` are indexed in the same order.
 */
export interface Level {
  data: MapData;
  windows: WindowFixture[];
  fixtures: Fixture[];
}

export interface WindowFixture {
  def: WindowDef;
  center: Vec2;
  /** True when the window sits in a horizontal (top/bottom) wall. */
  horizontal: boolean;
}

/** `x`, `y` is where it's used from (the sims' `standX`/`standY`); its glow is centred there. */
export type Fixture = { x: number; y: number } & (
  | { kind: 'wallBuy'; spot: WallSpot; weapon: WeaponId }
  | { kind: 'perk'; spot: WallSpot; perk: PerkId }
  | { kind: 'armour'; spot: WallSpot }
  | { kind: 'upgrade'; spot: WallSpot }
  /** Left tile of the 2-tile box. */
  | { kind: 'box'; tx: number; ty: number }
  | { kind: 'door'; def: DoorDef }
);

export type FixtureKind = Fixture['kind'];

function standOf(spot: WallSpot): { x: number; y: number } {
  return { x: (spot.tx + spot.nx) * TILE + TILE / 2, y: (spot.ty + spot.ny) * TILE + TILE / 2 };
}

/** In the sims' interactable order: wall buys, perks, armour, upgrade, box, doors. */
export function buildLevel(doc: MapDoc): Level {
  const data = parseMap(doc);
  const windows = data.windows.map((def): WindowFixture => ({
    def,
    center: { x: def.tx * TILE + TILE / 2, y: def.ty * TILE + TILE / 2 },
    horizontal: def.dy !== 0,
  }));
  const fixtures: Fixture[] = [
    ...data.wallBuys.map((s): Fixture => ({ kind: 'wallBuy', spot: s, weapon: s.weapon, ...standOf(s) })),
    ...data.perks.map((s): Fixture => ({ kind: 'perk', spot: s, perk: s.perk, ...standOf(s) })),
    { kind: 'armour', spot: data.armour, ...standOf(data.armour) },
    { kind: 'upgrade', spot: data.upgrade, ...standOf(data.upgrade) },
    { kind: 'box', tx: data.box.tx, ty: data.box.ty, x: (data.box.tx + 1) * TILE, y: (data.box.ty + 1) * TILE + TILE / 2 },
    ...data.doors.map((def): Fixture => {
      const [tx, ty] = def.tiles[Math.floor(def.tiles.length / 2)];
      return { kind: 'door', def, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
    }),
  ];
  return { data, windows, fixtures };
}
