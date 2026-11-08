package com.boardedup.sim;

/** Tile types, matching client/src/game/TileMap.ts. */
public final class Tile {
    public static final int OUTSIDE = 0;
    public static final int FLOOR = 1;
    public static final int WALL = 2;
    public static final int WINDOW = 3;
    public static final int CRATE = 4;
    /** Closed, purchasable door. Becomes FLOOR when opened. */
    public static final int DOOR = 5;
    /** Low furniture (tables, beds, counters): blocks walking but not bullets. */
    public static final int LOW = 6;

    private Tile() {}
}
