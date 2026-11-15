import type { MapDoc } from '../../client/src/game/MapData';
import { TILE } from '../../client/src/game/TileMap';
import { AuthError, loadMap, saveMap, SaveError, writeRepoFile } from './api';
import { loadStored } from '../../client/src/core/storage';
import { h, modal, toast } from './dom';
import { Editor } from './editor';
import { formatMap } from './format';
import { blankDraft, FACES, fromDoc, setCell, TILES, toDoc, type Draft } from './model';
import { renderOptions, renderSide, renderTools, TOOLS } from './panels';
import { namesFromLabels } from './rooms';
import { View } from './view';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stage = document.getElementById('stage')!;
const toolsEl = document.getElementById('tools')!;
const optionsEl = document.getElementById('options')!;
const sideEl = document.getElementById('side')!;
const statusEl = document.getElementById('status')!;
const fileInput = document.getElementById('file') as HTMLInputElement;
const button = (act: string) => document.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!;

const view = new View();
let shown = -1;
/** The editor is one page of the portal; hidden, it neither draws nor takes keys. */
let active = false;

/** Fit the map once the stage has a size: maps can be loaded while the editor is hidden. */
let needsFit = true;

/** Call after the page is shown (so the stage has a size) or hidden. */
export function setEditorActive(on: boolean): void {
  if (on && !active) {
    active = true;
    shown = -1;
    if (needsFit) fit();
    requestAnimationFrame(frame);
  }
  active = on;
}
const restored = Editor.savedDraft();
const editor = new Editor(restored ?? starterDraft('new-map', 'New Map', 40, 30, true), () => {});

// ------------------------------------------------------------------ unsaved changes

const BASELINE_KEY = 'top-down-survival-admin-draft-baseline';
const docText = () => JSON.stringify(toDoc(editor.draft));
/** The draft as last opened or saved, to tell whether there's anything to lose. */
let baseline = (restored && loadStored(BASELINE_KEY)) || docText();

function markClean(): void {
  baseline = docText();
  try {
    localStorage.setItem(BASELINE_KEY, baseline);
  } catch {
    // Not kept across reloads, then.
  }
}

export const isDirty = () => docText() !== baseline;
export const draftName = () => editor.draft.name || editor.draft.id;
export const draftId = () => editor.draft.id;

/** True if there are no unsaved changes, or you said to throw them away. */
async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true;
  const res = await modal('Discard unsaved changes?', h('p', {}, `${draftName()} has changes that haven't been saved to the server or the repo.`),
    ['Discard', 'Cancel']);
  return res === 'Discard';
}

function loadDraft(d: Draft): void {
  editor.load(d);
  markClean();
  if (active) fit();
  else needsFit = true;
}

/** A new map, optionally with one walled room in the middle to start from. */
function starterDraft(id: string, name: string, w: number, h: number, room: boolean): Draft {
  const d = blankDraft(id, name, w, h);
  if (room && w >= 14 && h >= 14) {
    const x0 = 4, y0 = 4, x1 = w - 5, y1 = h - 5;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) setCell(d, x, y, x === x0 || x === x1 || y === y0 || y === y1 ? '#' : '_');
    }
    d.playerStart = { tx: Math.floor(w / 2), ty: Math.floor(h / 2) };
  }
  return d;
}

function draftFromDoc(doc: MapDoc): Draft {
  const d = fromDoc(doc);
  namesFromLabels(d);
  return d;
}

// ------------------------------------------------------------------ panels

function refresh(): void {
  shown = -1;
}

/** Rebuild the panels when the editor changed (not while you're typing in one of them). */
function syncPanels(): void {
  const key = editor.revision * 100 + TOOLS.findIndex((t) => t.id === editor.tool);
  if (key === shown) return;
  shown = key;
  renderTools(toolsEl, editor, refresh);
  renderOptions(optionsEl, editor, refresh);
  renderSide(sideEl, editor, { focus, refresh });
  button('undo').disabled = !editor.canUndo;
  button('redo').disabled = !editor.canRedo;
  button('grid').classList.toggle('on', view.showGrid);
  button('rooms').classList.toggle('on', view.showRooms);
  button('clean').classList.toggle('on', view.clean);
  const ok = editor.problems.length === 0;
  button('save').title = ok ? 'PUT /api/maps/<id> (Ctrl+S)' : `Fix ${editor.problems.length} problem(s) first`;
  document.title = `${editor.draft.name || editor.draft.id} · Maps · Top Down Survival admin`;
}

function focus(tx: number, ty: number): void {
  const r = stage.getBoundingClientRect();
  view.zoom = Math.max(view.zoom, 1);
  view.panX = r.width / 2 - (tx + 0.5) * TILE * view.zoom;
  view.panY = r.height / 2 - (ty + 0.5) * TILE * view.zoom;
}

