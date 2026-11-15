/** Formatting for the dashboards. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "2 d ago", then the date. */
export function ago(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (ms < MIN) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MIN)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  if (ms < 30 * DAY) return `${Math.floor(ms / DAY)} d ago`;
  return new Date(iso).toLocaleDateString();
}

/** "1:05:09" / "12:04" */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export function between(from: string, to: string | null): string {
  return duration((to ? Date.parse(to) : Date.now()) - Date.parse(from));
}

export function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export const num = (n: number) => n.toLocaleString();

const REASONS: Record<string, string> = {
  over: 'Game over',
  abandoned: 'Abandoned',
  crashed: 'Crashed',
  shutdown: 'Server stopped',
};

export function reason(r: string | null): string {
  return r ? REASONS[r] ?? r : 'Running';
}
