package com.boardedup.sim;

import com.boardedup.sim.map.MapDoc;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import tools.jackson.databind.json.JsonMapper;

/** The repo's maps/ folder, copied into test resources by Gradle. */
public final class TestMaps {
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private TestMaps() {}

    public static Path dir() {
        try {
            return Path.of(TestMaps.class.getResource("/maps").toURI());
        } catch (URISyntaxException e) {
            throw new IllegalStateException(e);
        }
    }

    public static MapDoc load(String id) {
        try {
            return JSON.readValue(Files.readString(dir().resolve(id + ".json")), MapDoc.class);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
