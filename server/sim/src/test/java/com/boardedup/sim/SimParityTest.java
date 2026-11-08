package com.boardedup.sim;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * Replays the reference run recorded from the TS sim (client/scripts/parity.ts) and checks the
 * Java sim produces the same states. If this fails after a gameplay change, either the change
 * wasn't made in both sims, or the reference needs regenerating with {@code npm run parity}.
 */
class SimParityTest {
    private static final double DT = 1.0 / 60;
    private static final long SEED = 42;
    private static final int TICKS = 60 * 120;
    private static final int EVERY = 300;

    @Test
    void javaSimMatchesTheTypeScriptSim() throws IOException {
        List<String> expected;
        try (InputStream in = getClass().getResourceAsStream("/parity.txt")) {
            expected = new String(in.readAllBytes(), StandardCharsets.UTF_8).lines().filter(l -> !l.startsWith("#")).toList();
        }
        List<String> actual = new ArrayList<>();
        for (String map : List.of("house", "cabin")) {
            GameSim s = GameSimTest.solo(map, SEED);
            for (int i = 0; i < TICKS && !s.over; i++) {
                s.step(DT, GameSimTest.bot(s));
                s.events.clear();
                if (i % EVERY == 0) actual.add(map + " " + i + " " + line(s));
            }
            actual.add(map + " end " + line(s));
        }
        // Line by line, so a failure points at the first state that drifted.
        for (int i = 0; i < Math.min(expected.size(), actual.size()); i++) {
            assertThat(actual.get(i)).as("state %d", i).isEqualTo(expected.get(i));
        }
        assertThat(actual).hasSameSizeAs(expected);
    }

    /** Must match the format in client/scripts/parity.ts. */
    private static String line(GameSim s) {
        Player p = s.players.getFirst();
        return "r%d k%d p%d hp%.6f x%.6f y%.6f z=%s".formatted(s.rounds.round, s.kills, p.economy.points, p.hp, p.x, p.y,
                s.zombies.stream().map(z -> "%d:%.6f,%.6f,%.3f".formatted(z.id, z.x, z.y, z.hp)).collect(Collectors.joining(";")));
    }
}
