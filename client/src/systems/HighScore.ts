import { fetchScores, submitScore } from '../net/api';

const KEY = 'boarded-up-scores';
/** Pre-leaderboard single best score; migrated into the table on first load. */
const LEGACY_KEY = 'boarded-up-best';
export const MAX_SCORES = 10;

export interface ScoreEntry {
  round: number;
  kills: number;
  points: number;
  /** Epoch ms; 0 for migrated legacy entries. */
  date: number;
  /** Server-side only: row id and player name. */
  id?: number;
  name?: string;
}

function compare(a: ScoreEntry, b: ScoreEntry): number {
  return b.round - a.round || b.kills - a.kills || b.points - a.points;
}

/** The house map keeps the original key, so existing local scores stay with it. */
function localKey(mapId: string): string {
  return mapId === 'house' ? KEY : `${KEY}:${mapId}`;
}

function loadLocal(mapId: string): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(localKey(mapId));
    if (raw) return (JSON.parse(raw) as ScoreEntry[]).sort(compare).slice(0, MAX_SCORES);
    const legacy = mapId === 'house' && localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const b = JSON.parse(legacy) as { round: number; kills: number };
      if (b.round > 0 || b.kills > 0) return [{ round: b.round, kills: b.kills, points: 0, date: 0 }];
    }
  } catch {
    // Storage unavailable (private mode etc.) or corrupt — fall through.
  }
  return [];
}

/** Insert a run into the table (in place) and save. Returns its 0-based rank, or -1 if it didn't place. */
function addLocal(mapId: string, scores: ScoreEntry[], entry: ScoreEntry): number {
  scores.push(entry);
  scores.sort(compare);
  scores.length = Math.min(scores.length, MAX_SCORES);
  try {
    localStorage.setItem(localKey(mapId), JSON.stringify(scores));
  } catch {
    // Ignore.
  }
  return scores.indexOf(entry);
}

/**
 * The high-score table shown in the menus, for one map at a time (`mapId`). Online it's the
 * server's leaderboard; when the server can't be reached it falls back to this browser's own
 * top 10 for the map, which is always kept up to date either way.
 */
export class Leaderboard {
  private local: ScoreEntry[];
  entries: ScoreEntry[];
  online = false;
  loading = false;
  /** Position of the last finished run (-1 if it didn't place, or the server hasn't answered yet). */
  lastRank = -1;

  constructor(public mapId: string) {
    this.local = this.entries = loadLocal(mapId);
  }

  /** Show a map's table (switching if it's another map) and fetch it fresh. */
  show(mapId: string): void {
    if (mapId !== this.mapId) {
      this.mapId = mapId;
      this.local = this.entries = loadLocal(mapId);
      this.lastRank = -1;
    }
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const mapId = this.mapId;
    this.loading = true;
    try {
      const entries = await fetchScores(mapId, MAX_SCORES);
      // Ignore answers for a map the player has already flipped past.
      if (mapId !== this.mapId) return;
      this.entries = entries;
      this.online = true;
    } catch {
      if (mapId !== this.mapId) return;
      this.entries = this.local;
      this.online = false;
    } finally {
      if (mapId === this.mapId) this.loading = false;
    }
  }

  /** Record a finished run on the map it was played on, and show that map's table. */
  async record(mapId: string, run: { round: number; kills: number; points: number }): Promise<void> {
    this.show(mapId);
    const entry: ScoreEntry = { ...run, date: Date.now() };
    const localRank = addLocal(mapId, this.local, entry);
    this.lastRank = this.online ? -1 : localRank;
    try {
      const saved = await submitScore({ mapId, ...run });
      if (!saved || mapId !== this.mapId) return;
      await this.refresh();
      if (this.online) this.lastRank = this.entries.findIndex((e) => e.id === saved.id);
    } catch {
      if (mapId !== this.mapId) return;
      this.entries = this.local;
      this.online = false;
      this.lastRank = localRank;
    }
  }
}
