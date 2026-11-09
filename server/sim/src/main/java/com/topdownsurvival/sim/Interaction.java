package com.topdownsurvival.sim;

/** What pressing E would do for the player right now. */
public sealed interface Interaction {
    record Rebuild(Barricade barricade) implements Interaction {}
    record Use(Interactable target) implements Interaction {}
    /** Hold E next to a downed teammate (co-op only). */
    record Revive(Player target) implements Interaction {}
}
