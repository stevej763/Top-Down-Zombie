package com.topdownsurvival.sim;

import java.util.List;

/**
 * Seeded PRNG (mulberry32). Ported from the retired TS sim; Java int multiplication wraps like
 * Math.imul, so a seed still gives the sequence {@code RngTest} pins.
 */
public final class Rng {
    private int s;

    public Rng(long seed) {
        this.s = (int) seed;
    }

    /** Uniform in [0, 1). */
    public double next() {
        s += 0x6d2b79f5;
        int t = s;
        t = (t ^ (t >>> 15)) * (t | 1);
        t ^= t + (t ^ (t >>> 7)) * (t | 61);
        return ((t ^ (t >>> 14)) & 0xffffffffL) / 4294967296.0;
    }

    public double range(double lo, double hi) {
        return lo + next() * (hi - lo);
    }

    /** Integer in [lo, hi], inclusive. */
    public int nextInt(int lo, int hi) {
        return (int) Math.floor(range(lo, hi + 1));
    }

    public <T> T pick(List<T> items) {
        return items.get((int) Math.floor(next() * items.size()));
    }
}
