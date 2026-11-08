package com.boardedup.map;

import com.boardedup.sim.map.MapDoc;
import com.boardedup.sim.map.MapValidator;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

@Service
public class MapService {
    /** Thrown with every validation problem, so an uploader can fix them all at once. */
    public static class InvalidMapException extends RuntimeException {
        private final List<String> errors;

        public InvalidMapException(List<String> errors) {
            super(String.join("; ", errors));
            this.errors = errors;
        }

        public List<String> getErrors() { return errors; }
    }

    private final GameMapRepository maps;
    private final JsonMapper json;

    public MapService(GameMapRepository maps, JsonMapper json) {
        this.maps = maps;
        this.json = json;
    }

    public List<GameMap> published() {
        return maps.findByPublishedTrueOrderByName();
    }

    public Optional<GameMap> find(String id) {
        return maps.findById(id).filter(GameMap::isPublished);
    }

    public MapDoc parse(String raw) {
        try {
            return json.readValue(raw, MapDoc.class);
        } catch (JacksonException e) {
            throw new InvalidMapException(List.of("not a valid map document: " + e.getOriginalMessage()));
        }
    }

    /**
     * Validate and store a map, creating it or replacing the current version. The stored JSON is
     * re-serialized from {@link MapDoc}, so unknown fields are dropped. Returns null if nothing changed.
     */
    @Transactional
    public GameMap save(MapDoc doc) {
        List<String> errors = MapValidator.validate(doc);
        if (!errors.isEmpty()) throw new InvalidMapException(errors);
        String data = json.writeValueAsString(doc);
        GameMap map = maps.findById(doc.id()).orElseGet(() -> new GameMap(doc.id()));
        // Compare documents, not strings: jsonb normalizes key order and whitespace.
        if (map.getData() != null && parse(map.getData()).equals(doc)) return null;
        map.update(doc.name(), data);
        return maps.save(map);
    }
}
