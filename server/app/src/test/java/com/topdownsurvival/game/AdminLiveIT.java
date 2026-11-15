package com.topdownsurvival.game;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;
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

/** The admin portal's live view, spectating over {@code /ws/watch}, and the history a game leaves. */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT,
        properties = {"top-down-survival.admin.username=root", "top-down-survival.admin.password=root-password"})
@Testcontainers
class AdminLiveIT {
    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    int port;

    @Autowired
    LobbyService lobby;

    private final HttpClient http = HttpClient.newHttpClient();
    private final JsonMapper json = JsonMapper.builder().build();

    private HttpResponse<String> send(String method, String path, String cookie, String body) throws Exception {
        var req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json").header("X-Requested-With", "admin")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        if (cookie != null) req.header("Cookie", cookie);
        return http.send(req.build(), HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode get(String path, String cookie) throws Exception {
        return json.readTree(send("GET", path, cookie, null).body());
    }

    private String login() throws Exception {
        var res = send("POST", "/api/admin/login", null, "{\"username\":\"root\",\"password\":\"root-password\"}");
        assertThat(res.statusCode()).isEqualTo(200);
        return res.headers().firstValue("Set-Cookie").orElseThrow().split(";")[0];
    }

    @Test
    void liveGamesAreListedWatchedAndThenRecorded() throws Exception {
        String root = login();
        JsonNode p = json.readTree(send("POST", "/api/players", null, "{\"name\":\"Watched\"}").body());
        UUID id = UUID.fromString(p.get("playerId").asString());
        BotClient bot = BotClient.connect(port, p.get("token").asString());
        bot.send(BotClient.msg("create").put("mapId", "house").put("solo", true));
        String code = bot.await("welcome").get("room").get("code").asString();
        bot.await("start");

        JsonNode room = null;
        for (JsonNode r : get("/api/admin/live", root)) if (r.get("code").asString().equals(code)) room = r;
        assertThat(room).isNotNull();
        assertThat(room.get("state").asString()).isEqualTo("playing");
        assertThat(room.get("members").get(0).get("name").asString()).isEqualTo("Watched");
        String gameId = room.get("gameId").asString();
        assertThat(get("/api/admin/overview", root).get("playing").asInt()).isPositive();

        // Watching needs the admin cookie and the same origin.
        assertThatThrownBy(() -> BotClient.watch(port, code, null, null)).isInstanceOf(Exception.class);
        assertThatThrownBy(() -> BotClient.watch(port, code, root, "http://evil.example")).isInstanceOf(Exception.class);
        BotClient admin = BotClient.watch(port, code, root, null);
        assertThat(admin.await("watch").get("map").get("id").asString()).isEqualTo("house");
        assertThat(admin.await("snapshot").get("players")).hasSize(1);
        assertThat(get("/api/admin/live", root).toString()).contains("\"spectators\":1");
        // The player is told nothing.
        Thread.sleep(200);
        assertThat(bot.all("lobby")).allMatch(l -> l.get("players").size() == 1);

        assertThat(get("/api/admin/games?reason=running", root).findValuesAsString("id")).contains(gameId);

        lobby.roomOf(id).orElseThrow().withSim(sim -> {
            sim.players.getFirst().kills = 9;
            sim.damagePlayer(sim.players.getFirst(), 1e6);
        });
        bot.await("gameOver");
        admin.await("gameOver");

        JsonNode game = null;
        for (int i = 0; i < 50; i++) {
            game = get("/api/admin/games/" + gameId, root);
            if (!game.get("game").get("endReason").isNull()) break;
            Thread.sleep(50);
        }
        assertThat(game.get("game").get("endReason").asString()).isEqualTo("over");
        assertThat(game.get("players").get(0).get("kills").asInt()).isEqualTo(9);
        assertThat(game.get("players").get(0).get("rank").isNull()).isFalse();

        JsonNode detail = get("/api/admin/players/" + id, root);
        assertThat(detail.get("player").get("games").asInt()).isEqualTo(1);
        assertThat(detail.get("games").get(0).get("gameId").asString()).isEqualTo(gameId);
        assertThat(get("/api/admin/games?player=" + id, root)).hasSize(1);

        admin.close();
        bot.close();
    }

    @Test
    void watchingAMissingRoomIsAnError() throws Exception {
        BotClient admin = BotClient.watch(port, "ZZZZ", login(), null);
        assertThat(admin.await("error").get("message").asString()).isEqualTo("No room ZZZZ");
        admin.close();
    }
}
