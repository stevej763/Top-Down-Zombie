package com.topdownsurvival.game.protocol;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonTypeName;
import java.util.List;
import java.util.Map;

/**
 * The shared world 20 times a second. Built by {@code SnapshotBuilder}; floats are rounded to 2
 * decimals to keep it small. Enum-like fields are lowercase strings. {@code acks} maps each player
 * id to the last input seq the server has applied for them.
 */
@JsonTypeName("snapshot")
public record Snapshot(
        long tick,
        Map<Integer, Integer> acks,
        RoundView round,
        /** Whether the box, perks and upgrade bench work (and, on maps with a power switch, the lights are on). */
        boolean power,
        PowerUpsView powerUps,
        List<PlayerView> players,
        List<ZombieView> zombies,
        /** Plank counts, in map order. */
        List<Integer> windows,
        /** In GameSim order: wall buys, perks, armour, upgrade, box, doors, then the power switch if the map has one. */
        List<InteractableView> interactables) implements ServerMessage {

    public record RoundView(int n, boolean active, int remaining, double intermission) {}

    public record DropView(String id, double x, double y, double life) {}

    public record PowerUpsView(double instakill, @JsonProperty("double") double doublePoints, List<DropView> drops) {}

    public record WeaponView(String id, int tier, int mag, int reserve, double reloadProgress) {}

    /** {@code kind} is "rebuild" (with {@code window}), "use" (with {@code target}) or "revive" (with {@code player}). */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record InteractionView(String kind, Integer window, Integer target, Integer player) {}

    /** {@code state} is "alive", "downed" or "dead". {@code weapons} always has 2 entries; an empty slot is null. */
    public record PlayerView(
            int id, String name, double x, double y, double aim, double hp, double maxHp,
            String state, double bleedout, double reviveProgress, double armour, int armourLevel,
            int points, int kills, int slot, List<WeaponView> weapons, List<String> perks, double invuln,
            InteractionView interaction) {}

    /** {@code state} is "outside", "breaching", "climbing" or "inside". */
    public record ZombieView(int id, double x, double y, double facing, String state, boolean runner) {}

    /** Doors carry {@code open}; the box carries {@code state} ("closed", "rolling", "ready"), {@code shown}, {@code timer}, {@code owner}; the rest are empty. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record InteractableView(Boolean open, String state, String shown, Double timer, Integer owner) {
        public static final InteractableView EMPTY = new InteractableView(null, null, null, null, null);
    }
}
