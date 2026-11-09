package com.topdownsurvival.sim;

import com.topdownsurvival.sim.map.MapDoc.WindowDef;

/** A window: its planks, where zombies stand and land, and the zombie climbing through. */
public final class Barricade {
    public static final int MAX_PLANKS = 6;

    public final WindowDef def;
    public int planks = MAX_PLANKS;
    /** Zombie currently climbing through (only one at a time). */
    public Zombie climber;
    public final Point center;
    /** Where zombies stand to tear planks. */
    public final Point outsidePoint;
    /** Where zombies land after climbing in; also where the player rebuilds from. */
    public final Point insidePoint;
    public final Point spawnPoint;
    /** True when the window sits in a horizontal (top/bottom) wall. */
    public final boolean horizontal;

    public Barricade(WindowDef def) {
        this.def = def;
        double t = TileMap.TILE;
        double cx = def.tx() * t + t / 2;
        double cy = def.ty() * t + t / 2;
        this.center = new Point(cx, cy);
        this.outsidePoint = new Point(cx + def.dx() * t, cy + def.dy() * t);
        this.insidePoint = new Point(cx - def.dx() * t, cy - def.dy() * t);
        this.spawnPoint = new Point(cx + def.dx() * t * 3, cy + def.dy() * t * 3);
        this.horizontal = def.dy() != 0;
    }

    public boolean tear() {
        if (planks <= 0) return false;
        planks--;
        return true;
    }

    public boolean rebuild() {
        if (planks >= MAX_PLANKS || climber != null) return false;
        planks++;
        return true;
    }
}
