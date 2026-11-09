package com.topdownsurvival.sim;

public final class Economy {
    public int points;
    public int earned;
    public int rebuildLeft;
    /** Set to 2 while Double Points is active. */
    public int multiplier = 1;
    private final int rebuildCap;

    public Economy(Defs defs) {
        this.points = defs.startingPoints;
        this.rebuildCap = defs.rebuildCap;
        this.rebuildLeft = rebuildCap;
    }

    /** Award gameplay points (affected by the multiplier). Returns the amount given. */
    public int award(int n) {
        int v = n * multiplier;
        points += v;
        earned += v;
        return v;
    }

    public boolean spend(int n) {
        if (points < n) return false;
        points -= n;
        return true;
    }

    public void resetRound() {
        rebuildLeft = rebuildCap;
    }
}
