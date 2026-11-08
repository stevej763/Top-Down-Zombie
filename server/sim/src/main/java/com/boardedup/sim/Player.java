package com.boardedup.sim;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.function.IntPredicate;

/** Port of client/src/sim/Player.ts, plus the co-op downed state (Java only for now). */
public final class Player extends Body {
    /** DOWNED and DEAD only happen in co-op; solo goes straight to game over. */
    public enum State { ALIVE, DOWNED, DEAD }

    public static final double RADIUS = 12;
    public static final double SPEED = 165;
    public static final double BASE_HP = 100;
    private static final IntPredicate SOLID = t -> t != Tile.FLOOR;
    private static final double REBUILD_RANGE = 54;
    private static final double REBUILD_INTERVAL = 0.45;
    private static final double REGEN_DELAY = 4;
    private static final double REGEN_RATE = 40;
    static final double BLEEDOUT = 30;
    static final double REVIVE_TIME = 3;
    static final double REVIVE_RANGE = 50;
    static final double REVIVE_HP_FRACTION = 0.5;

    private final Defs defs;
    public final int id;
    public final String name;
    public final Economy economy;
    public int kills;
    public State state = State.ALIVE;
    /** Seconds left before a downed player dies. */
    public double bleedout;
    /** Seconds of reviving so far, 0..REVIVE_TIME. */
    public double reviveProgress;
    /** Set during a step by the teammate reviving this player; id of that teammate, or -1. */
    int revivedBy = -1;
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

    public Player(Defs defs, int id, String name, double x, double y) {
        super(x, y);
        this.defs = defs;
        this.id = id;
        this.name = name;
        this.economy = new Economy(defs);
        weapons[0] = new Weapon(defs, defs.weapon(defs.starterWeapon));
    }

    public boolean alive() {
        return state == State.ALIVE;
    }

    /** Back to the starter loadout (after bleeding out); points and kills are kept. */
    void resetLoadout() {
        weapons[0] = new Weapon(defs, defs.weapon(defs.starterWeapon));
        weapons[1] = null;
        slot = 0;
        perks.clear();
        armour = 0;
        armourLevel = 0;
        hp = BASE_HP;
        sinceHit = 99;
        invuln = 0;
        knifeCooldown = 0;
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
        if (state != State.ALIVE) {
            interaction = null;
            if (state == State.DOWNED) aim = inp.aim();
            return;
        }
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
            else if (w.canFire()) sim.fire(this, w);
        }

        sinceHit += dt;
        if (sinceHit > REGEN_DELAY) hp = Math.min(maxHp(), hp + REGEN_RATE * dt);
        invuln = Math.max(0, invuln - dt);

        updateInteraction(dt, inp, sim);
    }

    private void reload(GameSim sim) {
        if (weapon().startReload(reloadMult())) sim.emit(new SimEvent.Reload(id));
    }

    private void tryKnife(GameSim sim) {
        if (knifeCooldown > 0) return;
        knifeCooldown = defs.knife.cooldown();
        sim.knife(this);
    }

    private void updateInteraction(double dt, PlayerInput inp, GameSim sim) {
        Interaction best = null;
        double bestD = Double.POSITIVE_INFINITY;
        // Reviving beats everything else in reach.
        if (sim.coop()) {
            for (Player o : sim.players) {
                if (o == this || o.state != State.DOWNED) continue;
                double d = SimMath.dist(x, y, o.x, o.y);
                if (d < REVIVE_RANGE && d < bestD) {
                    best = new Interaction.Revive(o);
                    bestD = d;
                }
            }
        }
        if (best == null) best = findInteraction(sim);
        interaction = best;

        if (best instanceof Interaction.Revive r && inp.interactHeld()) {
            // Two teammates reviving at once don't make it faster.
            if (r.target().revivedBy < 0) {
                r.target().revivedBy = id;
                r.target().reviveProgress += dt;
            }
        }
        if (best instanceof Interaction.Rebuild r && inp.interactHeld()) {
            rebuildTimer += dt;
            if (rebuildTimer >= REBUILD_INTERVAL) {
                rebuildTimer = 0;
                sim.rebuildPlank(this, r.barricade());
            }
        } else {
            // Primed so the first plank goes up quickly after pressing E.
            rebuildTimer = REBUILD_INTERVAL * 0.6;
        }
        if (best instanceof Interaction.Use u && inp.interactPressed()) u.target().use(sim, this);
    }

    private Interaction findInteraction(GameSim sim) {
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
            if (d < it.range && d < bestD && it.usable(sim, this)) {
                best = new Interaction.Use(it);
                bestD = d;
            }
        }
        return best;
    }
}
