package com.boardedup.sim;

import java.util.ArrayList;
import java.util.List;

public final class PowerUps {
    public static final class Drop {
        public final String id;
        public final double x;
        public final double y;
        public double life;

        Drop(String id, double x, double y, double life) {
            this.id = id;
            this.x = x;
            this.y = y;
            this.life = life;
        }
    }

    public final List<Drop> drops = new ArrayList<>();
    /** Seconds remaining on timed power-ups. */
    public double instakill;
    public double doublePoints;
    private int droppedThisRound;

    public void resetRound() {
        droppedThisRound = 0;
    }

    void maybeDrop(GameSim sim, double x, double y) {
        Defs.PowerUpTuning t = sim.defs.powerUpTuning;
        if (droppedThisRound >= t.maxPerRound() || sim.rng.next() > t.dropChance()) return;
        droppedThisRound++;
        drops.add(new Drop(sim.rng.pick(sim.defs.powerUpIds), x, y, t.lifetime()));
    }

    void update(double dt, GameSim sim) {
        instakill = Math.max(0, instakill - dt);
        doublePoints = Math.max(0, doublePoints - dt);
        double reach = sim.defs.powerUpTuning.pickupRadius() + Player.RADIUS;
        // Iterate a copy: a nuke picked up here can drop new power-ups (they wait for the next tick).
        for (Drop d : List.copyOf(drops)) {
            d.life -= dt;
            for (Player p : sim.players) {
                if (!p.alive() || SimMath.dist(d.x, d.y, p.x, p.y) >= reach) continue;
                d.life = 0;
                sim.applyPowerUp(p, d.id);
                break;
            }
        }
        drops.removeIf(d -> d.life <= 0);
    }
}
