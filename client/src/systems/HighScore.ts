import { fetchScores, type ServerScore } from '../net/api';

export const MAX_SCORES = 10;

/**
 * The high-score tables shown in the menus, one map at a time (`mapId`). Scores are written
 * by the server at game over, so this only reads its leaderboard. Each map's last answer is
 * kept, so flipping between maps shows it at once while a fresh copy is fetched.
 */
export class Leaderboard {
  online = false;
  private tables = new Map<string, ServerScore[]>();
  /** Latest request number per map still waiting for its answer. */
  private pending = new Map<string, number>();
  private requests = 0;
  private rank = { mapId: '', rank: -1 };

  constructor(public mapId: string) {}

  get entries(): ServerScore[] {
    return this.tables.get(this.mapId) ?? [];
  }

  /** Whether the current map's table has arrived at least once. */
  get loaded(): boolean {
    return this.tables.has(this.mapId);
  }

  get loading(): boolean {
    return this.pending.has(this.mapId);
  }

  /** 0-based position of your last finished run on the current map, or -1 if it didn't place. */
  get lastRank(): number {
    return this.rank.mapId === this.mapId ? this.rank.rank : -1;
  }

  recordRank(mapId: string, rank: number): void {
    this.rank = { mapId, rank };
  }

  /** Show a map's table (switching if it's another map) and fetch it fresh. */
  show(mapId: string): void {
    this.mapId = mapId;
    void this.refresh();
  }

  /** Fetch several maps' tables, so flipping to them doesn't wait. */
  prefetch(mapIds: string[]): void {
    for (const id of mapIds) void this.refresh(id);
  }

  async refresh(mapId = this.mapId): Promise<void> {
    const n = ++this.requests;
    this.pending.set(mapId, n);
    // Only the newest request per map counts, so an older answer can't overwrite one that
    // already includes the run that just ended.
    try {
      const entries = await fetchScores(mapId, MAX_SCORES);
      if (this.pending.get(mapId) !== n) return;
      this.tables.set(mapId, entries);
      this.online = true;
    } catch {
      if (this.pending.get(mapId) !== n) return;
      this.online = false;
    } finally {
      if (this.pending.get(mapId) === n) this.pending.delete(mapId);
    }
  }
}
