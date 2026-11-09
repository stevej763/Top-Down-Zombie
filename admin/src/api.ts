import type { MapDoc } from '../../client/src/game/MapData';
import { loadStored } from '../../client/src/core/storage';

export interface MapSummary {
  id: string;
  name: string;
  version: number;
}

const TOKEN_KEY = 'top-down-survival-admin-token';

export const adminToken = {
  get: () => loadStored(TOKEN_KEY) ?? '',
  set: (t: string) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)),
};

/** A failed save, with the validator's problems when the server sent them. */
export class SaveError extends Error {
  constructor(message: string, readonly problems: string[] = [], readonly status = 0) {
    super(message);
  }
}

export async function listMaps(): Promise<MapSummary[]> {
  const res = await fetch('/api/maps');
  if (!res.ok) throw new Error(`GET /api/maps: ${res.status}`);
  return res.json();
}

export async function loadMap(id: string): Promise<MapDoc> {
  const res = await fetch(`/api/maps/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`GET /api/maps/${id}: ${res.status}`);
  return res.json();
}

/** PUT /api/maps/{id}: create or replace. Needs the server's ADMIN_TOKEN. */
export async function saveMap(doc: MapDoc, body: string): Promise<MapSummary> {
  const res = await fetch(`/api/maps/${encodeURIComponent(doc.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken.get() },
    body,
  });
  if (res.ok) return res.json();
  let detail: { error?: string; message?: string; detail?: string; problems?: string[] } = {};
  try {
    detail = await res.json();
  } catch {
    // Not JSON (e.g. the proxy's own error page).
  }
  const msg = detail.problems
    ? 'The server rejected the map'
    : res.status === 403
      ? 'Forbidden: check the admin token (and that the server has ADMIN_TOKEN set)'
      : detail.detail ?? detail.message ?? detail.error ?? `HTTP ${res.status}`;
  throw new SaveError(msg, detail.problems ?? [], res.status);
}

/** Dev server only (see vite.config.ts): write maps/<id>.json in the repo. */
export async function writeRepoFile(id: string, body: string): Promise<string> {
  const res = await fetch(`/__repo/maps/${encodeURIComponent(id)}`, { method: 'PUT', body });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return text;
}
