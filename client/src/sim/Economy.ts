import { REBUILD_CAP, STARTING_POINTS } from './defs';

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
