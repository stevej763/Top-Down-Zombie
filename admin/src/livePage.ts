import { AuthError, live, overview, type LiveRoom, type Overview } from './api';
import { h } from './dom';
import { ago, between, num } from './fmt';
import type { Page } from './main';
import { badge, dot } from './table';
import { WatchView } from './watchView';

const POLL_MS = 2000;
const el = document.getElementById('page-live')!;
let timer = 0;
let watching: WatchView | null = null;
let error = '';
let fetchedAt: string | null = null;

/** Who's online, every room, and a way into any of them. */
export const livePage: Page = {
  show(code) {
    if (code) {
      watch(code);
      return;
    }
    closeWatch();
    void poll();
  },
  hide() {
    clearTimeout(timer);
    closeWatch();
  },
};

async function poll(): Promise<void> {
  clearTimeout(timer);
  try {
    const [o, rooms] = await Promise.all([overview(), live()]);
    error = '';
    fetchedAt = new Date().toISOString();
    if (!watching) render(o, rooms);
  } catch (e) {
    if (e instanceof AuthError) return;
    error = (e as Error).message;
    if (!watching) render(null, []);
  }
  if (!watching && !el.hidden) timer = window.setTimeout(() => void poll(), POLL_MS);
}

function kpi(label: string, value: number | string, sub = ''): HTMLElement {
  return h('div', { class: 'kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, String(value)),
    h('div', { class: 'sub' }, sub));
}

function render(o: Overview | null, rooms: LiveRoom[]): void {
  const kpis = o
    ? h('div', { class: 'kpis' },
        kpi('Online now', num(o.online), 'app open in the last minute, or in a room'),
        kpi('In rooms', num(o.inRooms), `${num(o.sockets)} game sockets open`),
        kpi('Games running', num(o.playing), `${num(o.lobbies)} lobbies waiting`),
        kpi('Games today', num(o.gamesToday), `${num(o.games)} all time`),
        kpi('Players', num(o.players), `${num(o.newPlayersToday)} new today (UTC)`))
    : '';
  el.replaceChildren(
    h('div', { class: 'dash-head' }, h('h1', {}, 'Live'), h('span', { class: 'hint' }, error ? `Error: ${error}` : `Updated ${ago(fetchedAt)} · every 2 s`)),
    kpis,
    h('h2', {}, `Rooms (${rooms.length})`),
    rooms.length ? h('div', { class: 'rooms-grid' }, ...rooms.map(roomCard)) : h('p', { class: 'hint' }, 'No rooms open.'),
  );
}

function roomCard(r: LiveRoom): HTMLElement {
  const playing = r.state === 'playing';
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('span', { class: 'code' }, r.code),
      badge(playing ? 'Playing' : 'Lobby', playing ? 'good' : ''),
      badge(r.solo ? 'Solo' : 'Co-op'),
      r.paused ? badge('Paused', 'warn') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'primary', onclick: () => (location.hash = `#live/${r.code}`) }, 'Watch')),
    h('div', { class: 'facts' },
      h('span', {}, r.mapId),
      playing ? h('span', {}, `Round ${r.round}`) : null,
      playing ? h('span', {}, `${r.zombies} zombies`) : null,
      playing && r.startedAt ? h('span', {}, between(r.startedAt, null)) : null,
      playing ? h('span', {}, r.power ? 'Power on' : 'Power off') : null,
      r.spectators ? h('span', {}, `${r.spectators} watching`) : null),
    h('table', { class: 'data compact' },
      h('tbody', {}, ...r.members.map((m) => h('tr', {},
        h('td', {}, dot(m.connected, m.connected ? 'Connected' : 'Disconnected (grace period)'), ' ',
          h('a', { href: `#players/${m.playerId}` }, m.name), m.owner && !r.solo ? h('span', { class: 'hint' }, ' host') : null),
        h('td', {}, playing ? m.state ?? '—' : m.ready || m.owner ? 'ready' : 'not ready'),
        h('td', { class: 'num' }, playing ? `${num(m.points)} pts` : ''),
        h('td', { class: 'num' }, playing ? `${num(m.kills)} kills` : ''))))));
}

function watch(code: string): void {
  clearTimeout(timer);
  closeWatch();
  el.replaceChildren();
  watching = new WatchView(el, code, () => (location.hash = '#live'));
}

function closeWatch(): void {
  watching?.close();
  watching = null;
}
