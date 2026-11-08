package com.boardedup.sim.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.boardedup.sim.TestMaps;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class MapValidatorTest {
    private final JsonMapper json = JsonMapper.builder().build();

    private Map<String, Object> house() throws IOException {
        String raw = Files.readString(TestMaps.dir().resolve("house.json"));
        @SuppressWarnings("unchecked")
        Map<String, Object> m = json.readValue(raw, Map.class);
        return m;
    }

    /** Validate the house map after an edit to its raw JSON tree. */
    private List<String> houseWith(Consumer<Map<String, Object>> edit) throws IOException {
        Map<String, Object> m = house();
        edit.accept(m);
        return MapValidator.validate(json.convertValue(m, MapDoc.class));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Map<String, Object> m, String key) {
        return (List<Map<String, Object>>) m.get(key);
    }

    @SuppressWarnings("unchecked")
    private static void setTile(Map<String, Object> m, int x, int y, char c) {
        List<String> tiles = (List<String>) m.get("tiles");
        StringBuilder row = new StringBuilder(tiles.get(y));
        row.setCharAt(x, c);
        tiles.set(y, row.toString());
    }

    @Test
    void repoMapsAreValid() throws IOException {
        List<Path> files;
        try (var list = Files.list(TestMaps.dir())) {
            files = list.filter(f -> f.toString().endsWith(".json")).toList();
        }
        assertThat(files).hasSizeGreaterThanOrEqualTo(2);
        for (Path f : files) {
            MapDoc doc = json.readValue(Files.readString(f), MapDoc.class);
            assertThat(MapValidator.validate(doc)).as(f.getFileName().toString()).isEmpty();
        }
    }

    @Test
    void powerSwitchIsOptionalButMustBeOnAWall() throws IOException {
        assertThat(houseWith(m -> m.put("power", Map.of("tx", 4, "ty", 6, "nx", 1, "ny", 0)))).isEmpty();
        assertThat(houseWith(m -> m.put("power", Map.of("tx", 9, "ty", 9, "nx", 0, "ny", 1))))
                .anyMatch(e -> e.contains("power switch") && e.contains("wall tile"));
    }

    @Test
    void windowMustBeOnAWindowTile() throws IOException {
        assertThat(houseWith(m -> list(m, "windows").getFirst().put("tx", 12)))
                .anyMatch(e -> e.contains("window at 12,4") && e.contains("not 'W'"));
    }

    @Test
    void windowMustFaceOutside() throws IOException {
        assertThat(houseWith(m -> list(m, "windows").getFirst().put("dy", 1)))
                .anyMatch(e -> e.contains("outside"));
    }

    @Test
    void roomNamesMustAgree() throws IOException {
        // The second top window is in the top-right room; calling it "tl" clashes with the start room.
        assertThat(houseWith(m -> list(m, "windows").get(2).put("room", "tl")))
                .anyMatch(e -> e.contains("already a different, unconnected area") || e.contains("that area is room"));
    }

    @Test
    void unknownRoomsWeaponsAndPerksAreRejected() throws IOException {
        List<String> errors = houseWith(m -> {
            list(m, "windows").getFirst().put("room", "attic");
            list(m, "wallBuys").getFirst().put("weapon", "bazooka");
            list(m, "perks").getFirst().put("perk", "flight");
        });
        assertThat(errors).anyMatch(e -> e.contains("unknown room \"attic\""));
        assertThat(errors).anyMatch(e -> e.contains("unknown weapon \"bazooka\""));
        assertThat(errors).anyMatch(e -> e.contains("unknown perk \"flight\""));
    }

    @Test
    void everyRoomMustBeReachable() throws IOException {
        // Wall up the two doors into the right-hand rooms.
        List<String> errors = houseWith(m -> {
            List<Map<String, Object>> doors = new ArrayList<>(list(m, "doors"));
            for (var d : List.of(doors.get(0), doors.get(3))) {
                @SuppressWarnings("unchecked")
                List<List<Integer>> tiles = (List<List<Integer>>) d.get("tiles");
                tiles.forEach(t -> setTile(m, t.get(0), t.get(1), '#'));
                doors.remove(d);
            }
            m.put("doors", doors);
        });
        assertThat(errors).contains(
                "room \"tr\" can't be reached from the start room",
                "room \"br\" can't be reached from the start room");
    }

    @Test
    void wallSpotsMustBeOnWallsFacingFloor() throws IOException {
        List<String> errors = houseWith(m -> {
            ((Map<String, Object>) m.get("armour")).put("ny", 1);
            ((Map<String, Object>) m.get("upgrade")).put("ty", 24);
        });
        assertThat(errors).anyMatch(e -> e.startsWith("armour") && e.contains("face a floor"));
        assertThat(errors).anyMatch(e -> e.startsWith("upgrade") && e.contains("wall tile"));
    }

    @Test
    void boxMustSitOnCrates() throws IOException {
        assertThat(houseWith(m -> ((Map<String, Object>) m.get("box")).put("tx", 10)))
                .anyMatch(e -> e.startsWith("box"));
    }

    @Test
    void gridMustMatchItsSize() throws IOException {
        assertThat(houseWith(m -> m.put("width", 41))).anyMatch(e -> e.contains("must be width (41)"));
        assertThat(houseWith(m -> setTile(m, 0, 0, 'Z'))).anyMatch(e -> e.contains("outside \"._#WCD\""));
    }

    @Test
    void missingFieldsAreReportedNotThrown() throws IOException {
        assertThat(houseWith(m -> m.remove("box"))).anyMatch(e -> e.contains("missing a required field"));
    }
}
