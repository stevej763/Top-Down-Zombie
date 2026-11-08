package com.boardedup.game;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Not a regular test: 10 rooms of 4 bots for 20 s, printing snapshot rates. Run it with
 * {@code LOAD_TRIAL=1} in the environment.
 */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@Testcontainers
@EnabledIfEnvironmentVariable(named = "LOAD_TRIAL", matches = "1")
class LoadTrialIT {
    private static final int ROOMS = 10;
    private static final int PER_ROOM = 4;
    private static final Duration RUN = Duration.ofSeconds(20);

    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    int port;

    @Test
    void tenRoomsOfFourBots() throws Exception {
        HttpClient http = HttpClient.newHttpClient();
        JsonMapper json = JsonMapper.builder().build();
        ScheduledExecutorService pool = Executors.newScheduledThreadPool(4);
        List<BotClient> bots = new ArrayList<>();
        for (int r = 0; r < ROOMS; r++) {
            List<BotClient> room = new ArrayList<>();
            for (int i = 0; i < PER_ROOM; i++) {
                var req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/players"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("{\"name\":\"Bot " + r + "-" + i + "\"}")).build();
                String token = json.readTree(http.send(req, HttpResponse.BodyHandlers.ofString()).body()).get("token").asString();
                room.add(BotClient.connect(port, token));
            }
            room.getFirst().send(BotClient.msg("create").put("mapId", "house").put("solo", false));
            String code = room.getFirst().await("welcome").get("room").get("code").asString();
            for (BotClient b : room.subList(1, PER_ROOM)) {
                b.send(BotClient.msg("join").put("code", code));
                b.await("welcome");
                b.send(BotClient.msg("ready").put("ready", true));
            }
            room.getFirst().await("lobby", m -> m.get("players").size() == PER_ROOM
                    && m.get("players").valueStream().skip(1).allMatch(p -> p.get("ready").asBoolean()), Duration.ofSeconds(5));
            room.getFirst().send(BotClient.msg("start"));
            bots.addAll(room);
        }
        for (BotClient b : bots) b.await("start");
        long t0 = System.nanoTime();
        for (BotClient b : bots) b.play(pool);
        Thread.sleep(RUN.toMillis());
        double secs = (System.nanoTime() - t0) / 1e9;
        for (BotClient b : bots) b.stop();

        double minRate = Double.POSITIVE_INFINITY;
        double sumRate = 0;
        long maxTickGap = 0;
        int rounds = 0;
        for (BotClient b : bots) {
            List<JsonNode> snaps = b.all("snapshot");
            minRate = Math.min(minRate, snaps.size() / secs);
            sumRate += snaps.size() / secs;
            for (int i = 1; i < snaps.size(); i++) {
                maxTickGap = Math.max(maxTickGap, snaps.get(i).get("tick").asLong() - snaps.get(i - 1).get("tick").asLong());
            }
            if (!snaps.isEmpty()) rounds = Math.max(rounds, snaps.getLast().get("round").get("n").asInt());
        }
        System.out.printf("Load trial: %d rooms x %d bots for %.1f s: snapshots/s per bot mean %.1f, min %.1f (target 20); "
                + "largest tick gap between snapshots %d (3 = none missed); highest round %d%n",
                ROOMS, PER_ROOM, secs, sumRate / bots.size(), minRate, maxTickGap, rounds);
        for (BotClient b : bots) b.close();
        pool.shutdownNow();
    }
}
