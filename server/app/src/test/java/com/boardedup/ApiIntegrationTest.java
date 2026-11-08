package com.boardedup;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT, properties = "boarded-up.score-rate-limit=3")
@Testcontainers
class ApiIntegrationTest {
    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    int port;

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

    private String newPlayer(String name) throws Exception {
        Res r = call("POST", "/api/players", null, "{\"name\":\"" + name + "\"}");
        assertThat(r.status()).isEqualTo(201);
        return r.body().get("token").asString();
    }

    private Res submit(String token, String map, int round, int kills, int points) throws Exception {
        return call("POST", "/api/scores", token,
                "{\"mapId\":\"%s\",\"round\":%d,\"kills\":%d,\"points\":%d}".formatted(map, round, kills, points));
    }

    @Test
    void rejectsBadNames() throws Exception {
        assertThat(call("POST", "/api/players", null, "{\"name\":\"\"}").status()).isEqualTo(400);
        assertThat(call("POST", "/api/players", null, "{\"name\":\"  padded \"}").status()).isEqualTo(400);
        assertThat(call("POST", "/api/players", null, "{\"name\":\"<script>\"}").status()).isEqualTo(400);
        assertThat(call("POST", "/api/players", null, "{\"name\":\"" + "x".repeat(21) + "\"}").status()).isEqualTo(400);
    }

    @Test
    void scoresNeedAValidToken() throws Exception {
        assertThat(submit(null, "auth-test", 1, 1, 1).status()).isEqualTo(401);
        assertThat(submit("not-a-token", "auth-test", 1, 1, 1).status()).isEqualTo(401);
    }

    @Test
    void leaderboardOrdersByRoundThenKillsThenPoints() throws Exception {
        String a = newPlayer("Alice");
        String b = newPlayer("Bob");
        submit(a, "order-test", 5, 40, 3000);
        submit(b, "order-test", 7, 10, 100);
        submit(b, "order-test", 5, 40, 3500);
        submit(a, "other-map", 99, 0, 0);

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
        String t = newPlayer("Old Name");
        submit(t, "rename-test", 3, 3, 3);
        assertThat(call("PATCH", "/api/players/me", t, "{\"name\":\"New Name\"}").status()).isEqualTo(200);
        assertThat(call("GET", "/api/scores?map=rename-test", null, null).body().get(0).get("name").asString())
                .isEqualTo("New Name");
    }

    @Test
    void rateLimitsSubmissions() throws Exception {
        String t = newPlayer("Spammer");
        for (int i = 0; i < 3; i++) assertThat(submit(t, "rate-test", 1, i, 0).status()).isEqualTo(201);
        assertThat(submit(t, "rate-test", 1, 9, 0).status()).isEqualTo(429);
    }

    @Test
    void validatesSubmissions() throws Exception {
        String t = newPlayer("Validator");
        assertThat(submit(t, "Bad Map!", 1, 1, 1).status()).isEqualTo(400);
        assertThat(submit(t, "valid-map", -1, 1, 1).status()).isEqualTo(400);
    }
}
