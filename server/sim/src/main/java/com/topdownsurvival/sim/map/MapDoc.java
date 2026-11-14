package com.topdownsurvival.sim.map;

import java.util.List;

/**
 * A map document, as stored in {@code maps/*.json} and the {@code maps} table. Mirrors the client's
 * {@code MapDoc} in {@code client/src/game/MapData.ts}. Coordinates are tiles.
 *
 * <p>Tile characters: {@code .} outside, {@code _} floor, {@code #} wall, {@code W} window,
 * {@code C} crate (tall: blocks walking and bullets), {@code D} door, {@code T} low furniture (blocks
 * walking only).
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
        TilePos box,
        /**
         * Optional power switch. On a map with one, the box, perk machines and upgrade bench stay
         * dead (and the buildings dark) until a player throws it; without one they work from the start.
         */
        WallSpot power,
        /**
         * Optional and only drawn by the client: furniture, rugs and floor finishes. Furniture is
         * drawn over the {@code C}/{@code T} tiles that make it solid; the sim never reads this.
         */
        List<Decor> decor) {

    public record TilePos(int tx, int ty) {}

    /** (dx, dy) points outward, away from the building. */
    public record WindowDef(int tx, int ty, int dx, int dy, String room) {}

    public record DoorDef(List<List<Integer>> tiles, int cost, List<String> rooms) {}

    /** (nx, ny) points from the wall toward the floor it's used from. */
    public record WallSpot(int tx, int ty, int nx, int ny) {}

    public record WallBuyDef(int tx, int ty, int nx, int ny, String weapon) {}

    /**
     * A freestanding perk machine on its own {@code C} tile, its back to a wall; (nx, ny) points
     * away from that wall toward the floor it's used from.
     */
    public record PerkSpot(int tx, int ty, int nx, int ny, String perk) {}

    /** A w×h tile rectangle. {@code face} (n/e/s/w, optional) is the side its front points to. */
    public record Decor(String kind, int tx, int ty, int w, int h, String face) {}
}
