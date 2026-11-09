package com.topdownsurvival.map;

import com.topdownsurvival.sim.map.MapDoc;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/maps")
public class MapController {
    public record MapSummary(String id, String name, int version) {}

    private final MapService maps;
    private final byte[] adminToken;

    public MapController(MapService maps, @Value("${top-down-survival.admin-token}") String adminToken) {
        this.maps = maps;
        this.adminToken = adminToken.getBytes(StandardCharsets.UTF_8);
    }

    @GetMapping
    public List<MapSummary> list() {
        return maps.published().stream().map(m -> new MapSummary(m.getId(), m.getName(), m.getVersion())).toList();
    }

    /** The map document itself, as stored. */
    @GetMapping(value = "/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
    public String get(@PathVariable String id) {
        return maps.find(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No map " + id))
                .getData();
    }

    /** Create or replace a map. Needs {@code X-Admin-Token}; disabled when ADMIN_TOKEN is unset. */
    @PutMapping(value = "/{id}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public MapSummary put(
            @PathVariable String id,
            @RequestHeader(value = "X-Admin-Token", required = false) String token,
            @RequestBody String body) {
        if (adminToken.length == 0) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Map uploads are disabled");
        if (token == null || !MessageDigest.isEqual(adminToken, token.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Bad admin token");
        }
        MapDoc doc = maps.parse(body);
        if (!id.equals(doc.id())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "URL id and document id differ");
        GameMap saved = maps.save(doc);
        GameMap current = saved != null ? saved : maps.find(id).orElseThrow();
        return new MapSummary(current.getId(), current.getName(), current.getVersion());
    }

    @ExceptionHandler(MapService.InvalidMapException.class)
    public ResponseEntity<Map<String, Object>> invalid(MapService.InvalidMapException e) {
        return ResponseEntity.badRequest().body(Map.of("error", "Invalid map", "problems", e.getErrors()));
    }
}
