import { PERK_ORDER, PERKS, WEAPONS, type PerkId, type WeaponId } from '../../client/src/game/defs';
import type { WallSpot } from '../../client/src/game/MapData';
import { h } from './dom';
import type { Editor, Tool } from './editor';
import { DECOR, FACES, resize, TILES, usedRooms, type Face, type PlaceKind } from './model';
import { renameRoom } from './rooms';

export const TOOLS: { id: Tool; ico: string; key: string; name: string }[] = [
  { id: 'select', ico: '↖', key: 'V', name: 'Select and move' },
  { id: 'brush', ico: '✎', key: 'B', name: 'Paint tiles' },
  { id: 'rect', ico: '▭', key: 'R', name: 'Fill a rectangle of tiles' },
  { id: 'room', ico: '⌂', key: 'O', name: 'Draw a walled room' },
  { id: 'fill', ico: '◧', key: 'G', name: 'Flood fill' },
  { id: 'place', ico: '★', key: 'P', name: 'Place start, buys, box, power' },
  { id: 'decor', ico: '▦', key: 'U', name: 'Furniture and floors' },
  { id: 'erase', ico: '⌫', key: 'E', name: 'Erase objects' },
];

/** Weapons sold on walls: the ones with a wall price (the rest are the starter or box-only). */
const WALL_WEAPONS = (Object.keys(WEAPONS) as WeaponId[]).filter((w) => WEAPONS[w].cost > 0);

const PLACES: { id: PlaceKind; name: string; hint: string }[] = [
  { id: 'start', name: 'Player start', hint: 'A floor tile; its room is where everyone starts' },
  { id: 'wallBuy', name: 'Wall buy', hint: 'On a wall tile, facing the floor you buy it from' },
  { id: 'perk', name: 'Perk machine', hint: 'On a floor tile against a wall (it becomes the machine\'s crate); needs power on maps with a switch' },
  { id: 'armour', name: 'Armour bench', hint: 'On a wall tile' },
  { id: 'upgrade', name: 'Upgrade bench', hint: 'On a wall tile; needs power on maps with a switch' },
  { id: 'box', name: 'Mystery box', hint: 'Two tiles wide, used from the floor below it' },
  { id: 'power', name: 'Power switch', hint: 'Optional. With one the map starts dark and the box, perks and bench need power' },
];

const FACE_NAMES: Record<Face, string> = { n: 'N', e: 'E', s: 'S', w: 'W' };
const DIR_NAMES: Record<string, string> = { '0,-1': 'north', '0,1': 'south', '-1,0': 'west', '1,0': 'east' };

export function renderTools(el: HTMLElement, e: Editor, refresh: () => void): void {
  el.replaceChildren(...TOOLS.map((t) => h('button', {
    class: e.tool === t.id ? 'on' : '',
    title: `${t.name} (${t.key})`,
    onclick: () => { e.tool = t.id; refresh(); },
  }, h('span', { class: 'ico' }, t.ico), h('span', { class: 'key' }, t.key))));
}

