package com.boardedup.sim;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * A regression baseline: replays a recorded bot run (seed 42, two minutes per map) and requires the
 * same states to 6 decimals. parity.txt was recorded from the TypeScript sim, which the Java sim
 * matched exactly; the TS sim is gone, so it is now frozen. A failure names the first state that
 * drifted. If gameplay changed on purpose, regenerate it from Java with
 * {@code REGENERATE_PARITY=1 ./gradlew :sim:test --tests SimParityTest} and review the diff.
 */
class SimParityTest {
    private static final double DT = 1.0 / 60;
    private static final long SEED = 42;
    private static final int TICKS = 60 * 120;
    private static final int EVERY = 300;

    @Test
    void matchesTheRecordedRun() throws IOException {
        List<String> expected;
        try (InputStream in = getClass().getResourceAsStream("/parity.txt")) {
            expected = new String(in.readAllBytes(), StandardCharsets.UTF_8).lines().filter(l -> !l.startsWith("#")).toList();
        }
        List<String> actual = new ArrayList<>();
        for (String map : List.of("house", "farmstead")) {
            GameSim s = GameSimTest.solo(map, SEED);
            for (int i = 0; i < TICKS && !s.over; i++) {
                s.step(DT, GameSimTest.bot(s));
                s.events.clear();
                if (i % EVERY == 0) actual.add(map + " " + i + " " + line(s));
            }
            actual.add(map + " end " + line(s));
        }
        if (System.getenv("REGENERATE_PARITY") != null) {
            // Gradle runs tests from the project dir (server/sim).
            Files.writeString(Path.of("src/test/resources/parity.txt"),
                    "# Recorded by SimParityTest (REGENERATE_PARITY=1). seed=" + SEED + "\n" + String.join("\n", actual) + "\n");
            return;
        }
        // Line by line, so a failure points at the first state that drifted.
        for (int i = 0; i < Math.min(expected.size(), actual.size()); i++) {
            assertThat(actual.get(i)).as("state %d", i).isEqualTo(expected.get(i));
        }
        assertThat(actual).hasSameSizeAs(expected);
    }

    private static String line(GameSim s) {
        Player p = s.players.getFirst();
        return "r%d k%d p%d hp%.6f x%.6f y%.6f z=%s".formatted(s.rounds.round, s.kills, p.economy.points, p.hp, p.x, p.y,
                s.zombies.stream().map(z -> "%d:%.6f,%.6f,%.3f".formatted(z.id, z.x, z.y, z.hp)).collect(Collectors.joining(";")));
    }
}
