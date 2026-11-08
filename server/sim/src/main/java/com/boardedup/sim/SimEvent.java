package com.boardedup.sim;

/**
 * What the sim reports for clients to show or play, mirroring client/src/sim/events.ts.
 * Gameplay never depends on them. Positions are world px; {@code points} is what was awarded
 * (after Double Points), 0 if none.
 */
public sealed interface SimEvent {
    record Shot(String weapon, int tier, double x, double y, double aim) implements SimEvent {}
    /** One pellet's path, from the shooter's centre to where it stopped. */
    record Tracer(String weapon, int tier, double x1, double y1, double x2, double y2, boolean hitWall) implements SimEvent {}
    record Explosion(double x, double y, double radius) implements SimEvent {}
    record ZombieHit(int zombie, double x, double y, double angle, int points) implements SimEvent {}
    record ZombieKilled(int zombie, double x, double y, int points) implements SimEvent {}
    record Knife(boolean hit) implements SimEvent {}
    record Reload() implements SimEvent {}
    record PlayerHurt(double x, double y) implements SimEvent {}
    record SecondWind() implements SimEvent {}
    record GameOver() implements SimEvent {}
    record PlankTorn(double x, double y) implements SimEvent {}
    record PlankPlaced(double x, double y, int points) implements SimEvent {}
    record DoorOpened(double x, double y) implements SimEvent {}
    record Denied() implements SimEvent {}
    record WeaponGiven(String weapon, int tier) implements SimEvent {}
    record AmmoBought() implements SimEvent {}
    record PerkBought(String perk) implements SimEvent {}
    record ArmourBought(int level) implements SimEvent {}
    record Upgraded(String weapon, int tier) implements SimEvent {}
    record PowerUp(String id) implements SimEvent {}
    record RoundStart(int round) implements SimEvent {}
    record RoundEnd(int round) implements SimEvent {}
    record BoxTick() implements SimEvent {}
    record BoxReveal(String weapon) implements SimEvent {}
}
