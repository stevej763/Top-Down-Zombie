import type { PerkId, WeaponId } from '../../client/src/game/defs';
import type { DecorDef, WallSpot } from '../../client/src/game/MapData';
import { loadStored } from '../../client/src/core/storage';
import {
  at, DECOR_BY_KIND, footprint, inside, setCell, toDoc, type DecorKind, type Draft, type Face, type PlaceKind,
  type TileChar,
} from './model';
import { normalize, perkFacings, wallFacings, type Regions } from './rooms';
import { validate, type Problem } from './validate';

export type Tool = 'select' | 'brush' | 'rect' | 'room' | 'fill' | 'place' | 'decor' | 'erase';

export type Selection =
  | { kind: 'decor' | 'wallBuy' | 'perk' | 'door' | 'window'; index: number }
  | { kind: 'armour' | 'upgrade' | 'power' | 'box' | 'start' }
  | null;

/** A tile under the pointer, with where in the tile it is (0-1), for picking a wall fixture's facing. */
export interface Cursor {
  tx: number;
  ty: number;
  fx: number;
  fy: number;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const DRAFT_KEY = 'top-down-survival-admin-draft';
const MAX_UNDO = 200;
const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export function normRect(a: Cursor, b: Cursor): Rect {
  return { x0: Math.min(a.tx, b.tx), y0: Math.min(a.ty, b.ty), x1: Math.max(a.tx, b.tx), y1: Math.max(a.ty, b.ty) };
}

export class Editor {
  draft!: Draft;
  regions!: Regions;
  problems: Problem[] = [];
  /** Bumped when tiles or decor change, so the view re-renders the map underneath. */
  version = 0;
  /** Bumped on any change; the UI compares it to know when to rebuild its panels. */
  revision = 0;

  tool: Tool = 'brush';
  tile: TileChar = '#';
  place: PlaceKind = 'wallBuy';
  weapon: WeaponId = 'shotgun';
  perk: PerkId = 'toughHide';
  decorKind = 'sofa';
  face: Face = 's';
  selection: Selection = null;

  hover: Cursor | null = null;
  /** Drag rectangle for the rect, room and area-decor tools. */
  dragRect: Rect | null = null;

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private drag: { start: Cursor; last: Cursor; base?: string; moved?: boolean } | null = null;

  constructor(draft: Draft, private onChange: () => void) {
    this.load(draft, false);
  }

  // ---------------------------------------------------------------- state

  /** Replace the map (open, new, import). Undo history is kept, so a mis-click can be undone. */
  load(draft: Draft, keepHistory = true): void {
    if (keepHistory && this.draft) this.pushUndo();
    this.draft = draft;
    this.selection = null;
    this.changed();
  }

  private snapshot(): string {
    return JSON.stringify(this.draft);
  }

