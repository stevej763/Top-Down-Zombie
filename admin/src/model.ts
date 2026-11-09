import type {
  DecorDef, DoorDef, MapDoc, PerkSpot, WallBuyDef, WallSpot, WindowDef,
} from '../../client/src/game/MapData';

/** The tile characters of a map document. See `MapDoc`. */
export type TileChar = '.' | '_' | '#' | 'W' | 'C' | 'D' | 'T';

export const TILES: { ch: TileChar; name: string; color: string; hint: string }[] = [
  { ch: '_', name: 'Floor', color: '#7a5a3a', hint: 'Walkable inside' },
  { ch: '#', name: 'Wall', color: '#4c4c57', hint: 'Blocks everything; wall buys, perks and switches mount here' },
  { ch: 'W', name: 'Window', color: '#9ab8d8', hint: 'In an outer wall, outside on one side, floor on the other' },
  { ch: 'D', name: 'Door', color: '#b07a40', hint: 'Touching tiles make one door between two rooms' },
  { ch: 'C', name: 'Crate', color: '#6d5130', hint: 'Tall: blocks walking and bullets' },
  { ch: 'T', name: 'Low', color: '#8a7a5a', hint: 'Low furniture: blocks walking, bullets pass over' },
  { ch: '.', name: 'Outside', color: '#1b2117', hint: 'The yard zombies come from' },
];

export type Face = 'n' | 'e' | 's' | 'w';

/** Things with one spot each. `wallBuy`/`perk` can have many. */
export type PlaceKind = 'start' | 'wallBuy' | 'perk' | 'armour' | 'upgrade' | 'box' | 'power';

/**
 * The map being edited. Like a `MapDoc`, but with a flat tile array, the single fixtures nullable
 * until placed, and the room name of every floor tile (editor-only: rooms are derived, see rooms.ts).
 * Windows and doors are derived from the `W` and `D` tiles; only door costs are really edited.
 */
export interface Draft {
  id: string;
  name: string;
  width: number;
  height: number;
  cells: TileChar[];
  playerStart: { tx: number; ty: number } | null;
  windows: WindowDef[];
  doors: DoorDef[];
  wallBuys: WallBuyDef[];
  perks: PerkSpot[];
  armour: WallSpot | null;
  upgrade: WallSpot | null;
  box: { tx: number; ty: number } | null;
  power: WallSpot | null;
  decor: DecorDef[];
  /** Order rooms are listed in the document (kept from the loaded map, so saves diff cleanly). */
  roomOrder: string[];
  /** Per cell: the room the region holding it is called, or null for walls and outside. */
  roomNames: (string | null)[];
  startRoom: string | null;
}

export const DEFAULT_DOOR_COST = 750;

export function at(d: Draft, x: number, y: number): TileChar {
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return '#';
  return d.cells[y * d.width + x];
}

export function inside(d: Draft, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < d.width && y < d.height;
}

export function setCell(d: Draft, x: number, y: number, ch: TileChar): void {
  if (inside(d, x, y)) d.cells[y * d.width + x] = ch;
}

export function blankDraft(id: string, name: string, width: number, height: number): Draft {
  return {
    id, name, width, height,
    cells: new Array<TileChar>(width * height).fill('.'),
    playerStart: null,
    windows: [], doors: [], wallBuys: [], perks: [],
    armour: null, upgrade: null, box: null, power: null,
    decor: [],
    roomOrder: [],
    roomNames: new Array(width * height).fill(null),
    startRoom: null,
  };
}

export function fromDoc(doc: MapDoc): Draft {
  const cells: TileChar[] = [];
  for (let y = 0; y < doc.height; y++) {
    const row = doc.tiles[y] ?? '';
    for (let x = 0; x < doc.width; x++) cells.push((row[x] ?? '#') as TileChar);
  }
  return {
    id: doc.id,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    cells,
    playerStart: doc.playerStart ? { ...doc.playerStart } : null,
    windows: (doc.windows ?? []).map((w) => ({ ...w })),
    doors: (doc.doors ?? []).map((dr) => ({ ...dr, tiles: dr.tiles.map(([x, y]) => [x, y] as [number, number]), rooms: [...dr.rooms] as [string, string] })),
    wallBuys: (doc.wallBuys ?? []).map((s) => ({ ...s })),
    perks: (doc.perks ?? []).map((s) => ({ ...s })),
    armour: doc.armour ? { ...doc.armour } : null,
    upgrade: doc.upgrade ? { ...doc.upgrade } : null,
    box: doc.box ? { ...doc.box } : null,
    power: doc.power ? { ...doc.power } : null,
    decor: (doc.decor ?? []).map((dc) => ({ ...dc })),
    roomOrder: [...(doc.rooms ?? [])],
    roomNames: new Array(doc.width * doc.height).fill(null),
    startRoom: doc.startRoom ?? null,
  };
}