// ------------------------------------------------------------------ canvas

function resizeCanvas(): void {
  const r = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
}
new ResizeObserver(resizeCanvas).observe(stage);
resizeCanvas();

function fit(): void {
  const r = stage.getBoundingClientRect();
  if (!r.width) return;
  needsFit = false;
  view.fit(editor.draft, r.width, r.height);
}

let panning: { x: number; y: number } | null = null;
let spaceDown = false;

function cursorOf(ev: MouseEvent) {
  const r = canvas.getBoundingClientRect();
  return view.toTile(ev.clientX - r.left, ev.clientY - r.top);
}

canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
canvas.addEventListener('pointerdown', (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && spaceDown)) {
    panning = { x: ev.clientX, y: ev.clientY };
    canvas.classList.add('panning');
    return;
  }
  if (ev.button === 0) editor.pointerDown(cursorOf(ev), ev.altKey);
});
canvas.addEventListener('pointermove', (ev) => {
  if (panning) {
    view.panX += ev.clientX - panning.x;
    view.panY += ev.clientY - panning.y;
    panning = { x: ev.clientX, y: ev.clientY };
    return;
  }
  editor.pointerMove(cursorOf(ev));
});
canvas.addEventListener('pointerup', () => {
  if (panning) {
    panning = null;
    canvas.classList.remove('panning');
    return;
  }
  editor.pointerUp();
});
canvas.addEventListener('pointerleave', () => editor.pointerLeave());
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const r = canvas.getBoundingClientRect();
  view.zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });

function status(): string {
  const hv = editor.hover;
  const d = editor.draft;
  const parts: string[] = [];
  if (hv && hv.tx >= 0 && hv.ty >= 0 && hv.tx < d.width && hv.ty < d.height) {
    const ch = d.cells[hv.ty * d.width + hv.tx];
    const room = d.roomNames[hv.ty * d.width + hv.tx];
    parts.push(`${hv.tx},${hv.ty}`, TILES.find((t) => t.ch === ch)?.name ?? ch);
    if (room) parts.push(room);
  }
  parts.push(`${d.width}×${d.height}`, `${Math.round(view.zoom * 100)}%`);
  parts.push(editor.problems.length ? `${editor.problems.length} problem(s)` : 'valid');
  return parts.join('  ·  ');
}

function frame(t: number): void {
  if (!active) return;
  syncPanels();
  view.render(ctx, editor, t / 1000);
  statusEl.textContent = status();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ keys

const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));

window.addEventListener('keydown', (ev) => {
  if (!active) return;
  const target = ev.target as HTMLElement;
  const typing = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA';
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === 's') {
    ev.preventDefault();
    void saveToServer();
    return;
  }
  if (typing || (document.getElementById('modal') as HTMLDialogElement).open) return;
  const k = ev.key.toLowerCase();
  if (mod && k === 'z') {
    ev.preventDefault();
    if (ev.shiftKey) editor.redo();
    else editor.undo();
    return;
  }
  if (mod && k === 'y') {
    ev.preventDefault();
    editor.redo();
    return;
  }
  if (mod) return;
  if (ev.key === ' ') {
    spaceDown = true;
    ev.preventDefault();
  } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
    editor.deleteSelection();
  } else if (ev.key === 'Escape') {
    editor.selection = null;
    editor.revision++;
  } else if (k >= '1' && k <= '7') {
    editor.tile = TILES[Number(k) - 1].ch;
    if (!['brush', 'rect', 'fill'].includes(editor.tool)) editor.tool = 'brush';
    editor.revision++;
  } else if (k === 'q') {
    const s = editor.selection;
    if (editor.tool === 'select' && s?.kind === 'decor') editor.rotateDecor(s.index);
    else {
      editor.face = FACES[(FACES.indexOf(editor.face) + 1) % 4];
      editor.revision++;
    }
  } else if (k === 'f') {
    fit();
  } else if (k === 'c') {
    view.clean = !view.clean;
    editor.revision++;
  } else if (TOOL_KEYS[k]) {
    editor.tool = TOOL_KEYS[k];
    editor.revision++;
  }
});
window.addEventListener('keyup', (ev) => {
  if (ev.key === ' ') spaceDown = false;
});

// ------------------------------------------------------------------ actions

