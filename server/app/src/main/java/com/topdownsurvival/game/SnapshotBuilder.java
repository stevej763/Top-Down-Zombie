package com.topdownsurvival.game;

import com.topdownsurvival.game.protocol.Snapshot;
import com.topdownsurvival.game.protocol.Snapshot.DropView;
import com.topdownsurvival.game.protocol.Snapshot.InteractableView;
import com.topdownsurvival.game.protocol.Snapshot.InteractionView;
import com.topdownsurvival.game.protocol.Snapshot.PlayerView;
import com.topdownsurvival.game.protocol.Snapshot.PowerUpsView;
import com.topdownsurvival.game.protocol.Snapshot.RoundView;
import com.topdownsurvival.game.protocol.Snapshot.WeaponView;
import com.topdownsurvival.game.protocol.Snapshot.ZombieView;
import com.topdownsurvival.sim.GameSim;
import com.topdownsurvival.sim.Interactable;
import com.topdownsurvival.sim.Interaction;
import com.topdownsurvival.sim.Player;
import com.topdownsurvival.sim.Weapon;
import com.topdownsurvival.sim.Zombie;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Turns a {@link GameSim} into the {@link Snapshot} sent to clients. */
final class SnapshotBuilder {
    private SnapshotBuilder() {}

    static Snapshot build(GameSim sim, long tick, Map<Integer, Integer> acks) {
        var round = new RoundView(sim.rounds.round, sim.rounds.active, sim.rounds.remaining(sim), r2(sim.rounds.intermission));
        var drops = sim.powerUps.drops.stream().map(d -> new DropView(d.id, r2(d.x), r2(d.y), r2(d.life))).toList();
        var powerUps = new PowerUpsView(r2(sim.powerUps.instakill), r2(sim.powerUps.doublePoints), drops);
        var players = sim.players.stream().map(p -> player(sim, p)).toList();
        var zombies = sim.zombies.stream().map(SnapshotBuilder::zombie).toList();
        var windows = sim.barricades.stream().map(b -> b.planks).toList();
        var interactables = sim.interactables.stream().map(SnapshotBuilder::interactable).toList();
        return new Snapshot(tick, acks, round, sim.power, powerUps, players, zombies, windows, interactables);
    }

    private static PlayerView player(GameSim sim, Player p) {
        List<WeaponView> weapons = Arrays.asList(weapon(p.weapons[0]), weapon(p.weapons[1]));
        return new PlayerView(p.id, p.name, r2(p.x), r2(p.y), r2(p.aim), r2(p.hp), r2(p.maxHp()),
                lower(p.state), r2(p.bleedout), r2(p.reviveProgress), r2(p.armour), p.armourLevel,
                p.economy.points, p.kills, p.slot, weapons, new ArrayList<>(p.perks), r2(p.invuln),
                interaction(sim, p.interaction));
    }

    private static WeaponView weapon(Weapon w) {
        return w == null ? null : new WeaponView(w.def.id(), w.tier, w.mag, w.reserve, r2(w.reloadProgress()));
    }

    private static InteractionView interaction(GameSim sim, Interaction i) {
        return switch (i) {
            case null -> null;
            case Interaction.Rebuild r -> new InteractionView("rebuild", sim.barricades.indexOf(r.barricade()), null, null);
            case Interaction.Use u -> new InteractionView("use", null, sim.interactables.indexOf(u.target()), null);
            case Interaction.Revive r -> new InteractionView("revive", null, null, r.target().id);
        };
    }

    private static ZombieView zombie(Zombie z) {
        return new ZombieView(z.id, r2(z.x), r2(z.y), r2(z.facing), lower(z.state), z.runner);
    }

    private static InteractableView interactable(Interactable it) {
        return switch (it) {
            case Interactable.Door d -> new InteractableView(d.open, null, null, null, null);
            case Interactable.MysteryBox b -> new InteractableView(null, lower(b.state), b.shown, r2(b.timer), b.owner);
            default -> InteractableView.EMPTY;
        };
    }

    private static String lower(Enum<?> e) {
        return e.name().toLowerCase(Locale.ROOT);
    }

    static double r2(double v) {
        return Math.round(v * 100) / 100.0;
    }
}