/** Rooms that something (start, window, door) names: the document's `rooms`. */
export function usedRooms(d: Draft): string[] {
  const used = new Set<string>();
  if (d.startRoom) used.add(d.startRoom);
  for (const w of d.windows) used.add(w.room);
  for (const dr of d.doors) for (const r of dr.rooms) used.add(r);
  const ordered = d.roomOrder.filter((r) => used.has(r));
  for (const r of used) if (!ordered.includes(r)) ordered.push(r);
  return ordered;
}

/**
 * The map document. Fixtures that haven't been placed yet are written as null, which the validator
 * reports, so an unfinished map can still be downloaded but not saved to the server.
 */
export function toDoc(d: Draft): MapDoc {
  const tiles: string[] = [];
  for (let y = 0; y < d.height; y++) tiles.push(d.cells.slice(y * d.width, (y + 1) * d.width).join(''));
  const doc = {
    id: d.id,
    name: d.name,
    width: d.width,
    height: d.height,
    tiles,
    rooms: usedRooms(d),
    startRoom: d.startRoom,
    playerStart: d.playerStart,
    windows: d.windows,
    doors: d.doors,
    wallBuys: d.wallBuys,
    perks: d.perks,
    armour: d.armour,
    upgrade: d.upgrade,
    box: d.box,
    ...(d.power ? { power: d.power } : {}),
    ...(d.decor.length ? { decor: d.decor } : {}),
  };
  return structuredClone(doc) as unknown as MapDoc;
}

/** Copy into a new size, anchored top-left; new tiles are outside and anything off the edge is dropped. */
export function resize(d: Draft, width: number, height: number): Draft {
  const out: Draft = { ...structuredClone(d), width, height };
  out.cells = [];
  out.roomNames = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out.cells.push(inside(d, x, y) ? at(d, x, y) : '.');
      out.roomNames.push(inside(d, x, y) ? d.roomNames[y * d.width + x] : null);
    }
  }
  const fits = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const spot = <T extends { tx: number; ty: number }>(s: T | null) => (s && fits(s.tx, s.ty) ? s : null);
  out.playerStart = spot(out.playerStart);
  out.armour = spot(out.armour);
  out.upgrade = spot(out.upgrade);
  out.power = spot(out.power);
  out.box = out.box && fits(out.box.tx + 1, out.box.ty) ? out.box : null;
  out.wallBuys = out.wallBuys.filter((s) => fits(s.tx, s.ty));
  out.perks = out.perks.filter((s) => fits(s.tx, s.ty));
  out.decor = out.decor.filter((dc) => dc.tx + dc.w <= width && dc.ty + dc.h <= height);
  return out;
}

// ------------------------------------------------------------------ decor catalogue

export interface DecorKind {
  kind: string;
  label: string;
  group: string;
  /** Size when facing south; east/west swap them. */
  w: number;
  h: number;
  /** The tile it makes solid when placed ('' for none: floors, rugs, the fireplace on its wall). */
  solid: '' | 'T' | 'C';
  /** Dragged out as a rectangle of any size, rather than stamped. */
  area?: boolean;
  /** Floor finishes are drawn before rugs, so they're kept at the front of the decor list. */
  floor?: boolean;
}