export function renderOptions(el: HTMLElement, e: Editor, refresh: () => void): void {
  const tool = TOOLS.find((t) => t.id === e.tool)!;
  const parts: (Node | string)[] = [h('h3', {}, tool.name)];
  const d = e.draft;

  if (e.tool === 'brush' || e.tool === 'rect' || e.tool === 'fill') {
    parts.push(h('div', { class: 'palette' }, ...TILES.map((t, i) => h('button', {
      class: e.tile === t.ch ? 'on' : '',
      title: t.hint,
      onclick: () => { e.tile = t.ch; refresh(); },
    }, h('span', { class: 'swatch', style: `background:${t.color}` }), t.name, h('span', { class: 'key' }, String(i + 1))))));
    parts.push(h('p', { class: 'hint' }, TILES.find((t) => t.ch === e.tile)?.hint ?? ''));
    parts.push(h('p', { class: 'hint' }, 'Alt+click picks the tile under the pointer. Windows and doors are worked out from their tiles: a run of touching door tiles is one door.'));
  } else if (e.tool === 'room') {
    parts.push(h('p', { class: 'hint' }, 'Drag out a rectangle: walls round the edge, floor inside. Windows and doors already on the edge are kept, so rooms can share a wall.'));
    parts.push(h('p', { class: 'hint' }, 'Then paint windows (W) into outer walls and doors (D) into the walls between rooms.'));
  } else if (e.tool === 'place') {
    const placed: Record<PlaceKind, boolean | number> = {
      start: !!d.playerStart, wallBuy: d.wallBuys.length, perk: d.perks.length, armour: !!d.armour,
      upgrade: !!d.upgrade, box: !!d.box, power: !!d.power,
    };
    parts.push(h('div', { class: 'palette' }, ...PLACES.map((p) => {
      const v = placed[p.id];
      const mark = typeof v === 'number' ? h('span', { class: 'key' }, String(v))
        : v ? h('span', { class: 'ok' }, '✓') : p.id === 'power' ? null : h('span', { class: 'miss' }, '●');
      return h('button', { class: e.place === p.id ? 'on' : '', title: p.hint, onclick: () => { e.place = p.id; refresh(); } }, p.name, mark);
    })));
    if (e.place === 'wallBuy') {
      parts.push(h('div', { class: 'group-title' }, 'Weapon'), weaponSelect(e.weapon, (w) => { e.weapon = w; }));
    } else if (e.place === 'perk') {
      parts.push(h('div', { class: 'group-title' }, 'Perk'), perkSelect(e.perk, (p) => { e.perk = p; }));
    }
    parts.push(h('p', { class: 'hint' }, PLACES.find((p) => p.id === e.place)!.hint));
    if (e.place !== 'start' && e.place !== 'box') {
      parts.push(h('p', { class: 'hint' }, 'It faces whichever floor side of the wall the pointer is nearest.'));
    }
  } else if (e.tool === 'decor') {
    parts.push(h('div', { class: 'group-title' }, 'Facing (Q turns)'));
    parts.push(h('div', { class: 'faces' }, ...FACES.map((f) => h('button', { class: e.face === f ? 'on' : '', onclick: () => { e.face = f; refresh(); } }, FACE_NAMES[f]))));
    let group = '';
    const list = h('div', { class: 'palette' });
    for (const k of DECOR) {
      if (k.group !== group) {
        group = k.group;
        list.append(h('div', { class: 'group-title' }, group));
      }
      const solid = k.solid === 'T' ? 'low' : k.solid === 'C' ? 'tall' : '';
      list.append(h('button', {
        class: e.decorKind === k.kind ? 'on' : '',
        title: k.area ? 'Drag out an area' : `${k.w}×${k.h}${solid ? `, ${solid} (makes its tiles ${k.solid})` : ''}`,
        onclick: () => { e.decorKind = k.kind; refresh(); },
      }, k.label, h('span', { class: 'key' }, k.area ? 'area' : solid)));
    }
    parts.push(list);
    parts.push(h('p', { class: 'hint' }, 'Furniture turns the floor under it into low (T) or tall (C) tiles; deleting it gives the floor back. Leave two tiles between pieces so players can get round.'));
  } else if (e.tool === 'select') {
    parts.push(h('p', { class: 'hint' }, 'Click a thing to edit it on the right; drag to move it. Delete removes it (doors and windows turn back into wall).'));
    parts.push(h('p', { class: 'hint' }, 'Pan: space+drag, right-drag or middle-drag. Zoom: wheel.'));
  } else if (e.tool === 'erase') {
    parts.push(h('p', { class: 'hint' }, 'Click or drag to remove fixtures and furniture. To remove a door or window, paint over it or select it and press Delete.'));
  }
  el.replaceChildren(...parts);
}

function weaponSelect(value: WeaponId, set: (w: WeaponId) => void): HTMLSelectElement {
  const opts = WALL_WEAPONS.includes(value) ? WALL_WEAPONS : [value, ...WALL_WEAPONS];
  return h('select', { onchange: (ev) => set((ev.target as HTMLSelectElement).value as WeaponId) },
    ...opts.map((w) => h('option', { value: w, selected: w === value }, `${WEAPONS[w]?.name ?? w} (${WEAPONS[w]?.cost ?? '?'})`)));
}

function perkSelect(value: PerkId, set: (p: PerkId) => void): HTMLSelectElement {
  return h('select', { onchange: (ev) => set((ev.target as HTMLSelectElement).value as PerkId) },
    ...PERK_ORDER.map((p) => h('option', { value: p, selected: p === value }, `${PERKS[p].name} (${PERKS[p].cost})`)));
}

export interface SideActions {
  /** Centre the view on a tile. */
  focus(tx: number, ty: number): void;
  refresh(): void;
}

