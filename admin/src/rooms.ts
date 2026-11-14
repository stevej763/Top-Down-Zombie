import type { DoorDef, WallSpot, WindowDef } from '../../client/src/game/MapData';
import { at, DEFAULT_DOOR_COST, type Draft } from './model';

/**
 * Rooms aren't painted. As in the server's MapValidator, a room is a flood-filled area of floor
 * (furniture doesn't split it; walls, windows and doors do), named by the windows, doors and start
 * that touch it. The editor derives all of that from the tiles after every edit, so names always
 * agree: windows and doors come from the `W` and `D` tiles, and each area keeps the name most of
 * its tiles had before the edit.
 */

const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export interface Regions {
  /** Per cell: region index, or -1. Set on floor and the furniture inside rooms. */
  of: Int32Array;
  count: number;
}

export function floodRegions(d: Draft): Regions {
  const w = d.width;
  const of = new Int32Array(w * d.height).fill(-1);
  let count = 0;
  const open = (c: string) => c === '_' || c === 'C' || c === 'T';
  for (let start = 0; start < of.length; start++) {
    if (of[start] >= 0 || d.cells[start] !== '_') continue;
    const stack = [start];
    of[start] = count;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= d.height) continue;
        const n = ny * w + nx;
        if (of[n] < 0 && open(d.cells[n])) {
          of[n] = count;
          stack.push(n);
        }
      }
    }
    count++;
  }
  return { of, count };
}

/** The region of a floor tile, or -1 (only plain floor counts, as in the validator). */
export function regionAt(d: Draft, r: Regions, x: number, y: number): number {
  if (at(d, x, y) !== '_') return -1;
  return r.of[y * d.width + x];
}

/** The way out of a window: outside on that side and floor on the other, if it has one. */
function windowFacing(d: Draft, r: Regions, x: number, y: number, prev?: WindowDef): [number, number] {
  for (const [dx, dy] of DIRS) if (at(d, x + dx, y + dy) === '.' && regionAt(d, r, x - dx, y - dy) >= 0) return [dx, dy];
  if (prev && Math.abs(prev.dx) + Math.abs(prev.dy) === 1) return [prev.dx, prev.dy];
  for (const [dx, dy] of DIRS) if (at(d, x + dx, y + dy) === '.') return [dx, dy];
  return [0, -1];
}

/** Valid ways a wall fixture at (x, y) can face: toward a floor tile. */
export function wallFacings(d: Draft, r: Regions, x: number, y: number): [number, number][] {
  return DIRS.filter(([dx, dy]) => regionAt(d, r, x + dx, y + dy) >= 0);
}

/** Valid ways a perk machine at (x, y) can face: its back to a wall, its front to a floor tile. */
export function perkFacings(d: Draft, r: Regions, x: number, y: number): [number, number][] {
  return DIRS.filter(([dx, dy]) => at(d, x - dx, y - dy) === '#' && regionAt(d, r, x + dx, y + dy) >= 0);
}

function fixFacing(d: Draft, r: Regions, s: WallSpot, perk = false): void {
  if (at(d, s.tx, s.ty) !== (perk ? 'C' : '#')) return;
  const options = (perk ? perkFacings : wallFacings)(d, r, s.tx, s.ty);
  if (options.some(([x, y]) => x === s.nx && y === s.ny)) return;
  if (options[0]) [s.nx, s.ny] = options[0];
}

