package com.topdownsurvival.sim;

import java.util.Arrays;
import java.util.List;
import java.util.function.IntPredicate;

/** BFS distance field over passable tiles, rooted at the living players' tiles. */
public final class FlowField {
    private static final int[][] DIRS = {
        {1, 0}, {-1, 0}, {0, 1}, {0, -1},
        {1, 1}, {1, -1}, {-1, 1}, {-1, -1},
    };

    private final TileMap map;
    private final IntPredicate passable;
    private final int[] dist;
    /** Source tiles (tx, ty pairs, possibly off the grid) of the last computed field; null forces a recompute. */
    private int[] origins;

    public FlowField(TileMap map, IntPredicate passable) {
        this.map = map;
        this.passable = passable;
        this.dist = new int[map.w * map.h];
    }

    /** Force a recompute on the next update (e.g. after a door opens). */
    public void invalidate() {
        origins = null;
    }

    /** Multi-source BFS from every point's tile (the living players), so each tile leads to the nearest one. */
    public void update(List<Point> sources) {
        int w = map.w, h = map.h;
        int[] tiles = new int[sources.size() * 2];
        for (int i = 0; i < sources.size(); i++) {
            tiles[i * 2] = (int) Math.floor(sources.get(i).x() / TileMap.TILE);
            tiles[i * 2 + 1] = (int) Math.floor(sources.get(i).y() / TileMap.TILE);
        }
        if (Arrays.equals(tiles, origins)) return;
        origins = tiles;

        Arrays.fill(dist, -1);
        int[] queue = new int[w * h];
        int head = 0, tail = 0;
        for (int i = 0; i < tiles.length; i += 2) {
            int tx = tiles[i], ty = tiles[i + 1];
            // A player can be pushed briefly off the grid's floor; there's nothing to root then.
            if (tx < 0 || ty < 0 || tx >= w || ty >= h || dist[ty * w + tx] == 0) continue;
            dist[ty * w + tx] = 0;
            queue[tail++] = ty * w + tx;
        }
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

    /** Centre of the neighbouring tile that leads toward the nearest player, or null if already there / unreachable. */
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
