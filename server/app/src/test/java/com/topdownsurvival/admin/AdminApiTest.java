package com.topdownsurvival.admin;

import static org.assertj.core.api.Assertions.assertThat;

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
import org.springframework.jdbc.core.simple.JdbcClient;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** The admin portal's API: login, sessions, accounts and the heartbeat. Live rooms and history: {@code AdminLiveIT}. */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT,
        properties = {"top-down-survival.admin.username=Root", "top-down-survival.admin.password=root-password"})
@Testcontainers
class AdminApiTest {
    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    int port;

    @Autowired
    JdbcClient db;

    private final HttpClient http = HttpClient.newHttpClient();
    private final JsonMapper json = JsonMapper.builder().build();

    record Res(int status, JsonNode body, String setCookie) {}

    private Res call(String method, String path, String cookie, String body, boolean csrf, String bearer) throws Exception {
        var req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        if (csrf) req.header("X-Requested-With", "admin");
        if (cookie != null) req.header("Cookie", cookie);
        if (bearer != null) req.header("Authorization", "Bearer " + bearer);
        HttpResponse<String> res = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
        return new Res(res.statusCode(), res.body().isEmpty() ? null : json.readTree(res.body()),
                res.headers().firstValue("Set-Cookie").orElse(null));
    }

    private Res get(String path, String cookie) throws Exception {
        return call("GET", path, cookie, null, false, null);
    }

    private Res post(String path, String cookie, String body) throws Exception {
        return call("POST", path, cookie, body, true, null);
    }

    private static String creds(String user, String pass) {
        return "{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}";
    }

    /** Logs in and returns the Cookie header to send. */
    private String login(String user, String pass) throws Exception {
        Res r = post("/api/admin/login", null, creds(user, pass));
        assertThat(r.status()).as("login %s", user).isEqualTo(200);
        assertThat(r.setCookie()).contains("HttpOnly").contains("SameSite=Strict");
        return r.setCookie().split(";")[0];
    }

    private JsonNode register(String name) throws Exception {
        return call("POST", "/api/players", null, "{\"name\":\"" + name + "\"}", false, null).body();
    }

    @Test
    void everythingNeedsASession() throws Exception {
        for (String path : new String[] {"/api/admin/me", "/api/admin/overview", "/api/admin/live", "/api/admin/games",
                "/api/admin/players", "/api/admin/maps", "/api/admin/admins"}) {
            assertThat(get(path, null).status()).as(path).isEqualTo(401);
            assertThat(get(path, "tds_admin=forged").status()).as(path).isEqualTo(401);
        }
    }

    @Test
    void mapsAreListedWithTheirStats() throws Exception {
        JsonNode maps = get("/api/admin/maps", login("root", "root-password")).body();
        assertThat(maps.findValuesAsString("id")).contains("house", "farmstead");
        for (JsonNode m : maps) {
            assertThat(m.get("width").asInt()).as(m.get("id").asString()).isPositive();
            assertThat(m.get("version").asInt()).isPositive();
        }
    }

    @Test
    void theFirstAdminComesFromTheEnvironmentAndLogsInAndOut() throws Exception {
        String cookie = login("root", "root-password");
        assertThat(get("/api/admin/me", cookie).body().get("username").asString()).isEqualTo("root");
        // Usernames are case-insensitive.
        login("ROOT", "root-password");

        assertThat(post("/api/admin/login", null, creds("root", "nope")).status()).isEqualTo(401);
        assertThat(post("/api/admin/login", null, creds("nobody", "nope")).status()).isEqualTo(401);

        Res out = post("/api/admin/logout", cookie, null);
        assertThat(out.status()).isEqualTo(204);
        assertThat(out.setCookie()).contains("Max-Age=0");
        assertThat(get("/api/admin/me", cookie).status()).isEqualTo(401);
    }

    @Test
    void changesNeedTheCsrfHeader() throws Exception {
        assertThat(call("POST", "/api/admin/login", null, creds("root", "root-password"), false, null).status()).isEqualTo(403);
        String cookie = login("root", "root-password");
        assertThat(call("POST", "/api/admin/admins", cookie, creds("sneaky", "long-enough-pw"), false, null).status()).isEqualTo(403);
        assertThat(call("PUT", "/api/maps/house", cookie, "{}", false, null).status()).isEqualTo(403);
    }

    @Test
    void repeatedWrongPasswordsLockTheAccountOut() throws Exception {
        String root = login("root", "root-password");
        assertThat(post("/api/admin/admins", root, creds("target", "target-password")).status()).isEqualTo(201);
        for (int i = 0; i < AdminAuth.FREE_FAILURES + 1; i++) post("/api/admin/login", null, creds("target", "wrong"));
        // Even the right password waits now.
        assertThat(post("/api/admin/login", null, creds("target", "target-password")).status()).isEqualTo(429);
    }

