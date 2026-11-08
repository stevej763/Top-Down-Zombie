export const STARTING_POINTS = 500;
/** Max points from rebuilding barricades per round, so it can't be farmed. */
export const REBUILD_CAP = 500;

export const POINTS = {
  hit: 10,
  kill: 60,
  headshotKill: 100,
  knifeKill: 130,
  plank: 10,
  nuke: 400,
} as const;

export class Economy {
  points = STARTING_POINTS;
  earned = 0;
  rebuildLeft = REBUILD_CAP;
  /** Set to 2 while Double Points is active. */
  multiplier = 1;

  /** Award gameplay points (affected by the multiplier). Returns the amount given. */
  award(n: number): number {
    const v = n * this.multiplier;
    this.points += v;
    this.earned += v;
    return v;
  }

  spend(n: number): boolean {
    if (this.points < n) return false;
    this.points -= n;
    return true;
  }

  resetRound(): void {
    this.rebuildLeft = REBUILD_CAP;
  }
}
