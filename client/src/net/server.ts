/**
 * Where the game server is. The web build talks to its own origin (nginx or the Vite proxy forwards
 * /api and /ws). The mobile app's WebView has its own origin (capacitor://localhost), so it is built
 * with VITE_SERVER_URL pointing at the real server.
 */
const SERVER = import.meta.env.VITE_SERVER_URL?.replace(/\/$/, '');

export function apiUrl(path: string): string {
  return SERVER ? `${SERVER}/api${path}` : `${import.meta.env.BASE_URL}api${path}`;
}

export function wsUrl(): string {
  return SERVER ? `${SERVER.replace(/^http/, 'ws')}/ws` : `${location.origin.replace(/^http/, 'ws')}${import.meta.env.BASE_URL}ws`;
}
