package com.topdownsurvival;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import com.topdownsurvival.player.PlayerRepository;
import com.topdownsurvival.score.Score;
import com.topdownsurvival.score.ScoreRepository;
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
        scores.save(new Score(players.getReferenceById(p.id()), null, map, round, kills, points, 1));
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

    private static String account(String email, String username, String password) {
        return "{\"email\":\"" + email + "\",\"username\":\"" + username + "\",\"password\":\"" + password + "\"}";
    }

    private static String creds(String email, String password) {
        return "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}";
    }

    @Test
    void aGuestBecomesAnAccountAndKeepsTheirScores() throws Exception {
        NewPlayer g = newPlayer("Upgrader");
        score(g, "upgrade-test", 4, 4, 4);
        assertThat(call("GET", "/api/scores?map=upgrade-test", null, null).body().get(0).get("guest").asBoolean()).isTrue();
        assertThat(call("GET", "/api/players/me", g.token(), null).body().get("account").asBoolean()).isFalse();

        Res r = call("POST", "/api/players/register", g.token(), account("Up@Example.com", "Upgraded", "password1"));
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.body().get("playerId").asString()).isEqualTo(g.id().toString());
        assertThat(r.body().get("token").asString()).isEqualTo(g.token());

        Res me = call("GET", "/api/players/me", g.token(), null);
        assertThat(me.body().get("account").asBoolean()).isTrue();
        assertThat(me.body().get("email").asString()).isEqualTo("up@example.com");
        JsonNode row = call("GET", "/api/scores?map=upgrade-test", null, null).body().get(0);
        assertThat(row.get("name").asString()).isEqualTo("Upgraded");
        assertThat(row.get("guest").asBoolean()).isFalse();
        // Already an account.
        assertThat(call("POST", "/api/players/register", g.token(), account("other@example.com", "Other", "password1")).status())
                .isEqualTo(409);
    }

    @Test
    void emailsAndAccountNamesAreUnique() throws Exception {
        assertThat(call("POST", "/api/players/register", null, account("taken@example.com", "Taken", "password1")).status()).isEqualTo(201);
        Res dupEmail = call("POST", "/api/players/register", null, account("TAKEN@example.com", "Fresh", "password1"));
        assertThat(dupEmail.status()).isEqualTo(409);
        assertThat(dupEmail.body().get("message").asString()).contains("email");
        assertThat(call("POST", "/api/players/register", null, account("fresh@example.com", "taken", "password1")).status()).isEqualTo(409);
        // Guests can't take an account's name, but may share names with each other.
        assertThat(call("POST", "/api/players", null, "{\"name\":\"TAKEN\"}").status()).isEqualTo(409);
        NewPlayer g = newPlayer("Twin");
        newPlayer("Twin");
        assertThat(call("PATCH", "/api/players/me", g.token(), "{\"name\":\"Taken\"}").status()).isEqualTo(409);
    }

    @Test
    void registrationChecksItsFields() throws Exception {
        Res r = call("POST", "/api/players/register", null, account("not-an-email", "Checker", "password1"));
        assertThat(r.status()).isEqualTo(400);
        assertThat(r.body().get("message").asString()).contains("email");
        assertThat(call("POST", "/api/players/register", null, account("short@example.com", "Checker", "short")).status()).isEqualTo(400);
        assertThat(call("POST", "/api/players/register", null, account("long@example.com", "Checker", "x".repeat(73))).status()).isEqualTo(400);
        assertThat(call("POST", "/api/players/register", null, account("name@example.com", "<bad>", "password1")).status()).isEqualTo(400);
    }

    @Test
    void loginGivesEachDeviceItsOwnToken() throws Exception {
        String first = call("POST", "/api/players/register", null, account("devices@example.com", "Devices", "password1"))
                .body().get("token").asString();
        Res wrong = call("POST", "/api/players/login", null, creds("devices@example.com", "nope"));
        assertThat(wrong.status()).isEqualTo(401);
        Res ok = call("POST", "/api/players/login", null, creds(" Devices@example.com ", "password1"));
        assertThat(ok.status()).isEqualTo(200);
        assertThat(ok.body().get("name").asString()).isEqualTo("Devices");
        String second = ok.body().get("token").asString();
        assertThat(second).isNotEqualTo(first);

        assertThat(call("GET", "/api/players/me", first, null).status()).isEqualTo(200);
        assertThat(call("POST", "/api/players/logout", second, null).status()).isEqualTo(204);
        assertThat(call("GET", "/api/players/me", second, null).status()).isEqualTo(401);
        assertThat(call("GET", "/api/players/me", first, null).status()).isEqualTo(200);
    }

    @Test
    void changingThePasswordSignsOutOtherDevices() throws Exception {
        String here = call("POST", "/api/players/register", null, account("pw@example.com", "Rotator", "password1")).body().get("token").asString();
        String there = call("POST", "/api/players/login", null, creds("pw@example.com", "password1")).body().get("token").asString();
        assertThat(call("PATCH", "/api/players/me/password", here, "{\"current\":\"wrong\",\"password\":\"password2\"}").status())
                .isEqualTo(403);
        assertThat(call("PATCH", "/api/players/me/password", here, "{\"current\":\"password1\",\"password\":\"password2\"}").status())
                .isEqualTo(204);
        assertThat(call("GET", "/api/players/me", here, null).status()).isEqualTo(200);
        assertThat(call("GET", "/api/players/me", there, null).status()).isEqualTo(401);
        assertThat(call("POST", "/api/players/login", null, creds("pw@example.com", "password1")).status()).isEqualTo(401);
        assertThat(call("POST", "/api/players/login", null, creds("pw@example.com", "password2")).status()).isEqualTo(200);
    }

    @Test
    void repeatedFailedLoginsAreThrottled() throws Exception {
        call("POST", "/api/players/register", null, account("throttle@example.com", "Throttled", "password1"));
        for (int i = 0; i < 6; i++) call("POST", "/api/players/login", null, creds("throttle@example.com", "wrong"));
        assertThat(call("POST", "/api/players/login", null, creds("throttle@example.com", "password1")).status()).isEqualTo(429);
    }

    @Test
    void theMapListSaysWhichMapsGuestsMayPlay() throws Exception {
        JsonNode maps = call("GET", "/api/maps", null, null).body();
        for (JsonNode m : maps) assertThat(m.get("guest").asBoolean()).isEqualTo(m.get("id").asString().equals("house"));
    }

    @Test
    void rejectsBadMapIds() throws Exception {
        assertThat(call("GET", "/api/scores?map=Bad%20Map!", null, null).status()).isEqualTo(400);
    }
}
