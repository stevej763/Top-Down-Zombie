package com.topdownsurvival.sim;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class RngTest {
    /** First values the retired TS Rng.ts produced for these seeds: SimParityTest depends on them. */
    @Test
    void pinnedSequence() {
        assertSequence(1, 0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849);
        assertSequence(42, 0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693, 0.17481389874592423);
        assertSequence(4294967295L, 0.8964226141106337, 0.189478256739676, 0.7156526781618595, 0.9440599093213677, 0.8452364315744489);
    }

    private static void assertSequence(long seed, double... expected) {
        Rng r = new Rng(seed);
        for (double e : expected) assertThat(r.next()).isEqualTo(e);
    }

    @Test
    void nextIntIsInclusive() {
        Rng r = new Rng(7);
        boolean sawLo = false, sawHi = false;
        for (int i = 0; i < 1000; i++) {
            int n = r.nextInt(2, 4);
            assertThat(n).isBetween(2, 4);
            sawLo |= n == 2;
            sawHi |= n == 4;
        }
        assertThat(sawLo && sawHi).isTrue();
    }
}
