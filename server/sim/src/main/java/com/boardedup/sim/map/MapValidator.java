package com.boardedup.sim.map;

import com.boardedup.sim.Defs;
import com.boardedup.sim.map.MapDoc.DoorDef;
import com.boardedup.sim.map.MapDoc.TilePos;
import com.boardedup.sim.map.MapDoc.WindowDef;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * Checks a {@link MapDoc} is playable, so a bad upload is rejected rather than breaking the game.
 *
 * <p>Rooms aren't painted onto tiles. They're found by flood-filling floor, with doors and walls as
 * boundaries; each region is then named by the windows, doors and start point that touch it, and
 * those names have to agree.
 */
public final class MapValidator {
    public static final Pattern ID_PATTERN = Pattern.compile("^[a-z0-9-]{1,40}$");
    private static final String TILE_CHARS = "._#WCD";
    private static final int MIN_SIZE = 10;
    private static final int MAX_SIZE = 200;
    private static final int MAX_DOOR_COST = 100_000;


    private MapValidator() {}

    /** Every problem found; empty if the map is valid. */
    public static List<String> validate(MapDoc m) {
        var v = new Run(m);
        v.run();
        return v.errors;
    }

    private static final class Run {
        final MapDoc m;
        final List<String> errors = new ArrayList<>();
        int[] region;
        /** Region index → room name, and the reverse. */
        final Map<Integer, String> regionRoom = new HashMap<>();
        final Map<String, Integer> roomRegion = new HashMap<>();

        Run(MapDoc m) { this.m = m; }

        void run() {
            if (m.id() == null || !ID_PATTERN.matcher(m.id()).matches()) err("id must match " + ID_PATTERN.pattern());
            if (m.name() == null || m.name().isBlank() || m.name().length() > 40) err("name must be 1-40 characters");
            if (!checkGrid()) return;
            for (var field : new Object[] {m.rooms(), m.startRoom(), m.playerStart(), m.windows(), m.doors(),
                    m.wallBuys(), m.perks(), m.armour(), m.upgrade(), m.box()}) {
                if (field == null) {
                    err("missing a required field (rooms, startRoom, playerStart, windows, doors, wallBuys, perks, armour, upgrade, box)");
                    return;
                }
            }
            if (m.rooms().isEmpty()) err("rooms must not be empty");
            if (new HashSet<>(m.rooms()).size() != m.rooms().size()) err("rooms contains duplicates");
            if (m.windows().isEmpty()) err("needs at least one window");

            floodRegions();
            checkStart();
            checkWindows();
            List<int[]> doorLinks = checkDoors();
            checkWallSpots();
            checkBox();
            checkRooms(doorLinks);
        }

        void err(String s) { errors.add(s); }

        char at(int x, int y) {
            if (x < 0 || y < 0 || x >= m.width() || y >= m.height()) return '#';
            return m.tiles().get(y).charAt(x);
        }

        boolean checkGrid() {
            if (m.width() < MIN_SIZE || m.width() > MAX_SIZE || m.height() < MIN_SIZE || m.height() > MAX_SIZE) {
                err("width and height must be " + MIN_SIZE + "-" + MAX_SIZE);
                return false;
            }
            if (m.tiles() == null || m.tiles().size() != m.height()) {
                err("tiles must have exactly height (" + m.height() + ") rows");
                return false;
            }
            boolean ok = true;
            for (int y = 0; y < m.height(); y++) {
                String row = m.tiles().get(y);
                if (row == null || row.length() != m.width()) {
                    err("tiles row " + y + " must be width (" + m.width() + ") characters");
                    ok = false;
                } else if (!row.chars().allMatch(c -> TILE_CHARS.indexOf(c) >= 0)) {
                    err("tiles row " + y + " has characters outside \"" + TILE_CHARS + "\"");
                    ok = false;
                }
            }
            return ok;
        }

