import { parseMap } from '../../client/src/game/MapData';
import { renderMap } from '../../client/src/render/draw';
import { AuthError, loadMap, mapStats, type MapStats } from './api';
import { h, toast } from './dom';
import { draftId, draftName, importFile, isDirty, newMap, openMapById, setEditorActive } from './editorPage';
import { ago, duration, num } from './fmt';
import { formatMap } from './format';
import type { Page } from './main';
import { badge } from './table';
import { seededRandom } from './view';

const listEl = document.getElementById('page-maps-list')!;
const editorEl = document.getElementById('page-maps')!;
const actionsEl = document.getElementById('maps-actions')!;
/** Rendered maps by `id@version`; a render is a full-size canvas, so do each once. */
const thumbs = new Map<string, Promise<HTMLCanvasElement>>();
let stats: MapStats[] = [];
let error = '';

/** `#maps` lists the maps with how they've been played; `#maps/edit` is the editor, `#maps/edit/<id>` opens a map in it. */
export const mapsPage: Page = {
  show(arg) {
    const editing = arg === 'edit' || !!arg?.startsWith('edit/');
    listEl.hidden = editing;
    editorEl.hidden = !editing;
    actionsEl.hidden = !editing;
    setEditorActive(editing);
    if (!editing) {
      render();
      void load();
      return;
    }
    const id = arg!.slice('edit/'.length);
    if (id) {
      void openMapById(id).then((opened) => {
        // You kept another map's changes: show that map rather than claim this one is open.
        if (!opened) history.replaceState(null, '', '#maps/edit');
      });
    }
  },
  hide() {
    setEditorActive(false);
    listEl.hidden = true;
    editorEl.hidden = true;
    actionsEl.hidden = true;
  },
};

async function load(): Promise<void> {
  try {
    stats = await mapStats();
    error = '';
  } catch (e) {
    if (e instanceof AuthError) return;
    error = (e as Error).message;
  }
  if (!listEl.hidden) render();
}

function render(): void {
  const dirty = isDirty();
  listEl.replaceChildren(
    h('div', { class: 'dash-head' },
      h('h1', {}, 'Maps'),
      error ? h('span', { class: 'error' }, error) : null,
      h('span', { class: 'spacer' }),
      h('button', { title: dirty ? 'The editor has unsaved changes' : 'Back to the map in the editor', onclick: () => (location.hash = '#maps/edit') },
        `Continue editing ${draftName()}`, dirty ? h('span', { class: 'badge warn' }, 'unsaved') : null),
      h('button', { onclick: () => void newMap() }, 'New map'),
      h('button', { onclick: importFile }, 'Import'),
      h('button', { onclick: () => void load() }, 'Refresh')),
    stats.length
      ? h('div', { class: 'maps-grid' }, ...stats.map(card))
      : h('p', { class: 'hint' }, error ? '' : 'Loading…'),
  );
}

function card(m: MapStats): HTMLElement {
  const canvas = h('canvas', { class: 'map-thumb', width: 360, height: 220 });
  void drawThumb(canvas, m);
  const edited = draftId() === m.id && isDirty();
  return h('div', { class: 'card map-card' },
    canvas,
    h('div', { class: 'card-head' },
      h('strong', {}, m.name),
      m.playingNow ? badge(`${m.playingNow} playing now`, 'good') : null,
      m.inLobby ? badge(`${m.inLobby} in lobby`) : null,
      edited ? badge('unsaved edits', 'warn') : null),
    h('div', { class: 'facts' },
      h('span', { class: 'mono' }, m.id),
      h('span', {}, `v${m.version}`),
      h('span', {}, `${m.width}×${m.height}`),
      h('span', {}, `updated ${ago(m.updatedAt)}`)),
    h('div', { class: 'map-stats' },
      stat('Games', num(m.games), m.gamesToday ? `${num(m.gamesToday)} today` : ''),
      stat('Players', num(m.players)),
      stat('Best round', m.bestRound === null ? '—' : String(m.bestRound), m.bestBy ?? ''),
      stat('Avg round', m.avgRound === null ? '—' : m.avgRound.toFixed(1), 'games played to the end'),
      stat('Avg length', m.avgLengthMs === null ? '—' : duration(m.avgLengthMs)),
      stat('Kills', num(m.kills)),
      stat('Last played', ago(m.lastPlayedAt))),
    h('div', { class: 'card-actions' },
      h('button', { class: 'primary', onclick: () => (location.hash = `#maps/edit/${encodeURIComponent(m.id)}`) }, 'Edit'),
      h('button', { disabled: !m.games, onclick: () => (location.hash = `#games?map=${encodeURIComponent(m.id)}`) }, 'Games'),
      h('button', { onclick: () => void download(m.id) }, 'Download')));
}

function stat(label: string, value: string, sub = ''): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value),
    sub ? h('div', { class: 'sub' }, sub) : null);
}

async function drawThumb(canvas: HTMLCanvasElement, m: MapStats): Promise<void> {
  const key = `${m.id}@${m.version}`;
  let full = thumbs.get(key);
  if (!full) {
    full = loadMap(m.id).then((doc) => seededRandom(() => renderMap(parseMap(doc))));
    thumbs.set(key, full);
    full.catch(() => thumbs.delete(key));
  }
  try {
    const img = await full;
    const ctx = canvas.getContext('2d')!;
    const s = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * s, hh = img.height * s;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - hh) / 2, w, hh);
  } catch {
    // The card still has its stats; the thumbnail just stays blank.
  }
}

async function download(id: string): Promise<void> {
  try {
    const url = URL.createObjectURL(new Blob([formatMap(await loadMap(id))], { type: 'application/json' }));
    h('a', { href: url, download: `${id}.json` }).click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast((e as Error).message, 'bad');
  }
}