  private pushUndo(snap = this.snapshot()): void {
    this.undoStack.push(snap);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Call before a change so it can be undone. */
  commit(): void {
    this.pushUndo();
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.draft = JSON.parse(s);
    this.selection = null;
    this.changed();
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.draft = JSON.parse(s);
    this.selection = null;
    this.changed();
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** After any edit: re-derive rooms, windows and doors, validate, and save the draft locally. */
  changed(): void {
    this.regions = normalize(this.draft);
    this.problems = validate(toDoc(this.draft));
    this.version++;
    this.revision++;
    try {
      localStorage.setItem(DRAFT_KEY, this.snapshot());
    } catch {
      // Storage full or blocked: the draft just isn't kept across reloads.
    }
    this.onChange();
  }

  static savedDraft(): Draft | null {
    try {
      const s = loadStored(DRAFT_KEY);
      return s ? (JSON.parse(s) as Draft) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- pointer

  pointerDown(c: Cursor, alt: boolean): void {
    if (!inside(this.draft, c.tx, c.ty)) return;
    if (alt) {
      // Eyedropper.
      this.tile = at(this.draft, c.tx, c.ty);
      if (this.tool !== 'rect' && this.tool !== 'fill') this.tool = 'brush';
      this.revision++;
      this.onChange();
      return;
    }
    this.drag = { start: c, last: c };
    switch (this.tool) {
      case 'brush':
        this.commit();
        this.paint(c.tx, c.ty);
        this.changed();
        break;
      case 'erase':
        this.commit();
        this.eraseAt(c.tx, c.ty);
        this.changed();
        break;
      case 'fill':
        this.commit();
        this.fill(c.tx, c.ty);
        this.changed();
        this.drag = null;
        break;
      case 'rect':
      case 'room':
        this.dragRect = normRect(c, c);
        break;
      case 'decor':
        if (this.decorDef().area) this.dragRect = normRect(c, c);
        else {
          this.commit();
          this.stampDecor(c.tx, c.ty);
          this.changed();
          this.drag = null;
        }
        break;
      case 'place':
        this.commit();
        this.placeAt(c);
        this.changed();
        this.drag = null;
        break;
      case 'select': {
        this.selection = this.objectAt(c.tx, c.ty);
        this.drag.base = this.snapshot();
        this.revision++;
        this.onChange();
        break;
      }
    }
  }

  pointerMove(c: Cursor): void {
    this.hover = c;
    const d = this.drag;
    if (!d) return;
    if (c.tx === d.last.tx && c.ty === d.last.ty) return;
    switch (this.tool) {
      case 'brush':
        line(d.last, c, (x, y) => this.paint(x, y));
        this.changed();
        break;
      case 'erase':
        line(d.last, c, (x, y) => this.eraseAt(x, y));
        this.changed();
        break;
      case 'rect':
      case 'room':
      case 'decor':
        this.dragRect = normRect(d.start, c);
        break;
      case 'select':
        this.dragMove(c);
        break;
    }
    d.last = c;
  }

  pointerUp(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const r = this.dragRect;
    this.dragRect = null;
    if (this.tool === 'rect' && r) {
      this.commit();
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) setCell(this.draft, x, y, this.tile);
      this.changed();
    } else if (this.tool === 'room' && r) {
      this.commit();
      this.drawRoom(r);
      this.changed();
    } else if (this.tool === 'decor' && r) {
      this.commit();
      this.addDecor({ kind: this.decorKind, tx: r.x0, ty: r.y0, w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1 });
      this.changed();
    } else if (this.tool === 'select' && d.moved && d.base) {
      this.pushUndo(d.base);
    }
  }

  pointerLeave(): void {
    this.hover = null;
  }

  // ---------------------------------------------------------------- tiles

  private paint(x: number, y: number): void {
    setCell(this.draft, x, y, this.tile);
  }

  private fill(x: number, y: number): void {
    const d = this.draft;
    const from = at(d, x, y);
    if (from === this.tile) return;
    const stack: [number, number][] = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      if (!inside(d, cx, cy) || at(d, cx, cy) !== from) continue;
      setCell(d, cx, cy, this.tile);
      for (const [dx, dy] of DIRS) stack.push([cx + dx, cy + dy]);
    }
  }

  /** A walled room: wall around the edge (windows and doors already there are kept), floor inside. */
  private drawRoom(r: Rect): void {
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const edge = x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
        const cur = at(this.draft, x, y);
        if (!edge) setCell(this.draft, x, y, '_');
        else if (cur !== 'W' && cur !== 'D') setCell(this.draft, x, y, '#');
      }
    }
  }

  // ---------------------------------------------------------------- objects

  decorDef(kind = this.decorKind): DecorKind {
    return DECOR_BY_KIND.get(kind) ?? { kind, label: kind, group: 'Other', w: 1, h: 1, solid: '' };
  }

  /** The topmost thing on a tile, or null. */
  objectAt(x: number, y: number): Selection {
    const d = this.draft;
    const on = (s: { tx: number; ty: number } | null) => !!s && s.tx === x && s.ty === y;
    if (on(d.playerStart)) return { kind: 'start' };
    let i = d.wallBuys.findIndex(on);
    if (i >= 0) return { kind: 'wallBuy', index: i };
    i = d.perks.findIndex(on);
    if (i >= 0) return { kind: 'perk', index: i };
    if (on(d.armour)) return { kind: 'armour' };
    if (on(d.upgrade)) return { kind: 'upgrade' };
    if (on(d.power)) return { kind: 'power' };
    if (d.box && d.box.ty === y && (d.box.tx === x || d.box.tx + 1 === x)) return { kind: 'box' };
    i = d.doors.findIndex((dr) => dr.tiles.some(([tx, ty]) => tx === x && ty === y));
    if (i >= 0) return { kind: 'door', index: i };
    i = d.windows.findIndex(on);
    if (i >= 0) return { kind: 'window', index: i };
    // Furniture before the floors and rugs under it.
    const covers = (dc: DecorDef) => x >= dc.tx && y >= dc.ty && x < dc.tx + dc.w && y < dc.ty + dc.h;
    for (const pass of [false, true]) {
      for (let j = d.decor.length - 1; j >= 0; j--) {
        if (!!this.decorDef(d.decor[j].kind).area === pass && covers(d.decor[j])) return { kind: 'decor', index: j };
      }
    }
    return null;
  }

