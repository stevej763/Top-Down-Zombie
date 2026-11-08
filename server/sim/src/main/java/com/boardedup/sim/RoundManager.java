package com.boardedup.sim;

import java.util.List;

/** Round flow and difficulty curves: port of client/src/sim/RoundManager.ts. */
public final class RoundManager {
    /** Zombies alive at once in a solo game; each extra player adds MAX_ALIVE_PER_PLAYER. */
    public static final int MAX_ALIVE = 24;
    private static final int MAX_ALIVE_PER_PLAYER = 6;
    /** Each extra player adds this fraction of the solo zombie count. */
    private static final double COUNT_PER_PLAYER = 0.5;
    private static final double INTERMISSION = 10;
    private static final double FIRST_ROUND_DELAY = 3;

    // Health grows linearly up to LINEAR_ROUNDS, then by a percentage each round after.
    private static final double BASE_HEALTH = 150;
    private static final double HEALTH_PER_ROUND = 60;
    private static final int LINEAR_ROUNDS = 9;
    private static final double LATE_HEALTH_GROWTH = 1.07;

    public static double zombieHealth(int r) {
        if (r <= LINEAR_ROUNDS) return BASE_HEALTH + HEALTH_PER_ROUND * (r - 1);
        double peak = BASE_HEALTH + HEALTH_PER_ROUND * (LINEAR_ROUNDS - 1);
        return Math.round(peak * Math.pow(LATE_HEALTH_GROWTH, r - LINEAR_ROUNDS));
    }

    public static int zombieCount(int r) {
        return r < 10 ? 6 + 3 * (r - 1) : 30 + 5 * (r - 9);
    }

    /** Zombies in round {@code r} for a party of {@code n}. */
    public static int zombieCount(int r, int n) {
        return (int) Math.round(zombieCount(r) * (1 + COUNT_PER_PLAYER * (n - 1)));
    }

    public static int maxAlive(int n) {
        return MAX_ALIVE + MAX_ALIVE_PER_PLAYER * (n - 1);
    }

    public static double runnerChance(int r) {
        return SimMath.clamp((r - 3) * 0.1, 0, 0.7);
    }

    public static double zombieDamage(int r) {
        return 50 + Math.min(r - 1, 20);
    }

    private static double tearInterval(int r) {
        return Math.max(0.7, 1.5 - r * 0.06);
    }

    private static double spawnInterval(int r) {
        return Math.max(0.4, 2.0 - r * 0.1);
    }

    public int round;
    public boolean active;
    public int toSpawn;
    public double intermission = FIRST_ROUND_DELAY;
    private double spawnTimer;

    public int remaining(GameSim game) {
        return toSpawn + game.zombies.size();
    }

    void update(double dt, GameSim game) {
        if (!active) {
            intermission -= dt;
            if (intermission <= 0) startRound(game);
            return;
        }

        spawnTimer -= dt;
        if (toSpawn > 0 && spawnTimer <= 0 && game.zombies.size() < maxAlive(game.partySize())) {
            spawn(game);
            toSpawn--;
            spawnTimer = spawnInterval(round) * game.rng.range(0.7, 1.3);
        }

        if (toSpawn == 0 && game.zombies.isEmpty()) {
            active = false;
            intermission = INTERMISSION;
            game.emit(new SimEvent.RoundEnd(round));
        }
    }

    private void startRound(GameSim game) {
        round++;
        active = true;
        toSpawn = zombieCount(round, game.partySize());
        spawnTimer = 0.5;
        for (Player p : game.players) p.economy.resetRound();
        game.powerUps.resetRound();
        game.emit(new SimEvent.RoundStart(round));
        game.respawnDead();
    }

    private void spawn(GameSim game) {
        int r = round;
        // Only windows in rooms the player has opened, so every zombie can reach them.
        List<Barricade> open = game.barricades.stream().filter(w -> game.openRooms.contains(w.def.room())).toList();
        Barricade b = game.rng.pick(open);
        double lateral = game.rng.range(-TileMap.TILE, TileMap.TILE);
        double x = b.spawnPoint.x() + (b.horizontal ? lateral : 0);
        double y = b.spawnPoint.y() + (b.horizontal ? 0 : lateral);
        boolean runner = game.rng.next() < runnerChance(r);
        double speed = (runner ? game.rng.range(110, 128) : game.rng.range(42, 58)) * (1 + Math.min(r, 20) * 0.01);
        game.zombies.add(new Zombie(game.nextId(), b, x, y, zombieHealth(r), speed, zombieDamage(r), runner, tearInterval(r)));
    }
}
