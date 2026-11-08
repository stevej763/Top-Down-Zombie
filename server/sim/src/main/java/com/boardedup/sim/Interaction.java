package com.boardedup.sim;

/** What pressing E would do for the player right now. */
public sealed interface Interaction {
    record Rebuild(Barricade barricade) implements Interaction {}
    record Use(Interactable target) implements Interaction {}
}