function doorGroups(d: Draft): [number, number][][] {
  const seen = new Uint8Array(d.cells.length);
  const groups: [number, number][][] = [];
  for (let i = 0; i < d.cells.length; i++) {
    if (seen[i] || d.cells[i] !== 'D') continue;
    const group: [number, number][] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % d.width, y = (j / d.width) | 0;
      group.push([x, y]);
      for (const [dx, dy] of DIRS) {
        const n = (y + dy) * d.width + (x + dx);
        if (at(d, x + dx, y + dy) === 'D' && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    group.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    groups.push(group);
  }
  return groups;
}

function doorRegions(d: Draft, r: Regions, tiles: [number, number][]): number[] {
  const touching = new Set<number>();
  for (const [x, y] of tiles) {
    for (const [dx, dy] of DIRS) {
      const g = regionAt(d, r, x + dx, y + dy);
      if (g >= 0) touching.add(g);
    }
  }
  return [...touching].sort((a, b) => a - b);
}

function freshName(taken: Set<string>): string {
  for (let n = 1; ; n++) if (!taken.has(`room-${n}`)) return `room-${n}`;
}

/**
 * Name the regions from the names the document's start, windows and doors give them, the way the
 * validator reads them. Used when a map is loaded (or an undo restores one).
 */
export function namesFromLabels(d: Draft): void {
  const r = floodRegions(d);
  const named = new Map<number, string>();
  const used = new Set<string>();
  const label = (g: number, name: string | undefined | null) => {
    if (g < 0 || !name || named.has(g) || used.has(name)) return;
    named.set(g, name);
    used.add(name);
  };
  if (d.playerStart) label(regionAt(d, r, d.playerStart.tx, d.playerStart.ty), d.startRoom);
  for (const w of d.windows) label(regionAt(d, r, w.tx - w.dx, w.ty - w.dy), w.room);
  for (const dr of d.doors) {
    const [a, b] = doorRegions(d, r, dr.tiles);
    if (a === undefined || b === undefined) continue;
    const swap = dr.rooms[1] === named.get(a) || dr.rooms[0] === named.get(b);
    label(swap ? b : a, dr.rooms[0]);
    label(swap ? a : b, dr.rooms[1]);
  }
  d.roomNames = Array.from(r.of, (g) => (g >= 0 ? named.get(g) ?? null : null));
}

/**
 * Re-derive everything that follows from the tiles: region names (each region takes the old name
 * most of its tiles had), windows and doors (keeping their order and door costs), the start room,
 * and wall fixtures turned to face floor. Call after every edit.
 */
export function normalize(d: Draft): Regions {
  const r = floodRegions(d);

  // Region names by overlap with the previous names.
  const votes: { g: number; name: string; n: number }[] = [];
  const tally: Map<string, number>[] = Array.from({ length: r.count }, () => new Map());
  for (let i = 0; i < r.of.length; i++) {
    const g = r.of[i], name = d.roomNames[i];
    if (g >= 0 && name) tally[g].set(name, (tally[g].get(name) ?? 0) + 1);
  }
  tally.forEach((m, g) => m.forEach((n, name) => votes.push({ g, name, n })));
  votes.sort((a, b) => b.n - a.n);
  const names: (string | null)[] = new Array(r.count).fill(null);
  const taken = new Set<string>();
  for (const v of votes) {
    if (names[v.g] || taken.has(v.name)) continue;
    names[v.g] = v.name;
    taken.add(v.name);
  }
  for (let g = 0; g < r.count; g++) {
    if (!names[g]) {
      names[g] = freshName(taken);
      taken.add(names[g]!);
    }
  }
  d.roomNames = Array.from(r.of, (g) => (g >= 0 ? names[g] : null));
  const nameAt = (x: number, y: number) => {
    const g = regionAt(d, r, x, y);
    return g >= 0 ? names[g]! : '';
  };

  // Windows: one per W tile, existing ones first in their old order.
  const prevWin = new Map(d.windows.map((w) => [`${w.tx},${w.ty}`, w]));
  const winTiles: [number, number][] = [];
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) if (at(d, x, y) === 'W') winTiles.push([x, y]);
  const order = (k: string) => {
    const i = d.windows.findIndex((w) => `${w.tx},${w.ty}` === k);
    return i < 0 ? Infinity : i;
  };
  winTiles.sort((a, b) => order(`${a[0]},${a[1]}`) - order(`${b[0]},${b[1]}`));
  d.windows = winTiles.map(([x, y]) => {
    const [dx, dy] = windowFacing(d, r, x, y, prevWin.get(`${x},${y}`));
    return { tx: x, ty: y, dx, dy, room: nameAt(x - dx, y - dy) };
  });

  // Doors: one per group of touching D tiles; a group inherits the cost of the old door it overlaps.
  const groups = doorGroups(d);
  const oldIndex = (g: [number, number][]) =>
    d.doors.findIndex((dr) => dr.tiles.some(([x, y]) => g.some(([gx, gy]) => gx === x && gy === y)));
  groups.sort((a, b) => {
    const ia = oldIndex(a), ib = oldIndex(b);
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
  });
  d.doors = groups.map((tiles): DoorDef => {
    const old = d.doors[oldIndex(tiles)];
    const regs = doorRegions(d, r, tiles);
    let rooms: [string, string] = [names[regs[0]] ?? '', names[regs[1]] ?? ''];
    // Keep the old order of the two names, so an untouched door doesn't change.
    if (old && old.rooms[0] === rooms[1] && old.rooms[1] === rooms[0]) rooms = [rooms[1], rooms[0]];
    return { tiles, cost: old?.cost ?? DEFAULT_DOOR_COST, rooms };
  });

  d.startRoom = d.playerStart ? nameAt(d.playerStart.tx, d.playerStart.ty) || null : null;
  for (const s of [...d.wallBuys, d.armour, d.upgrade, d.power]) if (s) fixFacing(d, r, s);
  for (const s of d.perks) fixFacing(d, r, s, true);
  return r;
}

/** Rename a room everywhere. Returns false if the name is taken or empty. */
export function renameRoom(d: Draft, from: string, to: string): boolean {
  to = to.trim();
  if (!to || to === from || d.roomNames.includes(to)) return false;
  d.roomNames = d.roomNames.map((n) => (n === from ? to : n));
  d.roomOrder = d.roomOrder.map((n) => (n === from ? to : n));
  for (const w of d.windows) if (w.room === from) w.room = to;
  for (const dr of d.doors) dr.rooms = dr.rooms.map((n) => (n === from ? to : n)) as [string, string];
  if (d.startRoom === from) d.startRoom = to;
  return true;
}