    @Test
    void adminsManageAccountsAndPasswords() throws Exception {
        String root = login("root", "root-password");
        assertThat(post("/api/admin/admins", root, creds("x", "long-enough-pw")).status()).isEqualTo(400);
        assertThat(post("/api/admin/admins", root, creds("alex", "short")).status()).isEqualTo(400);
        JsonNode alex = post("/api/admin/admins", root, creds("alex", "alex-password")).body();
        assertThat(post("/api/admin/admins", root, creds("Alex", "alex-password")).status()).isEqualTo(409);
        assertThat(get("/api/admin/admins", root).body().findValuesAsString("username")).contains("root", "alex");

        String alexCookie = login("alex", "alex-password");
        String alexOther = login("alex", "alex-password");
        assertThat(post("/api/admin/password", alexCookie, "{\"current\":\"wrong\",\"next\":\"new-alex-password\"}").status()).isEqualTo(403);
        assertThat(post("/api/admin/password", alexCookie, "{\"current\":\"alex-password\",\"next\":\"new-alex-password\"}").status())
                .isEqualTo(204);
        // Changing the password ends the other sessions, not this one.
        assertThat(get("/api/admin/me", alexCookie).status()).isEqualTo(200);
        assertThat(get("/api/admin/me", alexOther).status()).isEqualTo(401);
        login("alex", "new-alex-password");

        String alexId = alex.get("id").asString();
        assertThat(call("DELETE", "/api/admin/admins/" + alexId, alexCookie, null, true, null).status()).isEqualTo(400);
        assertThat(call("DELETE", "/api/admin/admins/" + alexId, root, null, true, null).status()).isEqualTo(204);
        assertThat(get("/api/admin/me", alexCookie).status()).isEqualTo(401);
    }

    @Test
    void theHeartbeatMarksPlayersOnline() throws Exception {
        String root = login("root", "root-password");
        JsonNode p = register("Beater");
        UUID id = UUID.fromString(p.get("playerId").asString());
        db.sql("UPDATE players SET last_seen_at = now() - interval '1 hour' WHERE id = ?").param(id).update();
        assertThat(onlineFlag(root, "Beater")).isFalse();

        assertThat(call("POST", "/api/players/me/seen", null, null, false, p.get("token").asString()).status()).isEqualTo(204);
        assertThat(call("POST", "/api/players/me/seen", null, null, false, "bad").status()).isEqualTo(401);
        assertThat(onlineFlag(root, "Beater")).isTrue();
        assertThat(get("/api/admin/overview", root).body().get("online").asInt()).isPositive();
    }

    @Test
    void theHeartbeatRecordsAddressesAndDevices() throws Exception {
        String root = login("root", "root-password");
        JsonNode p = register("Gadget");
        String id = p.get("playerId").asString();
        String token = p.get("token").asString();
        String device = """
                {"deviceId":"dev-1","platform":"ios","os":"iOS 18.1","browser":"WebView","model":"iPhone",
                 "details":{"screen":"390x844","touch":true}}""";
        assertThat(call("POST", "/api/players/me/seen", null, device, false, token).status()).isEqualTo(204);
        // An unknown platform is stored as web; a body with no device id records nothing more.
        assertThat(call("POST", "/api/players/me/seen", null, "{\"deviceId\":\"dev-2\",\"platform\":\"toaster\"}", false, token)
                .status()).isEqualTo(204);
        assertThat(call("POST", "/api/players/me/seen", null, "{}", false, token).status()).isEqualTo(204);

        JsonNode d = get("/api/admin/players/" + id, root).body();
        assertThat(d.get("createdIp").asString()).isNotBlank();
        assertThat(d.get("player").get("lastIp").asString()).isEqualTo(d.get("createdIp").asString());
        assertThat(d.get("ips")).hasSize(1);
        assertThat(d.get("player").get("emailVerifiedAt").isNull()).isTrue();
        assertThat(d.get("devices")).hasSize(2);
        JsonNode phone = d.get("devices").get(1);
        assertThat(phone.get("deviceId").asString()).isEqualTo("dev-1");
        assertThat(phone.get("platform").asString()).isEqualTo("ios");
        assertThat(phone.get("model").asString()).isEqualTo("iPhone");
        assertThat(phone.get("details").get("screen").asString()).isEqualTo("390x844");
        assertThat(phone.get("userAgent").asString()).isNotBlank();
        assertThat(d.get("devices").get(0).get("platform").asString()).isEqualTo("web");

        // The list shows the latest device, and the search finds players by address.
        JsonNode page = get("/api/admin/players?q=" + d.get("createdIp").asString(), root).body();
        assertThat(page.get("total").asInt()).isPositive();
        assertThat(get("/api/admin/players?q=Gadget", root).body().get("players").get(0).get("platform").asString())
                .isEqualTo("web");

        // Players from before addresses were recorded have none of it.
        JsonNode old = register("Oldtimer");
        db.sql("UPDATE players SET created_ip = NULL, last_ip = NULL WHERE id = ?").param(UUID.fromString(old.get("playerId").asString())).update();
        db.sql("DELETE FROM player_ips WHERE player_id = ?").param(UUID.fromString(old.get("playerId").asString())).update();
        Res r = get("/api/admin/players/" + old.get("playerId").asString(), root);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.body().get("createdIp").isNull()).isTrue();
        assertThat(r.body().get("devices")).isEmpty();
    }

    private boolean onlineFlag(String cookie, String name) throws Exception {
        JsonNode page = get("/api/admin/players?q=" + name, cookie).body();
        assertThat(page.get("total").asInt()).isEqualTo(1);
        return page.get("players").get(0).get("online").asBoolean();
    }
}