        void floodRegions() {
            int w = m.width();
            region = new int[w * m.height()];
            java.util.Arrays.fill(region, -1);
            int next = 0;
            for (int start = 0; start < region.length; start++) {
                if (region[start] >= 0 || at(start % w, start / w) != '_') continue;
                var queue = new ArrayDeque<Integer>();
                queue.add(start);
                region[start] = next;
                while (!queue.isEmpty()) {
                    int i = queue.poll();
                    int x = i % w, y = i / w;
                    for (int[] d : new int[][] {{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
                        int nx = x + d[0], ny = y + d[1];
                        // Crates sit inside rooms, so they don't split them.
                        char c = at(nx, ny);
                        if ((c == '_' || c == 'C') && region[ny * w + nx] < 0) {
                            region[ny * w + nx] = next;
                            queue.add(ny * w + nx);
                        }
                    }
                }
                next++;
            }
        }

        /** The room region of a floor tile, or -1. */
        int regionAt(int x, int y) {
            if (x < 0 || y < 0 || x >= m.width() || y >= m.height() || at(x, y) != '_') return -1;
            return region[y * m.width() + x];
        }

        /** Name a region, reporting a conflict if it or the name is already taken. */
        void label(int r, String room, String what) {
            if (!m.rooms().contains(room)) {
                err(what + ": unknown room \"" + room + "\"");
                return;
            }
            String had = regionRoom.get(r);
            Integer hadRegion = roomRegion.get(room);
            if (had != null && !had.equals(room)) {
                err(what + ": that area is room \"" + had + "\", not \"" + room + "\"");
            } else if (hadRegion != null && hadRegion != r) {
                err(what + ": room \"" + room + "\" is already a different, unconnected area");
            } else {
                regionRoom.put(r, room);
                roomRegion.put(room, r);
            }
        }

        void checkStart() {
            TilePos p = m.playerStart();
            int r = regionAt(p.tx(), p.ty());
            if (r < 0) err("playerStart must be on a floor tile");
            else label(r, m.startRoom(), "playerStart");
        }

        void checkWindows() {
            for (WindowDef w : m.windows()) {
                String what = "window at " + w.tx() + "," + w.ty();
                if (at(w.tx(), w.ty()) != 'W') err(what + ": tile is not 'W'");
                if (Math.abs(w.dx()) + Math.abs(w.dy()) != 1) {
                    err(what + ": (dx, dy) must be one step along an axis");
                    continue;
                }
                if (at(w.tx() + w.dx(), w.ty() + w.dy()) != '.') err(what + ": the tile outside (dx, dy) must be outside ('.')");
                int r = regionAt(w.tx() - w.dx(), w.ty() - w.dy());
                if (r < 0) err(what + ": the tile inside must be floor");
                else label(r, w.room(), what);
            }
        }

        /** Validates doors and returns the room-region pairs they connect. */
        List<int[]> checkDoors() {
            List<int[]> links = new ArrayList<>();
            for (DoorDef d : m.doors()) {
                if (d.tiles() == null || d.tiles().isEmpty() || d.rooms() == null || d.rooms().size() != 2) {
                    err("door: needs tiles and exactly two rooms");
                    continue;
                }
                String what = "door " + d.rooms();
                if (d.cost() < 0 || d.cost() > MAX_DOOR_COST) err(what + ": cost must be 0-" + MAX_DOOR_COST);
                var touching = new TreeSet<Integer>();
                for (List<Integer> t : d.tiles()) {
                    if (t == null || t.size() != 2) {
                        err(what + ": each tile must be [x, y]");
                        continue;
                    }
                    int x = t.get(0), y = t.get(1);
                    if (at(x, y) != 'D') err(what + ": tile " + x + "," + y + " is not 'D'");
                    for (int[] n : new int[][] {{x + 1, y}, {x - 1, y}, {x, y + 1}, {x, y - 1}}) {
                        int r = regionAt(n[0], n[1]);
                        if (r >= 0) touching.add(r);
                    }
                }
                if (touching.size() != 2) {
                    err(what + ": must sit between exactly two floor areas (touches " + touching.size() + ")");
                    continue;
                }
                int a = touching.first(), b = touching.last();
                // Name whichever side is already known, then the other side gets the remaining name.
                String ra = d.rooms().get(0), rb = d.rooms().get(1);
                boolean swap = rb.equals(regionRoom.get(a)) || ra.equals(regionRoom.get(b));
                label(swap ? b : a, ra, what);
                label(swap ? a : b, rb, what);
                links.add(new int[] {a, b});
            }
            return links;
        }

        void checkWallSpots() {
            Map<String, MapDoc.WallSpot> spots = new LinkedHashMap<>();
            m.wallBuys().forEach(s -> {
                if (!Defs.standard().weapons.containsKey(s.weapon())) err("wall buy at " + s.tx() + "," + s.ty() + ": unknown weapon \"" + s.weapon() + "\"");
                spots.put("wall buy at " + s.tx() + "," + s.ty(), new MapDoc.WallSpot(s.tx(), s.ty(), s.nx(), s.ny()));
            });
            m.perks().forEach(s -> {
                if (!Defs.standard().perks.containsKey(s.perk())) err("perk at " + s.tx() + "," + s.ty() + ": unknown perk \"" + s.perk() + "\"");
                spots.put("perk at " + s.tx() + "," + s.ty(), new MapDoc.WallSpot(s.tx(), s.ty(), s.nx(), s.ny()));
            });
            spots.put("armour", m.armour());
            spots.put("upgrade", m.upgrade());
            if (m.power() != null) spots.put("power switch", m.power());
            spots.forEach((what, s) -> {
                if (at(s.tx(), s.ty()) != '#') err(what + ": must be on a wall tile");
                if (Math.abs(s.nx()) + Math.abs(s.ny()) != 1) err(what + ": (nx, ny) must be one step along an axis");
                else if (regionAt(s.tx() + s.nx(), s.ty() + s.ny()) < 0) err(what + ": (nx, ny) must face a floor tile");
            });
        }

        void checkBox() {
            TilePos b = m.box();
            if (at(b.tx(), b.ty()) != 'C' || at(b.tx() + 1, b.ty()) != 'C') err("box: tiles " + b.tx() + "," + b.ty() + " and the one to its right must be crates ('C')");
            if (regionAt(b.tx(), b.ty() + 1) < 0) err("box: the tile below it must be floor");
        }

        void checkRooms(List<int[]> doorLinks) {
            for (String room : m.rooms()) {
                if (!roomRegion.containsKey(room)) err("room \"" + room + "\" isn't touched by any window, door or the start");
            }
            if (!errors.isEmpty()) return;
            // Every room must be reachable from the start by opening doors.
            var reached = new HashSet<Integer>();
            var queue = new ArrayDeque<Integer>();
            int start = roomRegion.get(m.startRoom());
            reached.add(start);
            queue.add(start);
            while (!queue.isEmpty()) {
                int r = queue.poll();
                for (int[] l : doorLinks) {
                    int other = l[0] == r ? l[1] : l[1] == r ? l[0] : -1;
                    if (other >= 0 && reached.add(other)) queue.add(other);
                }
            }
            for (String room : m.rooms()) {
                if (!reached.contains(roomRegion.get(room))) err("room \"" + room + "\" can't be reached from the start room");
            }
        }
    }
}
