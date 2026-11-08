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
}

function compare(a: ScoreEntry, b: ScoreEntry): number {
  return b.round - a.round || b.kills - a.kills || b.points - a.points;
}

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return (JSON.parse(raw) as ScoreEntry[]).sort(compare).slice(0, MAX_SCORES);
    const legacy = localStorage.getItem(LEGACY_KEY);
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
export function addScore(scores: ScoreEntry[], entry: ScoreEntry): number {
  scores.push(entry);
  scores.sort(compare);
  scores.length = Math.min(scores.length, MAX_SCORES);
  try {
    localStorage.setItem(KEY, JSON.stringify(scores));
  } catch {
    // Ignore.
  }
  return scores.indexOf(entry);
}
