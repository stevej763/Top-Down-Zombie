package com.topdownsurvival.sim;

import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.annotation.JsonTypeName;

/**
 * What the sim reports for clients to show or play, sent as JSON and mirrored by
 * {@code NetEvent} in client/src/net/protocol.ts (same {@code type} names). Gameplay never depends on them. Positions are world px; {@code points} is
 * what was awarded (after Double Points), 0 if none; {@code player} is the acting player's id
 * (for hits and kills, the one who got the points).
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
public sealed interface SimEvent {
    @JsonTypeName("shot")
    record Shot(int player, String weapon, int tier, double x, double y, double aim) implements SimEvent {}
    /** One pellet's path, from the shooter's centre to where it stopped. */
    @JsonTypeName("tracer")
    record Tracer(int player, String weapon, int tier, double x1, double y1, double x2, double y2, boolean hitWall) implements SimEvent {}
    @JsonTypeName("explosion")
    record Explosion(double x, double y, double radius) implements SimEvent {}
    @JsonTypeName("zombieHit")
    record ZombieHit(int player, int zombie, double x, double y, double angle, int points) implements SimEvent {}
    @JsonTypeName("zombieKilled")
    record ZombieKilled(int player, int zombie, double x, double y, int points) implements SimEvent {}
    @JsonTypeName("knife")
    record Knife(int player, boolean hit) implements SimEvent {}
    @JsonTypeName("reload")
    record Reload(int player) implements SimEvent {}
    @JsonTypeName("playerHurt")
    record PlayerHurt(int player, double x, double y) implements SimEvent {}
    @JsonTypeName("secondWind")
    record SecondWind(int player) implements SimEvent {}
    /** Co-op only: at 0 hp without Second Wind. */
    @JsonTypeName("playerDowned")
    record PlayerDowned(int player, double x, double y) implements SimEvent {}
    @JsonTypeName("playerRevived")
    record PlayerRevived(int player, int by) implements SimEvent {}
    /** Bled out; respawns at the next round start. */
    @JsonTypeName("playerDied")
    record PlayerDied(int player) implements SimEvent {}
    @JsonTypeName("playerRespawned")
    record PlayerRespawned(int player, double x, double y) implements SimEvent {}
    @JsonTypeName("gameOver")
    record GameOver() implements SimEvent {}
    @JsonTypeName("plankTorn")
    record PlankTorn(double x, double y) implements SimEvent {}
    @JsonTypeName("plankPlaced")
    record PlankPlaced(int player, double x, double y, int points) implements SimEvent {}
    @JsonTypeName("powerOn")
    record PowerOn(int player) implements SimEvent {}
    @JsonTypeName("doorOpened")
    record DoorOpened(double x, double y) implements SimEvent {}
    @JsonTypeName("denied")
    record Denied(int player) implements SimEvent {}
    @JsonTypeName("weaponGiven")
    record WeaponGiven(int player, String weapon, int tier) implements SimEvent {}
    @JsonTypeName("ammoBought")
    record AmmoBought(int player) implements SimEvent {}
    @JsonTypeName("perkBought")
    record PerkBought(int player, String perk) implements SimEvent {}
    @JsonTypeName("armourBought")
    record ArmourBought(int player, int level) implements SimEvent {}
    @JsonTypeName("upgraded")
    record Upgraded(int player, String weapon, int tier) implements SimEvent {}
    @JsonTypeName("powerUp")
    record PowerUp(int player, String id) implements SimEvent {}
    @JsonTypeName("roundStart")
    record RoundStart(int round) implements SimEvent {}
    @JsonTypeName("roundEnd")
    record RoundEnd(int round) implements SimEvent {}
    @JsonTypeName("boxTick")
    record BoxTick() implements SimEvent {}
    @JsonTypeName("boxReveal")
    record BoxReveal(String weapon) implements SimEvent {}
}
