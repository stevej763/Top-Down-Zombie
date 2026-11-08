package com.boardedup.sim;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/**
 * Gameplay tuning from shared/defs/*.json (copied onto the classpath under {@code defs/}).
 * The client reads the same files in client/src/game/defs.ts (for names, prices and drawing). Ids are the JSON keys.
 */
public final class Defs {
    public record WeaponDef(
            String id, String name, int cost, int ammoCost, double damage, int pellets,
            /** Total random spread in radians. */
            double spread,
            /** Seconds between shots. */
            double fireInterval,
            boolean auto, int mag, int reserve, double reloadTime, double range,
            /** How many zombies one bullet can pass through. */
            int penetration,
            /** Area damage where the shot ends; null for most guns. */
            Splash splash) {
        public record Splash(double radius, double damage) {}

        WeaponDef withId(String id) {
            return new WeaponDef(id, name, cost, ammoCost, damage, pellets, spread, fireInterval, auto, mag, reserve,
                    reloadTime, range, penetration, splash);
        }
    }

    /** Melee: reach is beyond the player's edge in px; arc is the full slash width in radians. */
    public record Knife(double damage, double reach, double arc, double cooldown, double swing) {}

    public record Upgrade(List<Integer> cost, List<Double> damage, List<Double> ammo, List<String> suffix) {}

    public record PerkDef(String id, String name, int cost, String desc) {
        PerkDef withId(String id) {
            return new PerkDef(id, name, cost, desc);
        }
    }

    public record PerkEffects(int toughHideMaxHp, double quickHandsReloadMult, double rapidFireIntervalMult, double secondWindInvuln) {}

    public record Points(int hit, int kill, int headshotKill, int knifeKill, int plank, int nuke) {}

    public record ArmourLevel(int cap, int cost) {}

    public record PowerUpTuning(double dropChance, int maxPerRound, double lifetime, double duration, double pickupRadius) {}

    // The JSON files, as written.
    private record WeaponsFile(Map<String, WeaponDef> weapons, String starter, List<String> boxPool, Knife knife, Upgrade upgrade) {}

    private record PerksFile(Map<String, PerkDef> perks, List<String> order, PerkEffects effects) {}

    private record Armour(List<ArmourLevel> levels, double absorb, int repairCostPerLevel) {}

    private record EconomyFile(int startingPoints, int rebuildCap, Points points, int boxCost, Armour armour) {}

    private record PowerUpName(String name) {}

    private record PowerUpsFile(Map<String, PowerUpName> powerUps, double dropChance, int maxPerRound, double lifetime,
            double duration, double pickupRadius) {}

    public final Map<String, WeaponDef> weapons;
    public final String starterWeapon;
    public final List<String> boxPool;
    public final Knife knife;
    public final Upgrade upgrade;
    public final int maxTier;
    public final Map<String, PerkDef> perks;
    public final List<String> perkOrder;
    public final PerkEffects perkEffects;
    public final int startingPoints;
    /** Max points from rebuilding barricades per round, so it can't be farmed. */
    public final int rebuildCap;
    public final Points points;
    public final int boxCost;
    /** Index 0 = no armour. */
    public final List<ArmourLevel> armourLevels;
    /** Share of each hit that armour soaks up while it lasts. */
    public final double armourAbsorb;
    private final int repairCostPerLevel;
    /** Power-up id → display name, in file order (drops pick from this order). */
    public final Map<String, String> powerUps;
    public final List<String> powerUpIds;
    public final PowerUpTuning powerUpTuning;

    private static volatile Defs standard;

    /** The defs on the classpath, loaded once. */
    public static Defs standard() {
        Defs d = standard;
        if (d == null) {
            synchronized (Defs.class) {
                if (standard == null) standard = load();
                d = standard;
            }
        }
        return d;
    }

    private static Defs load() {
        JsonMapper json = JsonMapper.builder().disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build();
        return new Defs(
                read(json, "weapons.json", WeaponsFile.class),
                read(json, "perks.json", PerksFile.class),
                read(json, "economy.json", EconomyFile.class),
                read(json, "powerups.json", PowerUpsFile.class));
    }

    private static <T> T read(JsonMapper json, String file, Class<T> type) {
        try (InputStream in = Defs.class.getResourceAsStream("/defs/" + file)) {
            if (in == null) throw new IllegalStateException("defs/" + file + " is not on the classpath");
            return json.readValue(in, type);
        } catch (IOException e) {
            throw new IllegalStateException("Can't read defs/" + file, e);
        }
    }

    private Defs(WeaponsFile w, PerksFile p, EconomyFile e, PowerUpsFile pu) {
        var weapons = new LinkedHashMap<String, WeaponDef>();
        w.weapons().forEach((id, def) -> weapons.put(id, def.withId(id)));
        this.weapons = Map.copyOf(weapons);
        this.starterWeapon = w.starter();
        this.boxPool = List.copyOf(w.boxPool());
        this.knife = w.knife();
        this.upgrade = w.upgrade();
        this.maxTier = w.upgrade().cost().size() - 1;

        var perks = new LinkedHashMap<String, PerkDef>();
        p.perks().forEach((id, def) -> perks.put(id, def.withId(id)));
        this.perks = Map.copyOf(perks);
        this.perkOrder = List.copyOf(p.order());
        this.perkEffects = p.effects();

        this.startingPoints = e.startingPoints();
        this.rebuildCap = e.rebuildCap();
        this.points = e.points();
        this.boxCost = e.boxCost();
        this.armourLevels = List.copyOf(e.armour().levels());
        this.armourAbsorb = e.armour().absorb();
        this.repairCostPerLevel = e.armour().repairCostPerLevel();

        var names = new LinkedHashMap<String, String>();
        pu.powerUps().forEach((id, v) -> names.put(id, v.name()));
        this.powerUps = java.util.Collections.unmodifiableMap(names);
        this.powerUpIds = List.copyOf(new ArrayList<>(names.keySet()));
        this.powerUpTuning = new PowerUpTuning(pu.dropChance(), pu.maxPerRound(), pu.lifetime(), pu.duration(), pu.pickupRadius());
    }

    public WeaponDef weapon(String id) {
        WeaponDef d = weapons.get(id);
        if (d == null) throw new IllegalArgumentException("Unknown weapon " + id);
        return d;
    }

    public int repairCost(int level) {
        return repairCostPerLevel * level;
    }
}
