import type { Vec2 } from '../core/math';
import { BASE_HP, magSize, MAX_PLANKS, reserveSize, STARTER_WEAPON, type PerkId, type WeaponId } from '../game/defs';
import { parseMap, type DoorDef, type MapData, type MapDoc, type WallSpot, type WindowDef } from '../game/MapData';
import { Tile, TILE, type TileMap } from '../game/TileMap';
import type { WorldView } from './WorldView';

/**
 * The static half of what the client draws: the parsed map plus where each window and buyable
 * thing sits. `WorldView.windows` and `WorldView.interactables` are indexed in the same order.
 */
export interface Level {
  data: MapData;
  windows: WindowFixture[];
  fixtures: Fixture[];
  /** The rooms the power lights up; empty on maps without a power switch. */
  lights: LightArea[];
}

/** One room (a flood-filled floor area, as the server's MapValidator finds them) and its ceiling lamps. */
export interface LightArea {
  /** Tile indices (y * width + x) of the room and the walls, windows and doors around it. */
  tiles: number[];
  lamps: Vec2[];
}

/** Roughly how far apart ceiling lamps hang, in tiles. */
const LAMP_SPACING = 6;

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
  | { kind: 'power'; spot: WallSpot }
);

export type FixtureKind = Fixture['kind'];

function standOf(spot: WallSpot): { x: number; y: number } {
  return { x: (spot.tx + spot.nx) * TILE + TILE / 2, y: (spot.ty + spot.ny) * TILE + TILE / 2 };
}

/** In the sim's interactable order: wall buys, perks, armour, upgrade, box, doors, power switch. */
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
  if (data.power) fixtures.push({ kind: 'power', spot: data.power, ...standOf(data.power) });
  return { data, windows, fixtures, lights: data.power ? lightAreas(data.map) : [] };
}

/** Rooms from the untouched map (doors still shut, so they split rooms), each with lamps spread over it. */
function lightAreas(map: TileMap): LightArea[] {
  const inRoom = (x: number, y: number) => {
    const t = map.get(x, y);
    return t === Tile.Floor || t === Tile.Crate;
  };
  const seen = new Uint8Array(map.w * map.h);
  const areas: LightArea[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || map.get(start % map.w, Math.floor(start / map.w)) !== Tile.Floor) continue;
    const room: number[] = [start];
    seen[start] = 1;
    for (let i = 0; i < room.length; i++) {
      const x = room[i] % map.w;
      const y = Math.floor(room[i] / map.w);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const n = ny * map.w + nx;
        if (inRoom(nx, ny) && !seen[n]) {
          seen[n] = 1;
          room.push(n);
        }
      }
    }
    // The walls around a room catch its light too.
    const lit = new Set(room);
    for (const i of room) {
      const x = i % map.w;
      const y = Math.floor(i / map.w);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && map.get(nx, ny) !== Tile.Outside) lit.add(ny * map.w + nx);
        }
      }
    }
    areas.push({ tiles: [...lit], lamps: lampsFor(map, room) });
  }
  return areas;
}

/** An even grid over the room's bounding box, keeping the points that land on its floor. */
function lampsFor(map: TileMap, room: number[]): Vec2[] {
  const xs = room.map((i) => i % map.w);
  const ys = room.map((i) => Math.floor(i / map.w));
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0 + 1;
  const h = Math.max(...ys) - y0 + 1;
  const cols = Math.max(1, Math.round(w / LAMP_SPACING));
  const rows = Math.max(1, Math.round(h / LAMP_SPACING));
  const lamps: Vec2[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Centred on a tile, so a lamp never straddles a crate or wall.
      const tx = Math.floor(x0 + ((c + 0.5) * w) / cols);
      const ty = Math.floor(y0 + ((r + 0.5) * h) / rows);
      if (map.get(tx, ty) === Tile.Floor) lamps.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
    }
  }
  return lamps;
}

/** A world before any snapshot: one player on the start tile, every window boarded, doors shut. Behind the menus. */
export function restingWorld(level: Level, playerId: number, name: string): WorldView {
  const start = level.data.playerStart;
  const w = STARTER_WEAPON;
  return {
    round: { n: 0, active: false, remaining: 0, intermission: 0 },
    power: !level.data.power,
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
