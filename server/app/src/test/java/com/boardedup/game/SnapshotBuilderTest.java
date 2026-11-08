package com.boardedup.game;

import static org.assertj.core.api.Assertions.assertThat;

import com.boardedup.game.protocol.ServerMessage;
import com.boardedup.sim.GameSim;
import com.boardedup.sim.Player;
import com.boardedup.sim.PlayerInput;
import com.boardedup.sim.Zombie;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectWriter;
import tools.jackson.databind.json.JsonMapper;

class SnapshotBuilderTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final ObjectWriter WRITER = JSON.writerFor(ServerMessage.class);

    /** Aims at the nearest zombie without firing, so they pile up. */
    private static PlayerInput aimer(GameSim s, Player p) {
        double aim = 0;
        double best = Double.POSITIVE_INFINITY;
        for (Zombie z : s.zombies) {
            double d = Math.hypot(z.x - p.x, z.y - p.y);
            if (d < best) {
                best = d;
                aim = Math.atan2(z.y - p.y, z.x - p.x);
            }
        }
        return PlayerInput.builder().aim(aim).build();
    }

    @Test
    void serializesWithTheProtocolNames() {
        GameSim sim = new GameSim(FakeConnection.map("house"), 1);
        sim.addPlayer(1, "A");
        sim.addPlayer(2, "B");
        JsonNode j = JSON.readTree(WRITER.writeValueAsString(SnapshotBuilder.build(sim, 3, Map.of(1, 9))));

        assertThat(j.get("type").asString()).isEqualTo("snapshot");
        assertThat(j.get("acks").get("1").asInt()).isEqualTo(9);
        assertThat(j.get("powerUps").has("double")).isTrue();
        JsonNode p = j.get("players").get(0);
        assertThat(p.get("state").asString()).isEqualTo("alive");
        assertThat(p.get("weapons")).hasSize(2);
        assertThat(p.get("weapons").get(1).isNull()).isTrue();
        assertThat(p.get("weapons").get(0).get("id").asString()).isEqualTo(sim.defs.starterWeapon);
        // Doors carry open, the box its state, the rest nothing.
        assertThat(j.get("interactables").findValues("open")).isNotEmpty();
        assertThat(j.get("interactables").findValuesAsString("state")).containsExactly("closed");
        assertThat(j.get("interactables").get(0).isEmpty()).isTrue();
    }

    @Test
    void interactionsPointIntoTheMapLists() {
        GameSim sim = new GameSim(FakeConnection.map("house"), 1);
        Player p = sim.addPlayer(1, "A");
        var window = sim.barricades.get(2);
        window.planks = 0;
        p.x = window.insidePoint.x();
        p.y = window.insidePoint.y();
        sim.step(GameRoom.DT, PlayerInput.NONE);
        var view = SnapshotBuilder.build(sim, 1, Map.of()).players().getFirst().interaction();
        assertThat(view.kind()).isEqualTo("rebuild");
        assertThat(view.window()).isEqualTo(2);
    }

    /** The plan expected 2–4 KB at full load; this logs the real figure. Full load: 4 players, zombies at the cap. */
    @Test
    void fourPlayerSnapshotsStaySmall() {
        GameSim sim = new GameSim(FakeConnection.map("house"), 7);
        for (int id = 1; id <= 4; id++) sim.addPlayer(id, "Player " + id);
        // A late round, so the count is past the cap, and nobody fights back or dies.
        sim.rounds.round = 9;
        int max = 0;
        long total = 0;
        int count = 0;
        int maxZombies = 0;
        for (int tick = 1; tick <= 60 * 90; tick++) {
            Map<Integer, PlayerInput> inputs = new HashMap<>();
            for (Player p : sim.players) {
                p.invuln = 1e9;
                inputs.put(p.id, aimer(sim, p));
            }
            sim.step(GameRoom.DT, inputs);
            sim.events.clear();
            if (tick % GameRoom.SNAPSHOT_EVERY != 0) continue;
            int size = WRITER.writeValueAsString(SnapshotBuilder.build(sim, tick, Map.of(1, tick, 2, tick, 3, tick, 4, tick))).length();
            max = Math.max(max, size);
            total += size;
            count++;
            maxZombies = Math.max(maxZombies, sim.zombies.size());
        }
        System.out.printf("Snapshot size, 4 players: mean %d B, max %d B with %d zombies; at most %.0f KB/s per client at 20 Hz%n",
                total / count, max, maxZombies, max * 20 / 1024.0);
        assertThat(maxZombies).isEqualTo(com.boardedup.sim.RoundManager.maxAlive(4));
        assertThat(max).isLessThan(16 * 1024);
    }
}
