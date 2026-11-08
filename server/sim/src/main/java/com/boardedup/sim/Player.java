package com.boardedup.sim;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.function.IntPredicate;

/** Port of client/src/sim/Player.ts. */
public final class Player extends Body {
    public static final double RADIUS = 12;
    public static final double SPEED = 165;
    public static final double BASE_HP = 100;
    private static final IntPredicate SOLID = t -> t != Tile.FLOOR;
    private static final double REBUILD_RANGE = 54;
    private static final double REBUILD_INTERVAL = 0.45;
    private static final double REGEN_DELAY = 4;
    private static final double REGEN_RATE = 40;

    private final Defs defs;
    public double hp = BASE_HP;
    public double aim;
    public final Weapon[] weapons = new Weapon[2];
    public int slot;
    public final Set<String> perks = new LinkedHashSet<>();
    public double armour;
    public int armourLevel;
    public double sinceHit = 99;
    /** Seconds of invulnerability left (after Second Wind). */
    public double invuln;
    public double knifeCooldown;
    /** What E would do right now; null if nothing. */
    public Interaction interaction;
    private double rebuildTimer;

    public Player(Defs defs, double x, double y) {
        super(x, y);
        this.defs = defs;
        weapons[0] = new Weapon(defs, defs.weapon(defs.starterWeapon));
    }

    public Weapon weapon() {
        return weapons[slot];
    }

    public Weapon otherWeapon() {
        return weapons[1 - slot];
    }

    public double maxHp() {
        return perks.contains("toughHide") ? defs.perkEffects.toughHideMaxHp() : BASE_HP;
    }

    public double reloadMult() {
        return perks.contains("quickHands") ? defs.perkEffects.quickHandsReloadMult() : 1;
    }

    public double fireIntervalMult() {
        return perks.contains("rapidFire") ? defs.perkEffects.rapidFireIntervalMult() : 1;
    }

    public Weapon findWeapon(String id) {
        for (Weapon w : weapons) if (w != null && w.def.id().equals(id)) return w;
        return null;
    }

    public void switchTo(int s) {
        if (s == slot || weapons[s] == null) return;
        weapon().cancelReload();
        slot = s;
    }

    void update(double dt, PlayerInput inp, GameSim sim) {
        int mx = Integer.signum(inp.moveX());
        int my = Integer.signum(inp.moveY());
        if (mx != 0 || my != 0) {
            double l = Math.hypot(mx, my);
            x += (mx / l) * SPEED * dt;
            y += (my / l) * SPEED * dt;
        }
        sim.map.collideCircle(this, RADIUS, SOLID);

        aim = inp.aim();

        if (inp.selectSlot() == 0 || inp.selectSlot() == 1) switchTo(inp.selectSlot());
        if (inp.swap()) switchTo(1 - slot);

        for (Weapon w : weapons) if (w != null) w.update(dt);
        Weapon w = weapon();
        if (inp.reload()) reload(sim);

        knifeCooldown = Math.max(0, knifeCooldown - dt);
        boolean outOfAmmo = w.mag == 0 && w.reserve == 0;
        // Out of ammo, the fire button knifes instead; holding it keeps slashing.
        boolean trigger = w.def.auto() || outOfAmmo ? inp.fireHeld() : inp.firePressed();
        if (inp.knife() || (trigger && outOfAmmo)) {
            tryKnife(sim);
        } else if (trigger) {
            if (w.mag == 0) reload(sim);
            else if (w.canFire()) sim.fire(w);
        }

        sinceHit += dt;
        if (sinceHit > REGEN_DELAY) hp = Math.min(maxHp(), hp + REGEN_RATE * dt);
        invuln = Math.max(0, invuln - dt);

        updateInteraction(dt, inp, sim);
    }

    private void reload(GameSim sim) {
        if (weapon().startReload(reloadMult())) sim.emit(new SimEvent.Reload());
    }

    private void tryKnife(GameSim sim) {
        if (knifeCooldown > 0) return;
        knifeCooldown = defs.knife.cooldown();
        sim.knife();
    }

    private void updateInteraction(double dt, PlayerInput inp, GameSim sim) {
        Interaction best = null;
        double bestD = Double.POSITIVE_INFINITY;
        for (Barricade b : sim.barricades) {
            double d = SimMath.dist(x, y, b.insidePoint.x(), b.insidePoint.y());
            if (d < REBUILD_RANGE && d < bestD && b.planks < Barricade.MAX_PLANKS && b.climber == null) {
                best = new Interaction.Rebuild(b);
                bestD = d;
            }
        }
        for (Interactable it : sim.interactables) {
            double d = it.distance(x, y);
            if (d < it.range && d < bestD && it.usable(sim)) {
                best = new Interaction.Use(it);
                bestD = d;
            }
        }
        interaction = best;

        if (best instanceof Interaction.Rebuild r && inp.interactHeld()) {
            rebuildTimer += dt;
            if (rebuildTimer >= REBUILD_INTERVAL) {
                rebuildTimer = 0;
                sim.rebuildPlank(r.barricade());
            }
        } else {
            // Primed so the first plank goes up quickly after pressing E.
            rebuildTimer = REBUILD_INTERVAL * 0.6;
        }
        if (best instanceof Interaction.Use u && inp.interactPressed()) u.target().use(sim);
    }
}