  /** Tile rectangle an object covers, for the selection outline. */
  boundsOf(s: Selection): Rect | null {
    const d = this.draft;
    if (!s) return null;
    const spot = (p: { tx: number; ty: number } | null | undefined) => (p ? { x0: p.tx, y0: p.ty, x1: p.tx, y1: p.ty } : null);
    switch (s.kind) {
      case 'start': return spot(d.playerStart);
      case 'wallBuy': return spot(d.wallBuys[s.index]);
      case 'perk': return spot(d.perks[s.index]);
      case 'armour': return spot(d.armour);
      case 'upgrade': return spot(d.upgrade);
      case 'power': return spot(d.power);
      case 'window': return spot(d.windows[s.index]);
      case 'box': return d.box ? { x0: d.box.tx, y0: d.box.ty, x1: d.box.tx + 1, y1: d.box.ty } : null;
      case 'door': {
        const t = d.doors[s.index]?.tiles;
        if (!t) return null;
        const xs = t.map((p) => p[0]), ys = t.map((p) => p[1]);
        return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      }
      case 'decor': {
        const dc = d.decor[s.index];
        return dc ? { x0: dc.tx, y0: dc.ty, x1: dc.tx + dc.w - 1, y1: dc.ty + dc.h - 1 } : null;
      }
    }
  }

  /** Facing for a fixture placed at a cursor: the floor side nearest the pointer. */
  private facingFor(c: Cursor): [number, number] {
    const options = (this.place === 'perk' ? perkFacings : wallFacings)(this.draft, this.regions, c.tx, c.ty);
    if (!options.length) return [0, 1];
    const px = c.fx - 0.5, py = c.fy - 0.5;
    return options.reduce((best, o) => (o[0] * px + o[1] * py > best[0] * px + best[1] * py ? o : best));
  }

  private placeAt(c: Cursor): void {
    const d = this.draft;
    const { tx, ty } = c;
    const [nx, ny] = this.facingFor(c);
    const spot: WallSpot = { tx, ty, nx, ny };
    // One fixture per wall tile: placing replaces whatever was there.
    const clearSpot = () => {
      d.wallBuys = d.wallBuys.filter((s) => s.tx !== tx || s.ty !== ty);
      d.perks = d.perks.filter((s) => s.tx !== tx || s.ty !== ty);
      for (const k of ['armour', 'upgrade', 'power'] as const) if (d[k]?.tx === tx && d[k]?.ty === ty) d[k] = null;
    };
    switch (this.place) {
      case 'start':
        d.playerStart = { tx, ty };
        this.selection = { kind: 'start' };
        break;
      case 'wallBuy':
        clearSpot();
        d.wallBuys.push({ ...spot, weapon: this.weapon });
        this.selection = { kind: 'wallBuy', index: d.wallBuys.length - 1 };
        break;
      case 'perk': {
        // A machine stands on a floor tile against a wall, which it makes solid; or replaces one already there.
        const i = d.perks.findIndex((s) => s.tx === tx && s.ty === ty);
        if (i >= 0) d.perks.splice(i, 1);
        else if (at(d, tx, ty) !== '_' || !perkFacings(d, this.regions, tx, ty).length) break;
        setCell(d, tx, ty, 'C');
        d.perks.push({ ...spot, perk: this.perk });
        this.selection = { kind: 'perk', index: d.perks.length - 1 };
        break;
      }
      case 'armour':
      case 'upgrade':
      case 'power':
        clearSpot();
        d[this.place] = spot;
        this.selection = { kind: this.place };
        break;
      case 'box':
        this.setBox(tx, ty);
        this.selection = { kind: 'box' };
        break;
    }
  }

