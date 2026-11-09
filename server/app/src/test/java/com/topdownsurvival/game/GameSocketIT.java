package com.topdownsurvival.game;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Rooms over real sockets: the full server, Postgres in a container, and {@link BotClient}s. */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@Testcontainers
class GameSocketIT {
    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    int port;

    @Autowired
    LobbyService lobby;

    private final HttpClient http = HttpClient.newHttpClient();
    private final JsonMapper json = JsonMapper.builder().build();
    private final ScheduledExecutorService pool = Executors.newScheduledThreadPool(2);

    record Account(UUID id, String token) {}

    @AfterEach
    void stopBots() {
        pool.shutdownNow();
    }

    private JsonNode get(String path) throws Exception {
        var req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).build();
        return json.readTree(http.send(req, HttpResponse.BodyHandlers.ofString()).body());
    }

    private Account register(String name) throws Exception {
        var req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/players"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"name\":\"" + name + "\"}")).build();
        JsonNode body = json.readTree(http.send(req, HttpResponse.BodyHandlers.ofString()).body());
        return new Account(UUID.fromString(body.get("playerId").asString()), body.get("token").asString());
    }

    @Test
    void unknownTokensAreRefused() {
        assertThatThrownBy(() -> BotClient.connect(port, "not-a-token")).isInstanceOf(Exception.class);
    }

    @Test
    void twoPlayersPlayACoopGame() throws Exception {
        BotClient host = BotClient.connect(port, register("Host").token());
        BotClient guest = BotClient.connect(port, register("Guest").token());

        host.send(BotClient.msg("create").put("mapId", "house").put("solo", false));
        String code = host.await("welcome").get("room").get("code").asString();
        guest.send(BotClient.msg("join").put("code", code));
        assertThat(guest.await("welcome").get("map").get("id").asString()).isEqualTo("house");
        guest.send(BotClient.msg("ready").put("ready", true));
        host.await("lobby", m -> m.get("players").size() == 2 && m.get("players").get(1).get("ready").asBoolean(), Duration.ofSeconds(5));
        host.send(BotClient.msg("start"));
        host.await("start");
        guest.await("start");

        host.play(pool);
        guest.play(pool);
        JsonNode snap = host.await("snapshot", s -> s.get("tick").asLong() > 60, Duration.ofSeconds(10));
        assertThat(snap.get("players")).hasSize(2);
        assertThat(snap.get("acks").get(String.valueOf(host.playerId())).asInt()).isPositive();
        assertThat(snap.get("powerUps").has("double")).isTrue();
        JsonNode shot = guest.await("events", e -> e.get("events").toString().contains("\"type\":\"shot\""), Duration.ofSeconds(5));
        assertThat(shot.get("events").get(0).has("player")).isTrue();

        guest.send(BotClient.msg("ping").put("t", 123.5));
        assertThat(guest.await("pong").get("t").asDouble()).isEqualTo(123.5);

        guest.close();
        host.await("lobby", m -> m.get("players").size() == 2 && !m.get("players").get(1).get("connected").asBoolean(), Duration.ofSeconds(5));
        // The game goes on for the host while the guest is in the grace period.
        long before = host.all("snapshot").size();
        Thread.sleep(300);
        assertThat(host.all("snapshot").size()).isGreaterThan((int) before);
        host.close();
    }

    @Test
    void soloGameOverWritesAScore() throws Exception {
        Account acc = register("Soloist");
        BotClient bot = BotClient.connect(port, acc.token());
        bot.send(BotClient.msg("create").put("mapId", "house").put("solo", true));
        bot.await("start");
        lobby.roomOf(acc.id()).orElseThrow().withSim(sim -> {
            sim.players.getFirst().kills = 3;
            sim.damagePlayer(sim.players.getFirst(), 1e6);
        });

        JsonNode over = bot.await("gameOver");
        assertThat(over.get("players").get(0).get("kills").asInt()).isEqualTo(3);
        assertThat(over.get("players").get(0).get("rank").asInt()).isGreaterThanOrEqualTo(0);
        JsonNode table = get("/api/scores?map=house&limit=100");
        assertThat(table.findValuesAsString("name")).contains("Soloist");
        bot.close();
    }

    @Test
    void reconnectingResumesTheRoom() throws Exception {
        Account acc = register("Flaky");
        BotClient first = BotClient.connect(port, acc.token());
        first.send(BotClient.msg("create").put("mapId", "house").put("solo", true));
        String code = first.await("welcome").get("room").get("code").asString();
        first.await("start");
        first.close();

        BotClient again = BotClient.connect(port, acc.token());
        assertThat(again.await("welcome").get("room").get("code").asString()).isEqualTo(code);
        again.await("start");
        again.await("snapshot");
        again.send(BotClient.msg("leave"));
        for (int i = 0; i < 50 && lobby.room(code).isPresent(); i++) Thread.sleep(20);
        assertThat(lobby.room(code)).isEmpty();
        again.close();
    }

    @Test
    void badMessagesGetAnError() throws Exception {
        BotClient bot = BotClient.connect(port, register("Fumbler").token());
        bot.send("{\"type\":\"teleport\"}");
        assertThat(bot.await("error").get("message").asString()).startsWith("Bad message");
        bot.send(BotClient.msg("start"));
        assertThat(bot.await("error", e -> e.get("message").asString().equals("Not in a room"), Duration.ofSeconds(5))).isNotNull();
        bot.close();
    }
}