export function renderSide(el: HTMLElement, e: Editor, act: SideActions): void {
  el.replaceChildren(mapSection(e), selectionSection(e), roomsSection(e), problemsSection(e, act));
}

function mapSection(e: Editor): HTMLElement {
  const d = e.draft;
  const w = h('input', { type: 'number', min: 10, max: 200, value: d.width });
  const hh = h('input', { type: 'number', min: 10, max: 200, value: d.height });
  return h('section', {},
    h('h3', {}, 'Map'),
    h('div', { class: 'row' }, h('label', {}, 'Id'),
      h('input', { type: 'text', value: d.id, title: 'File name and URL: lower-case letters, digits and dashes', onchange: (ev) => e.edit((m) => { m.id = (ev.target as HTMLInputElement).value.trim(); }) })),
    h('div', { class: 'row' }, h('label', {}, 'Name'),
      h('input', { type: 'text', value: d.name, maxlength: 40, onchange: (ev) => e.edit((m) => { m.name = (ev.target as HTMLInputElement).value; }) })),
    h('div', { class: 'row' }, h('label', {}, 'Size'), w, '×', hh,
      h('button', {
        title: 'Grow or crop from the bottom-right corner',
        onclick: () => {
          const nw = Math.max(10, Math.min(200, Number(w.value) || d.width));
          const nh = Math.max(10, Math.min(200, Number(hh.value) || d.height));
          if (nw !== d.width || nh !== d.height) e.load(resize(d, nw, nh));
        },
      }, 'Resize')),
    h('p', { class: 'hint' },
      `${usedRooms(d).length} rooms · ${d.windows.length} windows · ${d.doors.length} doors · ${d.decor.length} decor`,
      d.power ? ' · starts without power' : ''),
  );
}

function facingRow(e: Editor, s: WallSpot, perk = false): HTMLElement {
  const opts = perk ? e.perkFacings(s.tx, s.ty) : e.wallFacings(s.tx, s.ty);
  const cur = `${s.nx},${s.ny}`;
  const all = opts.map(([x, y]) => `${x},${y}`);
  if (!all.includes(cur)) all.unshift(cur);
  return h('div', { class: 'row' }, h('label', {}, 'Faces'),
    h('select', {
      onchange: (ev) => e.edit(() => {
        const [x, y] = (ev.target as HTMLSelectElement).value.split(',').map(Number);
        s.nx = x;
        s.ny = y;
      }),
    }, ...all.map((k) => h('option', { value: k, selected: k === cur }, DIR_NAMES[k] ?? k))));
}

