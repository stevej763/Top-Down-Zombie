import { AuthError, game, games, listMaps, type GameDetail, type GameRow } from './api';
import { h, toast } from './dom';
import { between, num, reason, when } from './fmt';
import type { Page } from './main';
import { badge, table, type Column } from './table';

const PAGE_SIZE = 50;
const el = document.getElementById('page-games')!;
const mapEl = h('select', {}, h('option', { value: '' }, 'All maps'));
const reasonEl = h('select', {},
  h('option', { value: '' }, 'Any outcome'),
  h('option', { value: 'running' }, 'Running'),
  h('option', { value: 'over' }, 'Game over'),
  h('option', { value: 'abandoned' }, 'Abandoned'),
  h('option', { value: 'crashed' }, 'Crashed'),
  h('option', { value: 'shutdown' }, 'Server stopped'));
const listEl = h('div', {});
const moreEl = h('button', { onclick: () => void load(true) }, 'Load more');
const detailEl = h('div', { class: 'detail' });
let rows: GameRow[] = [];
let mapsLoaded = false;

mapEl.addEventListener('change', () => void load(false));
reasonEl.addEventListener('change', () => void load(false));

/** Every game played, newest first; `#games/<id>` shows one. */
export const gamesPage: Page = {
  show(id) {
    el.replaceChildren(
      h('div', { class: 'dash-head' }, h('h1', {}, 'Games'), h('span', { class: 'spacer' }), mapEl, reasonEl,
        h('button', { onclick: () => void load(false) }, 'Refresh')),
      h('div', { class: 'split' }, h('div', { class: 'split-main' }, listEl, moreEl), detailEl));
    if (!mapsLoaded) {
      mapsLoaded = true;
      listMaps().then((maps) => mapEl.append(...maps.map((m) => h('option', { value: m.id }, m.name)))).catch(() => (mapsLoaded = false));
    }
    void load(false);
    if (id) void openGame(id);
    else detailEl.replaceChildren(h('p', { class: 'hint' }, 'Pick a game to see who played it.'));
  },
  hide() {},
};

export const GAME_COLUMNS: Column<GameRow>[] = [
  { title: 'Started', cell: (g) => when(g.startedAt) },
  { title: 'Map', cell: (g) => g.mapId },
  { title: 'Players', cell: (g) => g.players },
  { title: 'Mode', cell: (g) => (g.solo ? 'Solo' : `Co-op ×${g.partySize}`) },
  { title: 'Round', cell: (g) => g.round, num: true },
  { title: 'Kills', cell: (g) => g.kills, num: true },
  { title: 'Length', cell: (g) => between(g.startedAt, g.endedAt) },
  { title: 'Outcome', cell: (g) => outcome(g) },
];

export function outcome(g: { endReason: string | null }): HTMLElement {
  const kind = g.endReason === null ? 'good' : g.endReason === 'crashed' ? 'bad' : g.endReason === 'over' ? '' : 'warn';
  return badge(reason(g.endReason), kind);
}

async function load(more: boolean): Promise<void> {
  try {
    const page = await games({
      limit: PAGE_SIZE,
      before: more && rows.length ? rows[rows.length - 1].startedAt : undefined,
      map: mapEl.value,
      reason: reasonEl.value,
    });
    rows = more ? [...rows, ...page] : page;
    moreEl.hidden = page.length < PAGE_SIZE;
    listEl.replaceChildren(table(GAME_COLUMNS, rows, (g) => (location.hash = `#games/${g.id}`), 'No games yet'));
  } catch (e) {
    if (!(e instanceof AuthError)) toast((e as Error).message, 'bad');
  }
}

async function openGame(id: string): Promise<void> {
  try {
    renderDetail(await game(id));
  } catch (e) {
    if (!(e instanceof AuthError)) detailEl.replaceChildren(h('p', { class: 'error' }, (e as Error).message));
  }
}

function renderDetail(d: GameDetail): void {
  const g = d.game;
  detailEl.replaceChildren(
    h('h2', {}, `${g.mapId} · ${g.solo ? 'solo' : `co-op ×${g.partySize}`}`),
    h('dl', { class: 'facts-list' },
      h('dt', {}, 'Outcome'), h('dd', {}, outcome(g)),
      h('dt', {}, 'Rounds survived'), h('dd', {}, g.round === null ? '—' : String(g.round)),
      h('dt', {}, 'Started'), h('dd', {}, when(g.startedAt)),
      h('dt', {}, 'Ended'), h('dd', {}, when(g.endedAt)),
      h('dt', {}, 'Length'), h('dd', {}, between(g.startedAt, g.endedAt)),
      h('dt', {}, 'Room'), h('dd', {}, g.roomCode),
      h('dt', {}, 'Map version'), h('dd', {}, String(g.mapVersion)),
      h('dt', {}, 'Seed'), h('dd', { class: 'mono' }, String(d.seed)),
      h('dt', {}, 'Game id'), h('dd', { class: 'mono' }, g.id)),
    h('h3', {}, 'Players'),
    table([
      { title: 'Player', cell: (p) => h('a', { href: `#players/${p.playerId}` }, p.name) },
      { title: 'Kills', cell: (p) => p.kills, num: true },
      { title: 'Points', cell: (p) => num(p.points), num: true },
      { title: 'Rank', cell: (p) => (p.rank === null ? (p.leftAt ? 'left' : '—') : `#${p.rank + 1}`), num: true },
      { title: 'Left', cell: (p) => (p.leftAt ? between(g.startedAt, p.leftAt) + ' in' : '') },
    ], d.players),
  );
}
