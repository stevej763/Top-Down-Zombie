import { PERKS, WEAPONS } from '../../client/src/game/defs';
import type { MapDoc, WallSpot } from '../../client/src/game/MapData';

/**
 * A copy of the server's MapValidator (server/sim/.../map/MapValidator.java), for live feedback
 * while drawing. Keep the two in step. The server still checks every upload, so a drift only
 * means the editor gets an error back on save.
 */

export interface Problem {
  msg: string;
  /** A tile to point at, when there is one. */
  at?: [number, number];
}

const ID_PATTERN = /^[a-z0-9-]{1,40}$/;
const TILE_CHARS = '._#WCDT';
const MIN_SIZE = 10;
const MAX_SIZE = 200;
const MAX_DOOR_COST = 100_000;
const DECOR_KIND = /^[a-zA-Z]{1,30}$/;
const FACES = new Set(['n', 'e', 's', 'w']);
const MAX_DECOR = 1000;

type Loose<T> = { [K in keyof T]: T[K] | null | undefined };

export function validate(doc: Loose<MapDoc>): Problem[] {
  const errors: Problem[] = [];
  const err = (msg: string, x?: number, y?: number) => errors.push(x === undefined ? { msg } : { msg, at: [x, y!] });
  const m = doc;

  if (!m.id || !ID_PATTERN.test(m.id)) err('id must match ^[a-z0-9-]{1,40}$ (lower-case letters, digits, dashes)');
  if (!m.name || !m.name.trim() || m.name.length > 40) err('name must be 1-40 characters');

  const width = m.width ?? 0, height = m.height ?? 0;
  if (width < MIN_SIZE || width > MAX_SIZE || height < MIN_SIZE || height > MAX_SIZE) {
    err(`width and height must be ${MIN_SIZE}-${MAX_SIZE}`);
    return errors;
  }
  const tiles = m.tiles ?? [];
  if (tiles.length !== height) {
    err(`tiles must have exactly height (${height}) rows`);
    return errors;
  }
  let gridOk = true;
  tiles.forEach((row, y) => {
    if (row.length !== width) { err(`tiles row ${y} must be width (${width}) characters`); gridOk = false; }
    else if ([...row].some((c) => !TILE_CHARS.includes(c))) { err(`tiles row ${y} has characters outside "${TILE_CHARS}"`); gridOk = false; }
  });
  if (!gridOk) return errors;

  const missing: string[] = [];
  if (!m.playerStart) missing.push('the player start');
  if (!m.armour) missing.push('the armour bench');
  if (!m.upgrade) missing.push('the upgrade bench');
  if (!m.box) missing.push('the mystery box');
  if (missing.length) {
    err(`place ${missing.join(', ')}`);
    return errors;
  }
  const rooms = m.rooms ?? [];
  const windows = m.windows ?? [];
  const doors = m.doors ?? [];
  if (!m.startRoom) err('playerStart must be on a floor tile', m.playerStart!.tx, m.playerStart!.ty);
  if (!rooms.length) err('rooms must not be empty');
  if (new Set(rooms).size !== rooms.length) err('rooms contains duplicates');
  if (!windows.length) err('needs at least one window');

  const atc = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? '#' : tiles[y][x]);

  // Flood regions.
  const region = new Int32Array(width * height).fill(-1);
  let next = 0;
  for (let start = 0; start < region.length; start++) {
    if (region[start] >= 0 || atc(start % width, (start / width) | 0) !== '_') continue;
    const stack = [start];
    region[start] = next;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        const c = atc(nx, ny);
        if ((c === '_' || c === 'C' || c === 'T') && region[ny * width + nx] < 0) {
          region[ny * width + nx] = next;
          stack.push(ny * width + nx);
        }
      }
    }
    next++;
  }
  const regionAt = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height || atc(x, y) !== '_' ? -1 : region[y * width + x]);
  const regionRoom = new Map<number, string>();
  const roomRegion = new Map<string, number>();
  const label = (r: number, room: string, what: string, x: number, y: number) => {
    if (!rooms.includes(room)) { err(`${what}: unknown room "${room}"`, x, y); return; }
    const had = regionRoom.get(r);
    const hadRegion = roomRegion.get(room);
    if (had !== undefined && had !== room) err(`${what}: that area is room "${had}", not "${room}"`, x, y);
    else if (hadRegion !== undefined && hadRegion !== r) err(`${what}: room "${room}" is already a different, unconnected area`, x, y);
    else { regionRoom.set(r, room); roomRegion.set(room, r); }
  };

  // Start.
  const p = m.playerStart!;
  const sr = regionAt(p.tx, p.ty);
  if (sr < 0) err('playerStart must be on a floor tile', p.tx, p.ty);
  else if (m.startRoom) label(sr, m.startRoom, 'playerStart', p.tx, p.ty);

  // Windows.
  for (const w of windows) {
    const what = `window at ${w.tx},${w.ty}`;
    if (atc(w.tx, w.ty) !== 'W') err(`${what}: tile is not 'W'`, w.tx, w.ty);
    if (Math.abs(w.dx) + Math.abs(w.dy) !== 1) { err(`${what}: (dx, dy) must be one step along an axis`, w.tx, w.ty); continue; }
    if (atc(w.tx + w.dx, w.ty + w.dy) !== '.') err(`${what}: needs outside ('.') on one side`, w.tx, w.ty);
    const r = regionAt(w.tx - w.dx, w.ty - w.dy);
    if (r < 0) err(`${what}: needs floor on the inside`, w.tx, w.ty);
    else label(r, w.room, what, w.tx, w.ty);
  }

  // Doors.
  const links: [number, number][] = [];
  for (const dr of doors) {
    const [fx, fy] = dr.tiles[0] ?? [0, 0];
    const what = `door ${fx},${fy} [${dr.rooms.join(', ')}]`;
    if (dr.cost < 0 || dr.cost > MAX_DOOR_COST) err(`${what}: cost must be 0-${MAX_DOOR_COST}`, fx, fy);
    const touching = new Set<number>();
    for (const [x, y] of dr.tiles) {
      if (atc(x, y) !== 'D') err(`${what}: tile ${x},${y} is not 'D'`, x, y);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const r = regionAt(nx, ny);
        if (r >= 0) touching.add(r);
      }
    }
    if (touching.size !== 2) {
      err(`${what}: must sit between exactly two floor areas (touches ${touching.size})`, fx, fy);
      continue;
    }
    const [a, b] = [...touching].sort((x, y) => x - y);
    const [ra, rb] = dr.rooms;
    const swap = rb === regionRoom.get(a) || ra === regionRoom.get(b);
    label(swap ? b : a, ra, what, fx, fy);
    label(swap ? a : b, rb, what, fx, fy);
    links.push([a, b]);
  }

  // Wall spots.
  const spots: [string, WallSpot][] = [];
  for (const s of m.wallBuys ?? []) {
    if (!(s.weapon in WEAPONS)) err(`wall buy at ${s.tx},${s.ty}: unknown weapon "${s.weapon}"`, s.tx, s.ty);
    spots.push([`wall buy at ${s.tx},${s.ty}`, s]);
  }
  for (const s of m.perks ?? []) {
    if (!(s.perk in PERKS)) err(`perk at ${s.tx},${s.ty}: unknown perk "${s.perk}"`, s.tx, s.ty);
    spots.push([`perk at ${s.tx},${s.ty}`, s]);
  }
  spots.push(['armour', m.armour!], ['upgrade', m.upgrade!]);
  if (m.power) spots.push(['power switch', m.power]);
  for (const [what, s] of spots) {
    if (atc(s.tx, s.ty) !== '#') err(`${what}: must be on a wall tile`, s.tx, s.ty);
    if (Math.abs(s.nx) + Math.abs(s.ny) !== 1) err(`${what}: (nx, ny) must be one step along an axis`, s.tx, s.ty);
    else if (regionAt(s.tx + s.nx, s.ty + s.ny) < 0) err(`${what}: must face a floor tile`, s.tx, s.ty);
  }

  // Box.
  const b = m.box!;
  if (atc(b.tx, b.ty) !== 'C' || atc(b.tx + 1, b.ty) !== 'C') err(`box: tiles ${b.tx},${b.ty} and the one to its right must be crates ('C')`, b.tx, b.ty);
  if (regionAt(b.tx, b.ty + 1) < 0) err('box: the tile below it must be floor', b.tx, b.ty);

  // Decor.
  const decor = m.decor ?? [];
  if (decor.length > MAX_DECOR) err(`decor: at most ${MAX_DECOR} pieces`);
  for (const d of decor) {
    if (!DECOR_KIND.test(d.kind)) { err('decor: kind must match ^[a-zA-Z]{1,30}$', d.tx, d.ty); continue; }
    const what = `decor ${d.kind} at ${d.tx},${d.ty}`;
    if (d.w < 1 || d.h < 1) err(`${what}: w and h must be at least 1`, d.tx, d.ty);
    else if (d.tx < 0 || d.ty < 0 || d.tx + d.w > width || d.ty + d.h > height) err(`${what}: must be inside the map`, d.tx, d.ty);
    if (d.face != null && !FACES.has(d.face)) err(`${what}: face must be n, e, s or w`, d.tx, d.ty);
  }

  // Rooms.
  for (const room of rooms) if (!roomRegion.has(room)) err(`room "${room}" isn't touched by any window, door or the start`);
  if (errors.length || !m.startRoom) return errors;
  const reached = new Set<number>([roomRegion.get(m.startRoom)!]);
  const queue = [...reached];
  while (queue.length) {
    const r = queue.shift()!;
    for (const [a, c] of links) {
      const other = a === r ? c : c === r ? a : -1;
      if (other >= 0 && !reached.has(other)) { reached.add(other); queue.push(other); }
    }
  }
  for (const room of rooms) if (!reached.has(roomRegion.get(room)!)) err(`room "${room}" can't be reached from the start room`);
  return errors;
}
