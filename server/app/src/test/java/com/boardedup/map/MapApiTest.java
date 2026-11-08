package com.boardedup.map;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.core.io.ClassPathResource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT, properties = "boarded-up.admin-token=test-admin")
@Testcontainers
class MapApiTest {
    @Container
    @ServiceConnection
    static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");

    @LocalServerPort
    int port;

    private final HttpClient http = HttpClient.newHttpClient();
    private final JsonMapper json = JsonMapper.builder().build();

    record Res(int status, JsonNode body) {}

    private Res call(String method, String path, String adminToken, String body) throws Exception {
        var req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        if (adminToken != null) req.header("X-Admin-Token", adminToken);
        HttpResponse<String> res = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
        return new Res(res.statusCode(), res.body().isEmpty() ? null : json.readTree(res.body()));
    }

    /** The farmstead map, renamed to a fresh id so tests don't disturb the seeded copy. */
    private String farmsteadAs(String id, String name) throws Exception {
        String raw = new ClassPathResource("maps/farmstead.json").getContentAsString(StandardCharsets.UTF_8);
        return raw.replace("\"id\": \"farmstead\"", "\"id\": \"" + id + "\"").replace("\"The Farmstead\"", "\"" + name + "\"");
    }

    @Test
    void seedsRepoMaps() throws Exception {
        Res list = call("GET", "/api/maps", null, null);
        assertThat(list.status()).isEqualTo(200);
        assertThat(list.body().findValuesAsString("id")).contains("house", "farmstead");

        Res house = call("GET", "/api/maps/house", null, null);
        assertThat(house.status()).isEqualTo(200);
        assertThat(house.body().get("width").asInt()).isEqualTo(40);
        assertThat(house.body().get("tiles")).hasSize(30);
        assertThat(house.body().get("windows")).hasSize(8);

        assertThat(call("GET", "/api/maps/nope", null, null).status()).isEqualTo(404);
    }

    @Test
    void uploadsNeedTheAdminToken() throws Exception {
        String doc = farmsteadAs("shed", "Shed");
        assertThat(call("PUT", "/api/maps/shed", null, doc).status()).isEqualTo(403);
        assertThat(call("PUT", "/api/maps/shed", "wrong", doc).status()).isEqualTo(403);
    }

    @Test
    void uploadCreatesThenVersionsOnlyOnChange() throws Exception {
        Res first = call("PUT", "/api/maps/barn", "test-admin", farmsteadAs("barn", "Barn"));
        assertThat(first.status()).isEqualTo(200);
        assertThat(first.body().get("version").asInt()).isEqualTo(1);

        Res same = call("PUT", "/api/maps/barn", "test-admin", farmsteadAs("barn", "Barn"));
        assertThat(same.body().get("version").asInt()).isEqualTo(1);

        Res renamed = call("PUT", "/api/maps/barn", "test-admin", farmsteadAs("barn", "Big Barn"));
        assertThat(renamed.body().get("version").asInt()).isEqualTo(2);
        assertThat(call("GET", "/api/maps/barn", null, null).body().get("name").asString()).isEqualTo("Big Barn");
    }

    @Test
    void invalidUploadsListTheProblems() throws Exception {
        String broken = farmsteadAs("broken", "Broken").replace("\"weapon\":\"shotgun\"", "\"weapon\":\"bazooka\"");
        Res r = call("PUT", "/api/maps/broken", "test-admin", broken);
        assertThat(r.status()).isEqualTo(400);
        assertThat(r.body().get("problems").toString()).contains("bazooka");

        assertThat(call("PUT", "/api/maps/other", "test-admin", farmsteadAs("broken", "X")).status()).isEqualTo(400);
        assertThat(call("PUT", "/api/maps/junk", "test-admin", "{not json").status()).isEqualTo(400);
    }
}