  /** Move the box, turning its two tiles into crates and the old ones back into floor. */
  private setBox(tx: number, ty: number): void {
    const d = this.draft;
    const old = d.box;
    d.box = { tx, ty };
    if (old) for (const x of [old.tx, old.tx + 1]) this.unsolid(x, old.ty, 'C');
    setCell(d, tx, ty, 'C');
    setCell(d, tx + 1, ty, 'C');
  }

  /** Turn a furniture tile back into floor unless something else still stands on it. */
  private unsolid(x: number, y: number, ch: 'C' | 'T', ignore?: DecorDef): void {
    const d = this.draft;
    if (at(d, x, y) !== ch) return;
    if (d.box && d.box.ty === y && (d.box.tx === x || d.box.tx + 1 === x)) return;
    if (ch === 'C' && d.perks.some((s) => s.tx === x && s.ty === y)) return;
    const held = d.decor.some((dc) => dc !== ignore && this.decorDef(dc.kind).solid === ch
      && x >= dc.tx && y >= dc.ty && x < dc.tx + dc.w && y < dc.ty + dc.h);
    if (!held) setCell(d, x, y, '_');
  }

  private stampDecor(tx: number, ty: number): void {
    const k = this.decorDef();
    const { w, h } = footprint(k, this.face);
    this.addDecor({ kind: k.kind, tx, ty, w, h, face: this.face });
  }

  /** Add a piece, making floor under it solid as that kind of furniture is. */
  addDecor(dc: DecorDef): void {
    const d = this.draft;
    dc.w = Math.min(dc.w, d.width - dc.tx);
    dc.h = Math.min(dc.h, d.height - dc.ty);
    if (dc.w < 1 || dc.h < 1) return;
    const k = this.decorDef(dc.kind);
    if (k.floor) {
      // Finishes go before rugs and furniture, which draw over them.
      const i = d.decor.findIndex((x) => !this.decorDef(x.kind).floor);
      d.decor.splice(i < 0 ? d.decor.length : i, 0, dc);
      this.selection = { kind: 'decor', index: i < 0 ? d.decor.length - 1 : i };
    } else {
      d.decor.push(dc);
      this.selection = { kind: 'decor', index: d.decor.length - 1 };
    }
    this.solidify(dc);
  }

  private solidify(dc: DecorDef): void {
    const solid = this.decorDef(dc.kind).solid;
    if (!solid) return;
    for (let y = dc.ty; y < dc.ty + dc.h; y++) {
      for (let x = dc.tx; x < dc.tx + dc.w; x++) {
        const cur = at(this.draft, x, y);
        if (cur === '_' || (solid === 'C' && cur === 'T')) setCell(this.draft, x, y, solid);
      }
    }
  }

  private liftDecor(dc: DecorDef): void {
    const solid = this.decorDef(dc.kind).solid;
    if (!solid) return;
    for (let y = dc.ty; y < dc.ty + dc.h; y++) for (let x = dc.tx; x < dc.tx + dc.w; x++) this.unsolid(x, y, solid, dc);
  }

  /** Delete an object. Doors and windows become wall. */
  remove(s: Selection): void {
    const d = this.draft;
    if (!s) return;
    switch (s.kind) {
      case 'start': d.playerStart = null; break;
      case 'wallBuy': d.wallBuys.splice(s.index, 1); break;
      case 'perk': {
        const [p] = d.perks.splice(s.index, 1);
        if (p) this.unsolid(p.tx, p.ty, 'C');
        break;
      }
      case 'armour': case 'upgrade': case 'power': d[s.kind] = null; break;
      case 'box':
        if (d.box) {
          const old = d.box;
          d.box = null;
          this.unsolid(old.tx, old.ty, 'C');
          this.unsolid(old.tx + 1, old.ty, 'C');
        }
        break;
      case 'door': for (const [x, y] of d.doors[s.index]?.tiles ?? []) setCell(d, x, y, '#'); break;
      case 'window': { const w = d.windows[s.index]; if (w) setCell(d, w.tx, w.ty, '#'); break; }
      case 'decor': {
        const dc = d.decor[s.index];
        if (!dc) break;
        d.decor.splice(s.index, 1);
        this.liftDecor(dc);
        break;
      }
    }
    if (this.selection && JSON.stringify(this.selection) === JSON.stringify(s)) this.selection = null;
  }

