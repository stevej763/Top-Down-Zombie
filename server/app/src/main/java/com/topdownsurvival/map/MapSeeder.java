package com.topdownsurvival.map;

import com.topdownsurvival.sim.map.MapDoc;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Component;

/**
 * Loads the repo's {@code maps/*.json} (copied onto the classpath by Gradle) at startup. Those files
 * are the source of truth for the maps they define: an edited file replaces the DB copy, even one
 * changed through the admin API. An invalid file stops startup.
 */
@Component
public class MapSeeder implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(MapSeeder.class);

    private final MapService maps;

    public MapSeeder(MapService maps) {
        this.maps = maps;
    }

    @Override
    public void run(ApplicationArguments args) throws IOException {
        for (Resource r : new PathMatchingResourcePatternResolver().getResources("classpath*:maps/*.json")) {
            String file = r.getFilename();
            MapDoc doc = maps.parse(r.getContentAsString(StandardCharsets.UTF_8));
            if (file == null || !file.equals(doc.id() + ".json")) {
                throw new IllegalStateException("maps/" + file + ": file name must be <id>.json (id is \"" + doc.id() + "\")");
            }
            try {
                GameMap saved = maps.save(doc);
                if (saved != null) log.info("Seeded map {} (version {})", saved.getId(), saved.getVersion());
            } catch (MapService.InvalidMapException e) {
                throw new IllegalStateException("maps/" + file + " is invalid: " + e.getMessage(), e);
            }
        }
    }
}
