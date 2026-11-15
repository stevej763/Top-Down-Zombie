import { loadStored } from '../core/storage';
import type { MapDoc } from '../game/MapData';
import { deviceReport } from './device';
import { apiUrl } from './server';

/** REST client for the Spring Boot server. Every call can fail (server down, offline); callers fall back. */

const IDENTITY_KEY = 'top-down-survival-identity';
const TIMEOUT_MS = 5000;
/** Mirrors the server's PlayerController.NAME_PATTERN. */
const NAME_RE = /^[\p{L}\p{N}_.'-]([\p{L}\p{N} _.'-]{0,18}[\p{L}\p{N}_.'-])?$/u;
export const NAME_MAX = 20;

/**
 * `token` is missing until the server has registered the name (it may have been unreachable), or,
 * for an account, once the server has signed this device out (log in again). Guests have no `email`.
 * `verified`: the account has typed the code it was emailed; until then it plays under guest rules.
 */
export interface Identity {
  name: string;
  playerId?: string;
  token?: string;
  account?: boolean;
  email?: string;
  verified?: boolean;
}

/** What account calls resolve to: null when it worked, otherwise a message to show. */
export type Outcome = string | null;

const OFFLINE = "Can't reach the server";

export interface ServerScore {
  id: number;
  name: string;
  round: number;
  kills: number;
  points: number;
  partySize: number;
  date: number;
  /** The player has no account. */
  guest: boolean;
}

export interface MapSummary {
  id: string;
  name: string;
  version: number;
  /** Guests may play it (solo). Every other map, and co-op, needs an account. */
  guest: boolean;
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

function saveIdentity(id: Identity | null): void {
  try {
    if (id) localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
    else localStorage.removeItem(IDENTITY_KEY);
  } catch {
    // Storage unavailable; the identity lasts for this session only.
  }
}

export function isAccount(): boolean {
  return loadIdentity()?.account === true;
}

/** An account that hasn't verified its email yet, so it's kept to the guest rules. */
export function needsVerifying(): boolean {
  const id = loadIdentity();
  return id?.account === true && !!id.token && id.verified !== true;
}

/** Plays without the guest limits: a verified account. */
export function unlocked(): boolean {
  const id = loadIdentity();
  return id?.account === true && id.verified === true;
}

/** An account this device has been signed out of (by a password change elsewhere): it needs to log in again. */
export function needsLogin(): boolean {
  const id = loadIdentity();
  return id?.account === true && !id.token;
}

/** Whether this player may start this map: guests and unverified accounts only play guest maps, solo. */
export function canPlay(map: MapSummary | undefined, solo: boolean): boolean {
  return unlocked() || (solo && map?.guest === true);
}

/** A failed request; `status` is 0 when the server didn't answer. `message` is the server's, when it gave one. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(OFFLINE, 0);
  }
  if (!res.ok) {
    let message = `${method} ${path}: ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string };
      if (j.message) message = j.message;
    } catch {
      // No JSON body.
    }
    throw new ApiError(message, res.status);
  }
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}

function problem(e: unknown): string {
  return e instanceof ApiError ? e.message : OFFLINE;
}

/** The server forgot this device's token: a guest registers afresh later; an account has to log in again. */
function tokenRejected(id: Identity): void {
  delete id.token;
  if (!id.account) delete id.playerId;
  saveIdentity(id);
}

interface SignedIn {
  playerId: string;
  name: string;
  token: string;
  account: boolean;
  verified: boolean;
}

/**
 * Save the name locally, then register it with the server (or rename the existing player).
 * Resolves to null, or why the server refused the name (taken by an account), in which case the
 * old name is kept. Offline, the local name stays and registration is retried when connecting.
 */
export async function setName(name: string): Promise<Outcome> {
  const current = loadIdentity();
  const id: Identity = { ...current, name };
  try {
    if (id.token) {
      try {
        await request('PATCH', '/players/me', { name }, id.token);
        saveIdentity(id);
        return null;
      } catch (e) {
        // The server no longer knows this token (its database was reset, or the account signed this device out).
        if (!(e instanceof ApiError && e.status === 401)) throw e;
        tokenRejected(id);
        if (id.account) return 'Log in again';
      }
    }
    if (id.account) return 'Log in again';
    const r = await request<SignedIn>('POST', '/players', { name });
    saveIdentity({ name, playerId: r.playerId, token: r.token });
    return null;
  } catch (e) {
    if (e instanceof ApiError && e.status !== 0) return e.message;
    if (!id.account) saveIdentity(id);
    return null;
  }
}

/** Creates an account. A guest's identity becomes the account, keeping their scores. */
export async function register(email: string, username: string, password: string): Promise<Outcome> {
  const current = loadIdentity();
  try {
    const guestToken = current && !current.account ? current.token : undefined;
    const r = await request<SignedIn>('POST', '/players/register', { email, username, password }, guestToken);
    saveIdentity({ name: r.name, playerId: r.playerId, token: r.token, account: true, email: email.trim().toLowerCase(), verified: r.verified });
    return null;
  } catch (e) {
    return problem(e);
  }
}

/** Signs in to an account on this device; any guest identity here is left behind. */
export async function login(email: string, password: string): Promise<Outcome> {
  try {
    const r = await request<SignedIn>('POST', '/players/login', { email, password });
    saveIdentity({ name: r.name, playerId: r.playerId, token: r.token, account: true, email: email.trim().toLowerCase(), verified: r.verified });
    return null;
  } catch (e) {
    return problem(e);
  }
}

/** Signs this device out and forgets the identity, guest or account. */
export async function logout(): Promise<void> {
  const token = loadIdentity()?.token;
  saveIdentity(null);
  if (token) await request('POST', '/players/logout', undefined, token).catch(() => {});
}

/** Checks the code emailed to the account; marks this identity verified when it's right. */
export async function verifyEmail(code: string): Promise<Outcome> {
  const id = loadIdentity();
  if (!id?.token) return 'Log in again';
  try {
    await request('POST', '/players/me/verify', { code }, id.token);
    saveIdentity({ ...id, verified: true });
    return null;
  } catch (e) {
    return problem(e);
  }
}

/** Emails the account a new code. */
export async function resendCode(): Promise<Outcome> {
  const token = loadIdentity()?.token;
  if (!token) return 'Log in again';
  try {
    await request('POST', '/players/me/verify/resend', undefined, token);
    return null;
  } catch (e) {
    return problem(e);
  }
}

export async function changePassword(current: string, password: string): Promise<Outcome> {
  const token = loadIdentity()?.token;
  if (!token) return 'Log in again';
  try {
    await request('PATCH', '/players/me/password', { current, password }, token);
    return null;
  } catch (e) {
    return problem(e);
  }
}

/** Brings the saved identity up to date with the server (name, account), e.g. after a change on another device. */
export async function refreshMe(): Promise<void> {
  const id = loadIdentity();
  if (!id?.token) return;
  try {
    const me = await request<{ name: string; account: boolean; email: string | null; verified: boolean }>('GET', '/players/me', undefined, id.token);
    saveIdentity({ ...id, name: me.name, account: me.account, email: me.email ?? undefined, verified: me.verified });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) tokenRejected(id);
  }
}

/**
 * The identity with a server token, registering a guest first if needed. With `verify`, the token
 * is checked (and a guest's replaced if the server rejects it). Null if there's no name, no
 * server, or an account that has to log in again.
 */
export async function ensureRegistered(verify = false): Promise<Identity | null> {
  const id = loadIdentity();
  if (!id) return null;
  if (id.token && !verify) return id;
  if (id.account && !id.token) return null;
  await setName(id.name);
  const r = loadIdentity();
  return r?.token ? r : null;
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

const HEARTBEAT_MS = 30_000;

/**
 * Tells the server the app is open, every 30 s while the page is visible, so the admin portal can
 * show who's online and on what device. Only once the player has registered (named themselves); failures are ignored.
 */
export function startHeartbeat(): void {
  const beat = (): void => {
    const token = loadIdentity()?.token;
    if (!token || document.visibilityState !== 'visible') return;
    fetch(apiUrl('/players/me/seen'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(deviceReport()),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => {});
  };
  beat();
  setInterval(beat, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', beat);
}
