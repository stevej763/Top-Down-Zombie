package com.topdownsurvival.sim;

import java.util.function.IntPredicate;

public final class TileMap {
    public static final int TILE = 32;

    public final int w;
    public final int h;
    public final int pxW;
    public final int pxH;
    private final int[] tiles;

    public TileMap(int w, int h, int[] tiles) {
        this.w = w;
        this.h = h;
        this.tiles = tiles;
        this.pxW = w * TILE;
        this.pxH = h * TILE;
    }

    public int get(int tx, int ty) {
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) return Tile.WALL;
        return tiles[ty * w + tx];
    }

    public void set(int tx, int ty, int t) {
        if (tx >= 0 && ty >= 0 && tx < w && ty < h) tiles[ty * w + tx] = t;
    }

    public int tileAt(double x, double y) {
        return get((int) Math.floor(x / TILE), (int) Math.floor(y / TILE));
    }

    public static boolean blocksBullets(int t) {
        return t == Tile.WALL || t == Tile.CRATE || t == Tile.DOOR;
    }

    /** Distance along a normalized ray before it hits a bullet-blocking tile (capped at {@code max}). */
    public double rayWall(double ox, double oy, double dx, double dy, double max) {
        return ray(ox, oy, dx, dy, max, TileMap::blocksBullets);
    }

    public boolean hasLOS(double ax, double ay, double bx, double by) {
        return clearLine(ax, ay, bx, by, TileMap::blocksBullets);
    }

    /** Like {@link #hasLOS}, but low furniture blocks it too: you can see over a table, not walk through it. */
    public boolean hasWalkLine(double ax, double ay, double bx, double by) {
        return clearLine(ax, ay, bx, by, t -> blocksBullets(t) || t == Tile.LOW);
    }

    private boolean clearLine(double ax, double ay, double bx, double by, IntPredicate blocks) {
        double d = Math.hypot(bx - ax, by - ay);
        if (d < 1) return true;
        return ray(ax, ay, (bx - ax) / d, (by - ay) / d, d, blocks) >= d;
    }

    private double ray(double ox, double oy, double dx, double dy, double max, IntPredicate blocks) {
        for (double d = 0; d < max; d += 4) {
            if (blocks.test(tileAt(ox + dx * d, oy + dy * d))) return d;
        }
        return max;
    }

    /** Push a circle out of every solid tile it overlaps. */
    public void collideCircle(Body p, double r, IntPredicate solid) {
        for (int pass = 0; pass < 2; pass++) {
            int minTx = (int) Math.floor((p.x - r) / TILE);
            int maxTx = (int) Math.floor((p.x + r) / TILE);
            int minTy = (int) Math.floor((p.y - r) / TILE);
            int maxTy = (int) Math.floor((p.y + r) / TILE);
            for (int ty = minTy; ty <= maxTy; ty++) {
                for (int tx = minTx; tx <= maxTx; tx++) {
                    if (!solid.test(get(tx, ty))) continue;
                    double x0 = tx * TILE, y0 = ty * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
                    double nx = SimMath.clamp(p.x, x0, x1);
                    double ny = SimMath.clamp(p.y, y0, y1);
                    double dx = p.x - nx, dy = p.y - ny;
                    double d2 = dx * dx + dy * dy;
                    if (d2 >= r * r) continue;
                    if (d2 > 1e-6) {
                        double d = Math.sqrt(d2);
                        double push = (r - d) / d;
                        p.x += dx * push;
                        p.y += dy * push;
                    } else {
                        // Centre is inside the tile: eject along the axis of least penetration.
                        double left = p.x - x0, right = x1 - p.x, top = p.y - y0, bottom = y1 - p.y;
                        double m = Math.min(Math.min(left, right), Math.min(top, bottom));
                        if (m == left) p.x = x0 - r;
                        else if (m == right) p.x = x1 + r;
                        else if (m == top) p.y = y0 - r;
                        else p.y = y1 + r;
                    }
                }
            }
        }
    }
}