/** What `client/src/render/furniture.ts` can draw, with the sizes and solidity the built-in maps use. */
export const DECOR: DecorKind[] = [
  { kind: 'carpet', label: 'Carpet', group: 'Floors', w: 4, h: 4, solid: '', area: true, floor: true },
  { kind: 'checker', label: 'Checker tiles', group: 'Floors', w: 4, h: 4, solid: '', area: true, floor: true },
  { kind: 'tile', label: 'Bathroom tiles', group: 'Floors', w: 4, h: 4, solid: '', area: true, floor: true },
  { kind: 'concrete', label: 'Concrete', group: 'Floors', w: 4, h: 4, solid: '', area: true, floor: true },
  { kind: 'straw', label: 'Straw', group: 'Floors', w: 4, h: 4, solid: '', area: true, floor: true },
  { kind: 'rug', label: 'Rug', group: 'Floors', w: 6, h: 4, solid: '', area: true },
  { kind: 'oilStain', label: 'Oil stain', group: 'Floors', w: 2, h: 2, solid: '', area: true },

  { kind: 'sofa', label: 'Sofa', group: 'Living', w: 4, h: 1, solid: 'T' },
  { kind: 'armchair', label: 'Armchair', group: 'Living', w: 1, h: 1, solid: 'T' },
  { kind: 'coffeeTable', label: 'Coffee table', group: 'Living', w: 2, h: 1, solid: 'T' },
  { kind: 'tv', label: 'TV', group: 'Living', w: 3, h: 1, solid: 'T' },
  { kind: 'endTable', label: 'End table', group: 'Living', w: 1, h: 1, solid: 'T' },
  { kind: 'bookshelf', label: 'Bookshelf', group: 'Living', w: 3, h: 1, solid: 'C' },
  { kind: 'plant', label: 'Plant', group: 'Living', w: 1, h: 1, solid: 'C' },
  { kind: 'piano', label: 'Piano', group: 'Living', w: 2, h: 1, solid: 'C' },
  { kind: 'fireplace', label: 'Fireplace (on a wall)', group: 'Living', w: 2, h: 1, solid: '' },

  { kind: 'counter', label: 'Counter', group: 'Kitchen', w: 1, h: 1, solid: 'T' },
  { kind: 'sink', label: 'Sink', group: 'Kitchen', w: 2, h: 1, solid: 'T' },
  { kind: 'stove', label: 'Stove', group: 'Kitchen', w: 1, h: 1, solid: 'T' },
  { kind: 'fridge', label: 'Fridge', group: 'Kitchen', w: 1, h: 1, solid: 'C' },
  { kind: 'island', label: 'Island', group: 'Kitchen', w: 4, h: 1, solid: 'T' },
  { kind: 'diningTable', label: 'Dining table', group: 'Kitchen', w: 3, h: 2, solid: 'T' },
  { kind: 'hutch', label: 'Hutch', group: 'Kitchen', w: 2, h: 1, solid: 'C' },
  { kind: 'bin', label: 'Bin', group: 'Kitchen', w: 1, h: 1, solid: 'C' },

  { kind: 'bed', label: 'Bed', group: 'Bedroom', w: 2, h: 3, solid: 'T' },
  { kind: 'nightstand', label: 'Nightstand', group: 'Bedroom', w: 1, h: 1, solid: 'T' },
  { kind: 'wardrobe', label: 'Wardrobe', group: 'Bedroom', w: 2, h: 1, solid: 'C' },
  { kind: 'desk', label: 'Desk', group: 'Bedroom', w: 3, h: 1, solid: 'T' },
  { kind: 'toilet', label: 'Toilet', group: 'Bedroom', w: 1, h: 1, solid: 'C' },
  { kind: 'basin', label: 'Basin', group: 'Bedroom', w: 1, h: 1, solid: 'T' },
  { kind: 'bath', label: 'Bath', group: 'Bedroom', w: 3, h: 1, solid: 'T' },

  { kind: 'car', label: 'Car', group: 'Garage & farm', w: 2, h: 4, solid: 'T' },
  { kind: 'shelves', label: 'Shelves', group: 'Garage & farm', w: 4, h: 1, solid: 'C' },
  { kind: 'washer', label: 'Washer', group: 'Garage & farm', w: 1, h: 1, solid: 'C' },
  { kind: 'workbench', label: 'Workbench', group: 'Garage & farm', w: 3, h: 1, solid: 'T' },
  { kind: 'toolChest', label: 'Tool chest', group: 'Garage & farm', w: 1, h: 1, solid: 'C' },
  { kind: 'hay', label: 'Hay bales', group: 'Garage & farm', w: 2, h: 1, solid: 'C' },
  { kind: 'tractor', label: 'Tractor', group: 'Garage & farm', w: 2, h: 4, solid: 'T' },
  { kind: 'trough', label: 'Trough', group: 'Garage & farm', w: 3, h: 1, solid: 'T' },
  { kind: 'barrel', label: 'Barrel', group: 'Garage & farm', w: 1, h: 1, solid: 'C' },
  { kind: 'generator', label: 'Generator', group: 'Garage & farm', w: 3, h: 2, solid: 'C' },
];

export const DECOR_BY_KIND = new Map(DECOR.map((k) => [k.kind, k]));

/** Footprint of a stamped piece facing `face`. */
export function footprint(k: DecorKind, face: Face): { w: number; h: number } {
  return face === 'e' || face === 'w' ? { w: k.h, h: k.w } : { w: k.w, h: k.h };
}

export const FACES: Face[] = ['s', 'w', 'n', 'e'];
