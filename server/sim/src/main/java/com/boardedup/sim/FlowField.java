package com.boardedup.sim;

import java.util.Arrays;
import java.util.function.IntPredicate;

/** BFS distance field over passable tiles, rooted at the player's tile. */
public final class FlowField {
    private static final int[][] DIRS = {
        {1, 0}, {-1, 0}, {0, 1}, {0, -1},
        {1, 1}, {1, -1}, {-1, 1}, {-1, -1},
    };

    private final TileMap map;
    private final IntPredicate passable;
    private final int[] dist;
    private int originTx = -1;
    private int originTy = -1;

    public FlowField(TileMap map, IntPredicate passable) {
        this.map = map;
        this.passable = passable;
        this.dist = new int[map.w * map.h];
    }

    /** Force a recompute on the next update (e.g. after a door opens). */
    public void invalidate() {
        originTx = -1;
    }

    public void update(double px, double py) {
        int tx = (int) Math.floor(px / TileMap.TILE);
        int ty = (int) Math.floor(py / TileMap.TILE);
        if (tx == originTx && ty == originTy) return;
        originTx = tx;
        originTy = ty;

        int w = map.w, h = map.h;
        Arrays.fill(dist, -1);
        // The player can be pushed briefly off the grid's floor; there's nothing to root then.
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) return;
        int[] queue = new int[w * h];
        int head = 0, tail = 0;
        dist[ty * w + tx] = 0;
        queue[tail++] = ty * w + tx;
        while (head < tail) {
            int i = queue[head++];
            int cx = i % w;
            int cy = i / w;
            for (int k = 0; k < 4; k++) {
                int nx = cx + DIRS[k][0];
                int ny = cy + DIRS[k][1];
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                int n = ny * w + nx;
                if (dist[n] != -1 || !passable.test(map.get(nx, ny))) continue;
                dist[n] = dist[i] + 1;
                queue[tail++] = n;
            }
        }
    }

    /** Centre of the neighbouring tile that leads toward the player, or null if already there / unreachable. */
    public Point nextTarget(double x, double y) {
        int tx = (int) Math.floor(x / TileMap.TILE);
        int ty = (int) Math.floor(y / TileMap.TILE);
        int w = map.w, h = map.h;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
        int here = dist[ty * w + tx];
        if (here <= 0) return null;

        int best = here;
        int bx = -1, by = -1;
        for (int[] o : DIRS) {
            int ox = o[0], oy = o[1];
            int nx = tx + ox, ny = ty + oy;
            if (!passable.test(map.get(nx, ny))) continue;
            // No corner cutting.
            if (ox != 0 && oy != 0 && (!passable.test(map.get(tx + ox, ty)) || !passable.test(map.get(tx, ty + oy)))) continue;
            int d = dist[ny * w + nx];
            if (d >= 0 && d < best) {
                best = d;
                bx = nx;
                by = ny;
            }
        }
        if (bx < 0) return null;
        return new Point(bx * TileMap.TILE + TileMap.TILE / 2.0, by * TileMap.TILE + TileMap.TILE / 2.0);
    }
}
