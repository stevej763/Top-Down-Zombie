import type { Vec2 } from '../core/math';
import { BASE_HP, magSize, MAX_PLANKS, reserveSize, STARTER_WEAPON, type PerkId, type WeaponId } from '../game/defs';
import { parseMap, type DoorDef, type MapData, type MapDoc, type WallSpot, type WindowDef } from '../game/MapData';
import { TILE } from '../game/TileMap';
import type { WorldView } from './WorldView';

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

/** A world before any snapshot: one player on the start tile, every window boarded, doors shut. Behind the menus. */
export function restingWorld(level: Level, playerId: number, name: string): WorldView {
  const start = level.data.playerStart;
  const w = STARTER_WEAPON;
  return {
    round: { n: 0, active: false, remaining: 0, intermission: 0 },
    powerUps: { instakill: 0, double: 0, drops: [] },
    players: [{
      id: playerId, name, x: start.x, y: start.y, aim: 0, hp: BASE_HP, maxHp: BASE_HP, state: 'alive', bleedout: 0,
      reviveProgress: 0, armour: 0, armourLevel: 0, points: 0, kills: 0, slot: 0,
      weapons: [{ id: w, tier: 0, mag: magSize(w, 0), reserve: reserveSize(w, 0), reloadProgress: 0 }, null],
      perks: [], invuln: 0, interaction: null,
    }],
    zombies: [],
    windows: level.windows.map(() => MAX_PLANKS),
    interactables: level.fixtures.map((f) => (f.kind === 'door' ? { open: false } : f.kind === 'box' ? { state: 'closed', timer: 0, owner: -1 } : {})),
  };
}
