package com.boardedup;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import com.boardedup.player.PlayerRepository;
import com.boardedup.score.Score;
import com.boardedup.score.ScoreRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
@Testcontainers
class ApiIntegrationTest {
    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    int port;

    @Autowired
    ScoreRepository scores;

    @Autowired
    PlayerRepository players;

    private final HttpClient http = HttpClient.newHttpClient();
    private final JsonMapper json = JsonMapper.builder().build();

    record Res(int status, JsonNode body) {}

    private Res call(String method, String path, String token, String body) throws Exception {
        var req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        if (token != null) req.header("Authorization", "Bearer " + token);
        HttpResponse<String> res = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
        return new Res(res.statusCode(), res.body().isEmpty() ? null : json.readTree(res.body()));
    }

    record NewPlayer(UUID id, String token) {}

    private NewPlayer newPlayer(String name) throws Exception {
        Res r = call("POST", "/api/players", null, "{\"name\":\"" + name + "\"}");
        assertThat(r.status()).isEqualTo(201);
        return new NewPlayer(UUID.fromString(r.body().get("playerId").asString()), r.body().get("token").asString());
    }

    /** Scores are written by game rooms now, so tests store them directly. */
    private void score(NewPlayer p, String map, int round, int kills, int points) {
        scores.save(new Score(players.getReferenceById(p.id()), map, round, kills, points, 1));
    }

    @Test
    void rejectsBadNames() throws Exception {
        assertThat(call("POST", "/api/players", null, "{\"name\":\"\"}").status()).isEqualTo(400);
        assertThat(call("POST", "/api/players", null, "{\"name\":\"  padded \"}").status()).isEqualTo(400);
        assertThat(call("POST", "/api/players", null, "{\"name\":\"<script>\"}").status()).isEqualTo(400);
        assertThat(call("POST", "/api/players", null, "{\"name\":\"" + "x".repeat(21) + "\"}").status()).isEqualTo(400);
    }

    @Test
    void scoresCantBeSubmitted() throws Exception {
        String t = newPlayer("Cheater").token();
        var r = call("POST", "/api/scores", t, "{\"mapId\":\"house\",\"round\":99,\"kills\":1,\"points\":1}");
        assertThat(r.status()).isEqualTo(405);
    }

    @Test
    void leaderboardOrdersByRoundThenKillsThenPoints() throws Exception {
        NewPlayer a = newPlayer("Alice");
        NewPlayer b = newPlayer("Bob");
        score(a, "order-test", 5, 40, 3000);
        score(b, "order-test", 7, 10, 100);
        score(b, "order-test", 5, 40, 3500);
        score(a, "other-map", 99, 0, 0);

        Res r = call("GET", "/api/scores?map=order-test", null, null);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.body()).hasSize(3);
        assertThat(r.body().get(0).get("round").asInt()).isEqualTo(7);
        assertThat(r.body().get(1).get("points").asInt()).isEqualTo(3500);
        assertThat(r.body().get(1).get("name").asString()).isEqualTo("Bob");
        assertThat(r.body().get(2).get("name").asString()).isEqualTo("Alice");
    }

    @Test
    void renameShowsOnTheLeaderboard() throws Exception {
        NewPlayer p = newPlayer("Old Name");
        score(p, "rename-test", 3, 3, 3);
        assertThat(call("PATCH", "/api/players/me", p.token(), "{\"name\":\"New Name\"}").status()).isEqualTo(200);
        assertThat(call("GET", "/api/scores?map=rename-test", null, null).body().get(0).get("name").asString())
                .isEqualTo("New Name");
    }

    @Test
    void renameNeedsAValidToken() throws Exception {
        assertThat(call("PATCH", "/api/players/me", null, "{\"name\":\"Nobody\"}").status()).isEqualTo(401);
        assertThat(call("PATCH", "/api/players/me", "not-a-token", "{\"name\":\"Nobody\"}").status()).isEqualTo(401);
    }

    @Test
    void rejectsBadMapIds() throws Exception {
        assertThat(call("GET", "/api/scores?map=Bad%20Map!", null, null).status()).isEqualTo(400);
    }
}
