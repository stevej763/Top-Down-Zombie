import type { MapDoc } from '../../client/src/game/MapData';

export interface MapSummary {
  id: string;
  name: string;
  version: number;
}

export interface Admin {
  id: string;
  username: string;
}

/** The session ended (or never started); main.ts shows the login again. */
export class AuthError extends Error {}

/** A failed save, with the validator's problems when the server sent them. */
export class SaveError extends Error {
  constructor(message: string, readonly problems: string[] = [], readonly status = 0) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};

/** Called whenever the server says the session is gone. */
export function setUnauthorizedHandler(f: () => void): void {
  onUnauthorized = f;
}

/**
 * Every call to the server. The session is an HttpOnly cookie; the header is what the server
 * checks on changes, so another site can't make them with the cookie.
 */
async function call(method: string, path: string, body?: unknown, raw?: string): Promise<Response> {
  const headers: Record<string, string> = { 'X-Requested-With': 'admin' };
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  if (res.status === 401 && path !== '/api/admin/login') {
    onUnauthorized();
    throw new AuthError('Logged out');
  }
  return res;
}

/** The server's message for a failed request, or the status. */
async function failure(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j.detail ?? j.message ?? j.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await call(method, path, body);
  if (!res.ok) throw new Error(await failure(res));
  return res.status === 204 ? (undefined as T) : res.json();
}

// ------------------------------------------------------------------ session

/** The logged-in admin, or null. */
export async function me(): Promise<Admin | null> {
  try {
    return await json<Admin>('GET', '/api/admin/me');
  } catch (e) {
    if (e instanceof AuthError) return null;
    throw e;
  }
}

export async function login(username: string, password: string): Promise<Admin> {
  const res = await call('POST', '/api/admin/login', { username, password });
  if (!res.ok) throw new Error(res.status === 401 ? 'Wrong username or password' : await failure(res));
  return res.json();
}

export const logout = () => json<void>('POST', '/api/admin/logout');
export const changePassword = (current: string, next: string) => json<void>('POST', '/api/admin/password', { current, next });

export interface AdminRow extends Admin {
  createdAt: string;
  lastLoginAt: string | null;
}

export const listAdmins = () => json<AdminRow[]>('GET', '/api/admin/admins');
export const addAdmin = (username: string, password: string) => json<Admin>('POST', '/api/admin/admins', { username, password });
export const removeAdmin = (id: string) => json<void>('DELETE', `/api/admin/admins/${id}`);

// ------------------------------------------------------------------ dashboards

export interface Overview {
  sockets: number;
  online: number;
  inRooms: number;
  lobbies: number;
  playing: number;
  spectators: number;
  players: number;
  newPlayersToday: number;
  games: number;
  gamesToday: number;
}

export interface LiveMember {
  id: number;
  playerId: string;
  name: string;
  connected: boolean;
  ready: boolean;
  owner: boolean;
  /** alive / downed / dead while playing; null in the lobby. */
  state: string | null;
  points: number;
  kills: number;
}

export interface LiveRoom {
  code: string;
  mapId: string;
  solo: boolean;
  state: 'lobby' | 'playing';
  gameId: string | null;
  startedAt: string | null;
  tick: number;
  round: number;
  zombies: number;
  power: boolean;
  paused: boolean;
  spectators: number;
  members: LiveMember[];
}

export interface GameRow {
  id: string;
  roomCode: string;
  mapId: string;
  mapVersion: number;
  solo: boolean;
  partySize: number;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  round: number | null;
  players: string | null;
  kills: number;
  points: number;
}

export interface GamePlayer {
  playerId: string;
  simId: number;
  name: string;
  kills: number;
  points: number;
  leftAt: string | null;
  rank: number | null;
}

export interface GameDetail {
  game: GameRow;
  seed: number;
  players: GamePlayer[];
}

export interface PlayerRow {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  online: boolean;
  room: string | null;
  games: number;
  bestRound: number;
  kills: number;
}

export interface PlayerGame {
  gameId: string;
  mapId: string;
  solo: boolean;
  partySize: number;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  round: number | null;
  kills: number;
  points: number;
  leftAt: string | null;
}

const query = (q: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const overview = () => json<Overview>('GET', '/api/admin/overview');
export const live = () => json<LiveRoom[]>('GET', '/api/admin/live');
export const games = (q: { limit?: number; before?: string; map?: string; reason?: string; player?: string }) =>
  json<GameRow[]>('GET', `/api/admin/games${query(q)}`);
export const game = (id: string) => json<GameDetail>('GET', `/api/admin/games/${id}`);
export const players = (q: { q?: string; sort?: string; limit?: number; offset?: number }) =>
  json<{ total: number; players: PlayerRow[] }>('GET', `/api/admin/players${query(q)}`);
export const player = (id: string) => json<{ player: PlayerRow; games: PlayerGame[] }>('GET', `/api/admin/players/${id}`);

/** The spectator socket for a room (same-origin; the session cookie authenticates it). */
export function watchSocket(code: string): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(`${proto}//${location.host}/ws/watch?code=${encodeURIComponent(code)}`);
}

// ------------------------------------------------------------------ maps

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

/** PUT /api/maps/{id}: create or replace. */
export async function saveMap(doc: MapDoc, body: string): Promise<MapSummary> {
  const res = await call('PUT', `/api/maps/${encodeURIComponent(doc.id)}`, undefined, body);
  if (res.ok) return res.json();
  let detail: { error?: string; message?: string; detail?: string; problems?: string[] } = {};
  try {
    detail = await res.json();
  } catch {
    // Not JSON (e.g. the proxy's own error page).
  }
  const msg = detail.problems ? 'The server rejected the map' : detail.detail ?? detail.message ?? detail.error ?? `HTTP ${res.status}`;
  throw new SaveError(msg, detail.problems ?? [], res.status);
}

/** Dev server only (see vite.config.ts): write maps/<id>.json in the repo. */
export async function writeRepoFile(id: string, body: string): Promise<string> {
  const res = await fetch(`/__repo/maps/${encodeURIComponent(id)}`, { method: 'PUT', body });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
  return text;
}
