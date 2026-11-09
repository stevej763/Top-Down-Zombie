import type { MapDoc } from '../../client/src/game/MapData';

const c = (v: unknown) => JSON.stringify(v);
const list = (items: unknown[], indent = '    ') => (items.length ? `[\n${items.map((i) => indent + c(i)).join(',\n')}\n  ]` : '[]');

/** The map as the repo's maps/*.json lay it out: one tile row, window, buy or decor piece per line. */
export function formatMap(doc: MapDoc): string {
  const doors = doc.doors.length
    ? `[\n${doc.doors.map((d) => `    {\n      "tiles":${c(d.tiles)},\n      "cost": ${d.cost},\n      "rooms": ${c(d.rooms)}\n    }`).join(',\n')}\n  ]`
    : '[]';
  const fields: [string, string][] = [
    ['id', c(doc.id)],
    ['name', c(doc.name)],
    ['width', c(doc.width)],
    ['height', c(doc.height)],
    ['tiles', list(doc.tiles)],
    ['rooms', c(doc.rooms)],
    ['startRoom', c(doc.startRoom)],
    ['playerStart', c(doc.playerStart)],
    ['windows', list(doc.windows)],
    ['doors', doors],
    ['wallBuys', list(doc.wallBuys)],
    ['perks', list(doc.perks)],
    ['armour', c(doc.armour)],
    ['upgrade', c(doc.upgrade)],
    ['box', c(doc.box)],
  ];
  if (doc.power) fields.push(['power', c(doc.power)]);
  if (doc.decor?.length) fields.push(['decor', list(doc.decor)]);
  return `{\n${fields.map(([k, v]) => `  "${k}": ${v}`).join(',\n')}\n}\n`;
}
