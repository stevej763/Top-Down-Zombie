const KEY = 'boarded-up-best';

export interface Best {
  round: number;
  kills: number;
}

export function loadBest(): Best {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Best;
  } catch {
    // Storage unavailable (private mode etc.) — fall through.
  }
  return { round: 0, kills: 0 };
}

export function saveBest(best: Best): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(best));
  } catch {
    // Ignore.
  }
}
