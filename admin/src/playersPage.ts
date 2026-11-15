import { AuthError, player, players, type PlayerDevice, type PlayerGame, type PlayerIp, type PlayerRow } from './api';
import { h, toast } from './dom';
import { ago, between, num, when } from './fmt';
import { outcome } from './gamesPage';
import type { Page } from './main';
import { dot, table } from './table';

const PAGE_SIZE = 50;
const el = document.getElementById('page-players')!;
const searchEl = h('input', { type: 'search', placeholder: 'Search names, emails or IPs' });
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
      { title: 'Account', cell: (p) => p.email ?? 'guest' },
      { title: 'Now', cell: (p) => (p.room ? h('a', { href: `#live/${p.room}` }, `room ${p.room}`) : p.online ? 'in the menus' : '') },
      { title: 'Last seen', cell: (p) => ago(p.lastSeenAt) },
      { title: 'Joined', cell: (p) => ago(p.createdAt) },
      { title: 'Games', cell: (p) => p.games, num: true },
      { title: 'Best round', cell: (p) => p.bestRound, num: true },
      { title: 'Kills', cell: (p) => p.kills, num: true },
      { title: 'Device', cell: (p) => (p.platform ? `${PLATFORMS[p.platform] ?? p.platform}${p.device ? ` · ${p.device}` : ''}` : null) },
      { title: 'IP', cell: (p) => p.lastIp },
    ], rows, (p) => (location.hash = `#players/${p.id}`), 'No players found'));
  } catch (e) {
    if (!(e instanceof AuthError)) toast((e as Error).message, 'bad');
  }
}

const PLATFORMS: Record<string, string> = { web: 'Web', ios: 'iOS app', android: 'Android app' };
/** Labels for the client's `details`; unknown keys show as sent. */
const DETAILS: Record<string, string> = {
  screen: 'Screen', pixelRatio: 'Pixel ratio', viewport: 'Window', language: 'Language', timeZone: 'Time zone',
  cores: 'CPU cores', memoryGb: 'Memory (GB)', touch: 'Touch', network: 'Network', standalone: 'Installed (PWA)',
  appVersion: 'App version', androidSdk: 'Android SDK', emulator: 'Emulator',
};

/** Clicking an address lists every player seen there. */
function searchFor(text: string): void {
  searchEl.value = text;
  void load(false);
}

function deviceCard(dv: PlayerDevice): HTMLElement {
  const facts: [string, string | null][] = [
    ['Platform', PLATFORMS[dv.platform] ?? dv.platform],
    ['Model', dv.model],
    ['OS', dv.os],
    ['Browser', dv.browser],
    ['Last IP', dv.ip],
    ['First seen', when(dv.firstSeenAt)],
    ['Last seen', `${ago(dv.lastSeenAt)} (${when(dv.lastSeenAt)})`],
    ...Object.entries(dv.details).map(([k, v]): [string, string | null] => [DETAILS[k] ?? k, v === null ? null : String(v)]),
    ['User agent', dv.userAgent],
    ['Device id', dv.deviceId],
  ];
  return h('dl', { class: 'facts-list' },
    ...facts.filter(([, v]) => v !== null && v !== '').flatMap(([k, v]) => [h('dt', {}, k),
      h('dd', { class: k === 'User agent' || k === 'Device id' || k === 'Last IP' ? 'mono' : '' }, v!)]));
}

async function openPlayer(id: string): Promise<void> {
  try {
    const d = await player(id);
    const p = d.player;
    detailEl.replaceChildren(
      h('h2', {}, dot(p.online), ' ', p.name),
      h('dl', { class: 'facts-list' },
        h('dt', {}, 'Now'), h('dd', {}, p.room ? h('a', { href: `#live/${p.room}` }, `In room ${p.room} (watch)`) : p.online ? 'In the menus' : 'Offline'),
        h('dt', {}, 'Account'), h('dd', {}, p.email ? `${p.email} (since ${when(p.accountAt)})` : 'Guest'),
        h('dt', {}, 'Last seen'), h('dd', {}, `${ago(p.lastSeenAt)} (${when(p.lastSeenAt)})`),
        h('dt', {}, 'Joined'), h('dd', {}, when(p.createdAt)),
        h('dt', {}, 'Games'), h('dd', {}, num(p.games)),
        h('dt', {}, 'Best round'), h('dd', {}, String(p.bestRound)),
        h('dt', {}, 'Total kills'), h('dd', {}, num(p.kills)),
        h('dt', {}, 'Last IP'), h('dd', { class: 'mono' }, p.lastIp ?? '—'),
        h('dt', {}, 'Signed up from'), h('dd', { class: 'mono' }, d.createdIp ?? '—'),
        h('dt', {}, 'Player id'), h('dd', { class: 'mono' }, p.id)),
      h('h3', {}, `Devices (${d.devices.length})`),
      ...(d.devices.length ? d.devices.map(deviceCard) : [h('p', { class: 'hint' }, 'None reported yet.')]),
      h('h3', {}, `IP addresses (${d.ips.length})`),
      table<PlayerIp>([
        { title: 'Address', cell: (i) => h('span', { class: 'mono' }, i.ip) },
        { title: 'First seen', cell: (i) => when(i.firstSeenAt) },
        { title: 'Last seen', cell: (i) => ago(i.lastSeenAt) },
        { title: 'Other players', cell: (i) => i.otherPlayers, num: true },
      ], d.ips, (i) => searchFor(i.ip), 'None recorded yet'),
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
