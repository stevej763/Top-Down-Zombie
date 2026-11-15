import { AuthError, player, players, type PlayerGame, type PlayerRow } from './api';
import { h, toast } from './dom';
import { ago, between, num, when } from './fmt';
import { outcome } from './gamesPage';
import type { Page } from './main';
import { dot, table } from './table';

const PAGE_SIZE = 50;
const el = document.getElementById('page-players')!;
const searchEl = h('input', { type: 'search', placeholder: 'Search names' });
const sortEl = h('select', {},
  h('option', { value: 'seen' }, 'Last seen'),
  h('option', { value: 'created' }, 'Newest'),
  h('option', { value: 'games' }, 'Most games'),
  h('option', { value: 'best' }, 'Best round'),
  h('option', { value: 'kills' }, 'Most kills'),
  h('option', { value: 'name' }, 'Name'));
const countEl = h('span', { class: 'hint' });
const listEl = h('div', {});
const moreEl = h('button', { onclick: () => void load(true) }, 'Load more');
const detailEl = h('div', { class: 'detail' });
let rows: PlayerRow[] = [];
let searchTimer = 0;

searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void load(false), 250);
});
sortEl.addEventListener('change', () => void load(false));

/** Every player who registered a name; `#players/<id>` shows one and their games. */
export const playersPage: Page = {
  show(id) {
    el.replaceChildren(
      h('div', { class: 'dash-head' }, h('h1', {}, 'Players'), countEl, h('span', { class: 'spacer' }), searchEl, sortEl,
        h('button', { onclick: () => void load(false) }, 'Refresh')),
      h('div', { class: 'split' }, h('div', { class: 'split-main' }, listEl, moreEl), detailEl));
    void load(false);
    if (id) void openPlayer(id);
    else detailEl.replaceChildren(h('p', { class: 'hint' }, 'Pick a player to see their games.'));
  },
  hide() {
    clearTimeout(searchTimer);
  },
};

async function load(more: boolean): Promise<void> {
  try {
    const page = await players({ q: searchEl.value.trim(), sort: sortEl.value, limit: PAGE_SIZE, offset: more ? rows.length : 0 });
    rows = more ? [...rows, ...page.players] : page.players;
    countEl.textContent = `${num(page.total)} total`;
    moreEl.hidden = rows.length >= page.total;
    listEl.replaceChildren(table([
      { title: '', cell: (p) => dot(p.online, p.online ? 'Online' : 'Offline') },
      { title: 'Name', cell: (p) => p.name },
      { title: 'Now', cell: (p) => (p.room ? h('a', { href: `#live/${p.room}` }, `room ${p.room}`) : p.online ? 'in the menus' : '') },
      { title: 'Last seen', cell: (p) => ago(p.lastSeenAt) },
      { title: 'Joined', cell: (p) => ago(p.createdAt) },
      { title: 'Games', cell: (p) => p.games, num: true },
      { title: 'Best round', cell: (p) => p.bestRound, num: true },
      { title: 'Kills', cell: (p) => p.kills, num: true },
    ], rows, (p) => (location.hash = `#players/${p.id}`), 'No players found'));
  } catch (e) {
    if (!(e instanceof AuthError)) toast((e as Error).message, 'bad');
  }
}

async function openPlayer(id: string): Promise<void> {
  try {
    const d = await player(id);
    const p = d.player;
    detailEl.replaceChildren(
      h('h2', {}, dot(p.online), ' ', p.name),
      h('dl', { class: 'facts-list' },
        h('dt', {}, 'Now'), h('dd', {}, p.room ? h('a', { href: `#live/${p.room}` }, `In room ${p.room} (watch)`) : p.online ? 'In the menus' : 'Offline'),
        h('dt', {}, 'Last seen'), h('dd', {}, `${ago(p.lastSeenAt)} (${when(p.lastSeenAt)})`),
        h('dt', {}, 'Joined'), h('dd', {}, when(p.createdAt)),
        h('dt', {}, 'Games'), h('dd', {}, num(p.games)),
        h('dt', {}, 'Best round'), h('dd', {}, String(p.bestRound)),
        h('dt', {}, 'Total kills'), h('dd', {}, num(p.kills)),
        h('dt', {}, 'Player id'), h('dd', { class: 'mono' }, p.id)),
      h('h3', {}, `Games (latest ${d.games.length})`),
      table<PlayerGame>([
        { title: 'Started', cell: (g) => when(g.startedAt) },
        { title: 'Map', cell: (g) => g.mapId },
        { title: 'Mode', cell: (g) => (g.solo ? 'Solo' : `Co-op ×${g.partySize}`) },
        { title: 'Round', cell: (g) => g.round, num: true },
        { title: 'Kills', cell: (g) => g.kills, num: true },
        { title: 'Points', cell: (g) => num(g.points), num: true },
        { title: 'Length', cell: (g) => between(g.startedAt, g.leftAt ?? g.endedAt) },
        { title: 'Outcome', cell: (g) => (g.leftAt ? 'Left' : outcome(g)) },
      ], d.games, (g) => (location.hash = `#games/${g.gameId}`), 'No games yet'),
    );
  } catch (e) {
    if (!(e instanceof AuthError)) detailEl.replaceChildren(h('p', { class: 'error' }, (e as Error).message));
  }
}