/** Returns whether a map was created. */
export async function newMap(): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  const id = h('input', { type: 'text', value: 'new-map' });
  const name = h('input', { type: 'text', value: 'New Map', maxlength: 40 });
  const w = h('input', { type: 'number', min: 10, max: 200, value: 46 });
  const hh = h('input', { type: 'number', min: 10, max: 200, value: 32 });
  const room = h('input', { type: 'checkbox', checked: true });
  const ok = await modal('New map', [
    h('div', { class: 'row' }, h('label', {}, 'Id'), id),
    h('div', { class: 'row' }, h('label', {}, 'Name'), name),
    h('div', { class: 'row' }, h('label', {}, 'Size'), w, '×', hh),
    h('div', { class: 'row' }, h('label', {}, ''), h('label', {}, room, ' Start with a walled room')),
    h('p', { class: 'hint' }, 'The House is 46×32 and The Farmstead 64×40. Leave a few tiles of yard round the buildings for zombies to come from.'),
  ], ['Create', 'Cancel']);
  if (ok !== 'Create') return false;
  const cw = Math.max(10, Math.min(200, Number(w.value) || 46));
  const ch = Math.max(10, Math.min(200, Number(hh.value) || 32));
  loadDraft(starterDraft(id.value.trim() || 'new-map', name.value || 'New Map', cw, ch, room.checked));
  location.hash = '#maps/edit';
  return true;
}

/**
 * Open a map from the server. The draft is kept if it's already this map with unsaved changes (so an
 * edit survives a trip to another tab). Returns false if you kept another map's changes instead.
 */
export async function openMapById(id: string): Promise<boolean> {
  if (editor.draft.id === id && isDirty()) return true;
  if (!(await confirmDiscard())) return false;
  try {
    loadDraft(draftFromDoc(await loadMap(id)));
  } catch (e) {
    toast((e as Error).message, 'bad');
  }
  return true;
}

export function importFile(): void {
  fileInput.value = '';
  fileInput.click();
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file || !(await confirmDiscard())) return;
  try {
    loadDraft(draftFromDoc(JSON.parse(await file.text()) as MapDoc));
    location.hash = '#maps/edit';
    toast(`Imported ${file.name}`);
  } catch (e) {
    toast(`Not a map file: ${(e as Error).message}`, 'bad');
  }
});

function download(): void {
  const doc = toDoc(editor.draft);
  const url = URL.createObjectURL(new Blob([formatMap(doc)], { type: 'application/json' }));
  const a = h('a', { href: url, download: `${doc.id || 'map'}.json` });
  a.click();
  URL.revokeObjectURL(url);
}

async function blockedByProblems(action: string): Promise<boolean> {
  if (!editor.problems.length) return false;
  await modal(`Can't ${action} yet`, [
    h('p', {}, `The map has ${editor.problems.length} problem(s). The server would reject it:`),
    h('ul', {}, ...editor.problems.slice(0, 30).map((p) => h('li', {}, p.msg))),
  ]);
  return true;
}

async function saveToServer(): Promise<void> {
  if (await blockedByProblems('save')) return;
  const doc = toDoc(editor.draft);
  try {
    const saved = await saveMap(doc, JSON.stringify(doc));
    markClean();
    // Repo files are re-seeded on every server start and win over uploads.
    const note = import.meta.env.DEV ? ` If maps/${saved.id}.json exists, it replaces this when the server restarts: use Write to repo to keep it.` : '';
    toast(`Saved ${saved.name} (${saved.id} v${saved.version}) to the server.${note}`, 'good');
  } catch (e) {
    // Logged out: the login screen is up, and the draft is kept, so saving again after works.
    if (e instanceof AuthError) return;
    if (e instanceof SaveError && e.problems.length) {
      await modal('The server rejected the map', h('ul', {}, ...e.problems.map((p) => h('li', {}, p))));
      return;
    }
    toast(`Save failed: ${(e as Error).message}`, 'bad');
  }
}

async function saveToRepo(): Promise<void> {
  if (await blockedByProblems('write the file')) return;
  const doc = toDoc(editor.draft);
  try {
    const path = await writeRepoFile(doc.id, formatMap(doc));
    markClean();
    toast(`Wrote ${path}. Restart the server to load it, and run npm run render-maps in client/ for the preview.`, 'good');
  } catch (e) {
    toast(`Write failed: ${(e as Error).message}`, 'bad');
  }
}

const actions: Record<string, () => void> = {
  new: () => void newMap(),
  import: importFile,
  download,
  undo: () => editor.undo(),
  redo: () => editor.redo(),
  grid: () => { view.showGrid = !view.showGrid; refresh(); },
  rooms: () => { view.showRooms = !view.showRooms; refresh(); },
  clean: () => { view.clean = !view.clean; refresh(); },
  fit,
  save: () => void saveToServer(),
  repo: () => void saveToRepo(),
};
document.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act!]()));
if (!import.meta.env.DEV) document.querySelectorAll<HTMLElement>('.dev-only').forEach((el) => el.remove());
