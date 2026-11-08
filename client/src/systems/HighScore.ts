import { fetchScores, type ServerScore } from '../net/api';

export const MAX_SCORES = 10;

/**
 * The high-score table shown in the menus, for one map at a time (`mapId`). Scores are written
 * by the server at game over, so this only reads its leaderboard.
 */
export class Leaderboard {
  entries: ServerScore[] = [];
  online = false;
  loading = false;
  /** 0-based position of your last finished run on this map, or -1 if it didn't place. */
  lastRank = -1;

  constructor(public mapId: string) {}

  /** Show a map's table (switching if it's another map) and fetch it fresh. */
  show(mapId: string): void {
    if (mapId !== this.mapId) {
      this.mapId = mapId;
      this.entries = [];
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
      this.online = false;
    } finally {
      if (mapId === this.mapId) this.loading = false;
    }
  }
}
