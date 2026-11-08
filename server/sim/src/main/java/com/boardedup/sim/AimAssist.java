package com.boardedup.sim;

/** Port of client/src/sim/aimAssist.ts. */
public final class AimAssist {
    /** Half-angle of the assist cone. Set to 0 to disable aim assist. */
    public static final double CONE = Math.toRadians(8);

    private AimAssist() {}

    /**
     * Returns the angle to actually fire at. If the raw aim already hits a zombie it's left alone
     * (so precise shots stay precise); otherwise it bends toward the zombie closest to the aim
     * line within the cone.
     */
    static double apply(GameSim sim, double ox, double oy, double aim, double range) {
        if (CONE <= 0) return aim;
        double dx = Math.cos(aim);
        double dy = Math.sin(aim);
        double wallD = sim.map.rayWall(ox, oy, dx, dy, range);

        Zombie best = null;
        double bestDiff = CONE;
        for (Zombie z : sim.zombies) {
            if (z.dead) continue;
            double t = SimMath.rayCircle(ox, oy, dx, dy, z.x, z.y, Zombie.RADIUS);
            if (t >= 0 && t <= wallD) return aim;

            double d = Math.hypot(z.x - ox, z.y - oy);
            if (d > range + Zombie.RADIUS) continue;
            double diff = Math.abs(SimMath.angleDiff(aim, Math.atan2(z.y - oy, z.x - ox)));
            if (diff < bestDiff && sim.map.hasLOS(ox, oy, z.x, z.y)) {
                best = z;
                bestDiff = diff;
            }
        }
        if (best == null) return aim;

        // Aim at a random point across the body rather than dead centre, so assisted shots
        // don't all count as headshots.
        double d = Math.hypot(best.x - ox, best.y - oy);
        double lateral = sim.rng.range(-0.6, 0.6) * Zombie.RADIUS;
        return Math.atan2(best.y - oy, best.x - ox) + Math.atan2(lateral, d);
    }
}
