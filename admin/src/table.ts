import { h } from './dom';

type Cell = Node | string | number | null | undefined;

export interface Column<T> {
  title: string;
  cell: (row: T) => Cell;
  /** Right-aligned numbers. */
  num?: boolean;
}

/** A table of rows; clicking a row calls `open`, if given. */
export function table<T>(cols: Column<T>[], rows: T[], open?: (row: T) => void, empty = 'Nothing yet'): HTMLElement {
  const text = (c: Cell): Node | string => (c === null || c === undefined ? '—' : typeof c === 'number' ? c.toLocaleString() : c);
  return h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', { class: c.num ? 'num' : '' }, c.title)))),
    h('tbody', {},
      ...(rows.length
        ? rows.map((r) => h('tr', { class: open ? 'link' : '', onclick: open ? () => open(r) : undefined },
            ...cols.map((c) => h('td', { class: c.num ? 'num' : '' }, text(c.cell(r))))))
        : [h('tr', {}, h('td', { colspan: cols.length, class: 'empty' }, empty))])));
}

export function badge(text: string, kind = ''): HTMLElement {
  return h('span', { class: `badge ${kind}` }, text);
}

export function dot(on: boolean, title = ''): HTMLElement {
  return h('span', { class: `dot ${on ? 'on' : ''}`, title });
}
