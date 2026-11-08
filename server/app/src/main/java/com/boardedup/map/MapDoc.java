package com.boardedup.map;

import java.util.List;

/**
 * A map document, as stored in {@code maps/*.json} and the {@code maps} table. Mirrors the client's
 * {@code MapDoc} in {@code world/MapData.ts}. Coordinates are tiles.
 *
 * <p>Tile characters: {@code .} outside, {@code _} floor, {@code #} wall, {@code W} window,
 * {@code C} crate, {@code D} door.
 */
public record MapDoc(
        String id,
        String name,
        int width,
        int height,
        List<String> tiles,
        List<String> rooms,
        String startRoom,
        TilePos playerStart,
        List<WindowDef> windows,
        List<DoorDef> doors,
        List<WallBuyDef> wallBuys,
        List<PerkSpot> perks,
        WallSpot armour,
        WallSpot upgrade,
        /** Left tile of the 2-tile mystery box; it's used from the row below. */
        TilePos box) {

    public record TilePos(int tx, int ty) {}

    /** (dx, dy) points outward, away from the building. */
    public record WindowDef(int tx, int ty, int dx, int dy, String room) {}

    public record DoorDef(List<List<Integer>> tiles, int cost, List<String> rooms) {}

    /** (nx, ny) points from the wall toward the floor it's used from. */
    public record WallSpot(int tx, int ty, int nx, int ny) {}

    public record WallBuyDef(int tx, int ty, int nx, int ny, String weapon) {}

    public record PerkSpot(int tx, int ty, int nx, int ny, String perk) {}
}