  private eraseAt(x: number, y: number): void {
    const s = this.objectAt(x, y);
    // Dragging the eraser over a door or window shouldn't wall it up; erase those by clicking them selected.
    if (s && s.kind !== 'door' && s.kind !== 'window') this.remove(s);
  }

  deleteSelection(): void {
    if (!this.selection) return;
    this.commit();
    this.remove(this.selection);
    this.selection = null;
    this.changed();
  }

  /** Drag the selection: replay the move from the state when the drag started. */
  private dragMove(c: Cursor): void {
    const drag = this.drag!;
    const s = this.selection;
    if (!s || !drag.base || s.kind === 'door' || s.kind === 'window') return;
    const dx = c.tx - drag.start.tx, dy = c.ty - drag.start.ty;
    this.draft = JSON.parse(drag.base);
    const d = this.draft;
    const shift = (p: { tx: number; ty: number } | null | undefined) => {
      if (p) { p.tx += dx; p.ty += dy; }
    };
    switch (s.kind) {
      case 'start': shift(d.playerStart); break;
      case 'wallBuy': shift(d.wallBuys[s.index]); break;
      case 'perk': {
        // Like the box: the old tile goes back to floor and the new one (if floor) becomes its crate.
        const p = d.perks[s.index];
        const old = { ...p };
        shift(p);
        this.unsolid(old.tx, old.ty, 'C');
        if (at(d, p.tx, p.ty) === '_') setCell(d, p.tx, p.ty, 'C');
        break;
      }
      case 'armour': case 'upgrade': case 'power': shift(d[s.kind]); break;
      case 'box': if (d.box) this.setBox(d.box.tx + dx, d.box.ty + dy); break;
      case 'decor': {
        const dc = d.decor[s.index];
        this.liftDecor(dc);
        dc.tx = Math.max(0, Math.min(d.width - dc.w, dc.tx + dx));
        dc.ty = Math.max(0, Math.min(d.height - dc.h, dc.ty + dy));
        this.solidify(dc);
        break;
      }
    }
    drag.moved = dx !== 0 || dy !== 0;
    this.changed();
  }

  // ---------------------------------------------------------------- inspector edits

  /** Apply an edit to the draft as one undoable step. */
  edit(fn: (d: Draft) => void): void {
    this.commit();
    fn(this.draft);
    this.changed();
  }

  /** Re-face or resize a piece of furniture, keeping its tiles solid. */
  editDecor(index: number, fn: (dc: DecorDef) => void): void {
    this.edit(() => {
      const dc = this.draft.decor[index];
      this.liftDecor(dc);
      fn(dc);
      dc.w = Math.max(1, Math.min(dc.w, this.draft.width - dc.tx));
      dc.h = Math.max(1, Math.min(dc.h, this.draft.height - dc.ty));
      this.solidify(dc);
    });
  }

  /** Turn a piece a quarter clockwise (s → w → n → e), swapping its footprint. */
  rotateDecor(index: number): void {
    this.editDecor(index, (dc) => {
      const order: Face[] = ['s', 'w', 'n', 'e'];
      dc.face = order[(order.indexOf((dc.face ?? 's') as Face) + 1) % 4];
      [dc.w, dc.h] = [dc.h, dc.w];
    });
  }

  wallFacings(x: number, y: number): [number, number][] {
    return wallFacings(this.draft, this.regions, x, y);
  }

  perkFacings(x: number, y: number): [number, number][] {
    return perkFacings(this.draft, this.regions, x, y);
  }
}

/** Every tile on the line from a to b (Bresenham), so fast brush strokes don't leave gaps. */
function line(a: Cursor, b: Cursor, fn: (x: number, y: number) => void): void {
  let x = a.tx, y = a.ty;
  const dx = Math.abs(b.tx - x), dy = -Math.abs(b.ty - y);
  const sx = x < b.tx ? 1 : -1, sy = y < b.ty ? 1 : -1;
  let e = dx + dy;
  for (;;) {
    fn(x, y);
    if (x === b.tx && y === b.ty) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x += sx; }
    if (e2 <= dx) { e += dx; y += sy; }
  }
}