function selectionSection(e: Editor): HTMLElement {
  const s = e.selection;
  const d = e.draft;
  const sec = h('section', {}, h('h3', {}, 'Selection'));
  if (!s) {
    sec.append(h('p', { class: 'hint' }, 'Nothing selected. Use the select tool (V) and click something.'));
    return sec;
  }
  const del = h('button', { class: 'danger', onclick: () => e.deleteSelection() }, 'Delete');
  const pos = (p: { tx: number; ty: number }) => h('p', { class: 'hint' }, `at ${p.tx}, ${p.ty}`);
  switch (s.kind) {
    case 'start':
      sec.append(h('b', {}, 'Player start'), pos(d.playerStart!), h('p', { class: 'hint' }, `Start room: ${d.startRoom ?? '(not on floor)'}`), del);
      break;
    case 'wallBuy': {
      const w = d.wallBuys[s.index];
      sec.append(h('b', {}, 'Wall buy'), pos(w),
        h('div', { class: 'row' }, h('label', {}, 'Weapon'), weaponSelect(w.weapon, (v) => e.edit(() => { w.weapon = v; }))),
        facingRow(e, w), del);
      break;
    }
    case 'perk': {
      const p = d.perks[s.index];
      sec.append(h('b', {}, 'Perk machine'), pos(p),
        h('div', { class: 'row' }, h('label', {}, 'Perk'), perkSelect(p.perk, (v) => e.edit(() => { p.perk = v; }))),
        facingRow(e, p, true), del);
      break;
    }
    case 'armour':
    case 'upgrade':
    case 'power': {
      const spot = d[s.kind]!;
      const name = { armour: 'Armour bench', upgrade: 'Upgrade bench', power: 'Power switch' }[s.kind];
      sec.append(h('b', {}, name), pos(spot), facingRow(e, spot), del);
      break;
    }
    case 'box':
      sec.append(h('b', {}, 'Mystery box'), pos(d.box!), h('p', { class: 'hint' }, 'Players use it from the floor tile below its left half.'), del);
      break;
    case 'door': {
      const dr = d.doors[s.index];
      sec.append(h('b', {}, 'Door'), h('p', { class: 'hint' }, `${dr.tiles.length} tiles, between ${dr.rooms[0] || '?'} and ${dr.rooms[1] || '?'}`),
        h('div', { class: 'row' }, h('label', {}, 'Cost'),
          h('input', {
            type: 'number', min: 0, max: 100000, step: 50, value: dr.cost,
            onchange: (ev) => e.edit(() => { dr.cost = Math.max(0, Math.round(Number((ev.target as HTMLInputElement).value) || 0)); }),
          })),
        del);
      break;
    }
    case 'window': {
      const w = d.windows[s.index];
      sec.append(h('b', {}, 'Window'), pos(w), h('p', { class: 'hint' }, `Room ${w.room || '?'}, zombies come in from the ${DIR_NAMES[`${w.dx},${w.dy}`]}`), del);
      break;
    }
    case 'decor': {
      const dc = d.decor[s.index];
      const k = e.decorDef(dc.kind);
      const num = (label: string, v: number, set: (n: number) => void) => h('input', {
        type: 'number', min: 1, max: 200, value: v, title: label,
        onchange: (ev) => e.editDecor(s.index, () => set(Math.max(1, Number((ev.target as HTMLInputElement).value) || 1))),
      });
      sec.append(h('b', {}, k.label), pos(dc),
        h('div', { class: 'row' }, h('label', {}, 'Size'), num('width', dc.w, (n) => { dc.w = n; }), '×', num('height', dc.h, (n) => { dc.h = n; })));
      if (!k.area) {
        sec.append(h('div', { class: 'row' }, h('label', {}, 'Faces'),
          h('div', { class: 'faces' }, ...FACES.map((f) => h('button', {
            class: (dc.face ?? 's') === f ? 'on' : '',
            onclick: () => e.editDecor(s.index, () => {
              const wasSide = dc.face === 'e' || dc.face === 'w';
              const side = f === 'e' || f === 'w';
              if (wasSide !== side) [dc.w, dc.h] = [dc.h, dc.w];
              dc.face = f;
            }),
          }, FACE_NAMES[f]))),
          h('button', { title: 'Turn (Q)', onclick: () => e.rotateDecor(s.index) }, '⟳')));
      }
      sec.append(del);
      break;
    }
  }
  return sec;
}

function roomsSection(e: Editor): HTMLElement {
  const d = e.draft;
  const used = usedRooms(d);
  const sec = h('section', { class: 'rooms' }, h('h3', {}, 'Rooms'));
  if (!used.length) {
    sec.append(h('p', { class: 'hint' }, 'A room is a walled area of floor. It counts once a window, door or the player start touches it.'));
    return sec;
  }
  for (const name of used) {
    const wins = d.windows.filter((w) => w.room === name).length;
    const doors = d.doors.filter((dr) => dr.rooms.includes(name)).length;
    const meta = [d.startRoom === name ? 'start' : '', `${wins}W`, `${doors}D`].filter(Boolean).join(' · ');
    sec.append(h('div', { class: 'room' },
      h('input', {
        type: 'text', value: name, title: 'Rename (used in the map file and server logs)',
        onchange: (ev) => {
          const input = ev.target as HTMLInputElement;
          const to = input.value.trim();
          if (!to || to === name || d.roomNames.includes(to)) input.value = name;
          else e.edit((m) => renameRoom(m, name, to));
        },
      }),
      h('span', { class: 'meta' }, meta)));
  }
  sec.append(h('p', { class: 'hint' }, 'Rooms are worked out from walls, windows and doors as you draw. Doors gate rooms: every room must be reachable from the start room.'));
  return sec;
}

function problemsSection(e: Editor, act: SideActions): HTMLElement {
  const sec = h('section', {}, h('h3', {}, `Problems${e.problems.length ? ` (${e.problems.length})` : ''}`));
  if (!e.problems.length) {
    sec.append(h('p', { class: 'valid' }, '✓ Valid: ready to save'));
    return sec;
  }
  sec.append(h('ul', { class: 'problems' }, ...e.problems.map((p) => h('li', {
    class: p.at ? 'at' : '',
    title: p.at ? 'Show on the map' : '',
    onclick: () => p.at && act.focus(p.at[0], p.at[1]),
  }, p.msg))));
  return sec;
}
