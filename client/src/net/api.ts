import { loadStored } from '../core/storage';
import type { MapDoc } from '../game/MapData';

/** REST client for the Spring Boot server. Every call can fail (server down, offline); callers fall back. */

const IDENTITY_KEY = 'top-down-survival-identity';
const TIMEOUT_MS = 5000;
/** Mirrors the server's PlayerController.NAME_PATTERN. */
const NAME_RE = /^[\p{L}\p{N}_.'-]([\p{L}\p{N} _.'-]{0,18}[\p{L}\p{N}_.'-])?$/u;
export const NAME_MAX = 20;

/** `token` is missing until the server has registered the name (it may have been unreachable). */
export interface Identity {
  name: string;
  playerId?: string;
  token?: string;
}

export interface ServerScore {
  id: number;
  name: string;
  round: number;
  kills: number;
  points: number;
  partySize: number;
  date: number;
}

export interface MapSummary {
  id: string;
  name: string;
  version: number;
}

export function validName(name: string): boolean {
  return NAME_RE.test(name);
}

export function loadIdentity(): Identity | null {
  try {
    const raw = loadStored(IDENTITY_KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

function saveIdentity(id: Identity): void {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  } catch {
    // Storage unavailable; the identity lasts for this session only.
  }
}

/** A failed request; `status` is 0 when the server didn't answer. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${import.meta.env.BASE_URL}api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new ApiError(`${method} ${path}: ${res.status}`, res.status);
  return res.json() as Promise<T>;
}

/**
 * Save the name locally straight away, then register it with the server (or rename the existing
 * player). Resolves to the identity, with a token if the server answered.
 */
export async function setName(name: string): Promise<Identity> {
  const current = loadIdentity();
  const id: Identity = { ...current, name };
  saveIdentity(id);
  try {
    if (id.token) {
      try {
        await request('PATCH', '/players/me', { name }, id.token);
        return id;
      } catch (e) {
        // The server no longer knows this token (its database was reset): register afresh.
        if (!(e instanceof ApiError && e.status === 401)) throw e;
        delete id.token;
        delete id.playerId;
      }
    }
    const r = await request<{ playerId: string; token: string }>('POST', '/players', { name });
    id.playerId = r.playerId;
    id.token = r.token;
    saveIdentity(id);
  } catch {
    // Offline: keep the local name; registration is retried when connecting to a game.
  }
  return id;
}

/**
 * The identity with a server token, registering it first if needed. With `verify`, the token is
 * checked (and replaced if the server rejects it). Null if there's no name or no server.
 */
export async function ensureRegistered(verify = false): Promise<Identity | null> {
  const id = loadIdentity();
  if (!id) return null;
  if (id.token && !verify) return id;
  const r = await setName(id.name);
  return r.token ? r : null;
}

export function fetchMaps(): Promise<MapSummary[]> {
  return request<MapSummary[]>('GET', '/maps');
}

export function fetchMap(id: string): Promise<MapDoc> {
  return request<MapDoc>('GET', `/maps/${encodeURIComponent(id)}`);
}

export function fetchScores(mapId: string, limit: number): Promise<ServerScore[]> {
  return request<ServerScore[]>('GET', `/scores?map=${encodeURIComponent(mapId)}&limit=${limit}`);
}
