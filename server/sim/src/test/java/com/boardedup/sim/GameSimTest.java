package com.boardedup.sim;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.boardedup.sim.Interactable.ArmourBench;
import com.boardedup.sim.Interactable.Door;
import com.boardedup.sim.Interactable.MysteryBox;
import com.boardedup.sim.Interactable.PerkMachine;
import com.boardedup.sim.Interactable.UpgradeBench;
import com.boardedup.sim.map.MapDoc;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.function.Consumer;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** The feature checks from CLAUDE.md, against the Java sim. Seeds keep them deterministic. */
class GameSimTest {
    private static final double DT = 1.0 / 60;

    static MapDoc doc(String id) {
        return TestMaps.load(id);
    }

    /** A one-player sim, like the TS sim. */
    static GameSim solo(String map, long seed) {
        GameSim s = new GameSim(doc(map), seed);
        s.addPlayer(1, "solo");
        return s;
    }

    private static Player player(GameSim s) {
        return s.players.getFirst();
    }

    /** A sim with no zombies coming. */
    private static GameSim quiet() {
        GameSim s = solo("house", 1);
        s.rounds.intermission = 1e9;
        return s;
    }

    private static void press(GameSim s, Consumer<PlayerInput.Builder> b) {
        PlayerInput.Builder in = PlayerInput.builder();
        b.accept(in);
        s.step(DT, in.build());
    }

    private static void idle(GameSim s, int ticks) {
        for (int i = 0; i < ticks; i++) s.step(DT, PlayerInput.NONE);
    }

    private static void standAt(GameSim s, double x, double y) {
        player(s).x = x;
        player(s).y = y;
    }

    private static Zombie zombie(GameSim s, double x, double y, double hp) {
        Zombie z = new Zombie(s.nextId(), s.barricades.getFirst(), x, y, hp, 0, 0, false, 1);
        z.state = Zombie.State.INSIDE;
        s.zombies.add(z);
        return z;
    }

    private static <T extends Interactable> T find(GameSim s, Class<T> type, java.util.function.Predicate<T> where) {
        return s.interactables.stream().filter(type::isInstance).map(type::cast).filter(where).findFirst().orElseThrow();
    }

    private static boolean emitted(GameSim s, Class<? extends SimEvent> type) {
        return s.events.stream().anyMatch(type::isInstance);
    }

    // ------------------------------------------------------------- bot runs

    /** Shoots the nearest zombie it can see, knifes close ones, rebuilds windows when idle. */
    static PlayerInput bot(GameSim s) {
        return bot(s, player(s));
    }

    static PlayerInput bot(GameSim s, Player p) {
        Zombie target = null;
        double best = Double.POSITIVE_INFINITY;
        for (Zombie z : s.zombies) {
            double d = Math.hypot(z.x - p.x, z.y - p.y);
            if (d < best && s.map.hasLOS(p.x, p.y, z.x, z.y)) {
                best = d;
                target = z;
            }
        }
        Weapon w = p.weapon();
        PlayerInput.Builder in = PlayerInput.builder();
        if (target != null) {
            in.aim(Math.atan2(target.y - p.y, target.x - p.x));
            boolean dry = w.mag == 0 && w.reserve == 0;
            if (target.state == Zombie.State.INSIDE && (best < 55 || dry)) {
                in.knife = best < 55;
                if (dry && best > 40) in.move((int) Math.signum(Math.round((target.x - p.x) / 8)), (int) Math.signum(Math.round((target.y - p.y) / 8)));
                return in.build();
            }
            in.fireHeld = true;
            in.firePressed = s.time % 0.3 < DT * 1.5;
            in.reload = w.mag == 0;
            return in.build();
        }
        Barricade b = s.barricades.stream().filter(x -> s.openRooms.contains(x.def.room()))
                .min(Comparator.comparingInt(x -> x.planks)).orElseThrow();
        double dx = b.insidePoint.x() - p.x, dy = b.insidePoint.y() - p.y;
        boolean far = Math.hypot(dx, dy) > 20;
        if (far) in.move((int) Math.signum(Math.round(dx / 8)), (int) Math.signum(Math.round(dy / 8)));
        in.interactHeld = !far;
        in.reload = w.mag < w.magSize();
        return in.build();
    }

    private static String summary(GameSim s) {
        return "%.3f r%d k%d p%d hp%.3f x%.3f z=%s planks=%s".formatted(s.time, s.rounds.round, s.kills, player(s).economy.points, player(s).hp,
                player(s).x, s.zombies.stream().map(z -> "%d:%.3f,%.3f,%.3f".formatted(z.id, z.x, z.y, z.hp)).collect(Collectors.joining(";")),
                s.barricades.stream().map(b -> String.valueOf(b.planks)).collect(Collectors.joining(",")));
    }

    private static String run(long seed) {
        GameSim s = solo("house", seed);
        for (int i = 0; i < 60 * 120 && !s.over; i++) {
            s.step(DT, bot(s));
            s.events.clear();
        }
        return summary(s);
    }

    @Test
    void sameSeedAndInputsGiveTheSameGame() {
        assertThat(run(42)).isEqualTo(run(42));
        assertThat(run(42)).isNotEqualTo(run(43));
    }

    @ParameterizedTest
    @ValueSource(strings = {"house", "cabin"})
    void botSurvivesTheFirstRound(String map) {
        GameSim s = solo(map, 7);
        for (int i = 0; i < 60 * 600 && !s.over && s.rounds.round < 6; i++) {
            s.step(DT, bot(s));
            s.events.clear();
        }
        // The bot is weak (the TS original averages about round 3), so this only catches a broken sim.
        assertThat(s.rounds.round).isGreaterThanOrEqualTo(2);
        assertThat(s.kills).isGreaterThanOrEqualTo(6);
    }

    // ------------------------------------------------------------- features

    @Test
    void doorsCostPointsAndOpenRooms() {
        GameSim s = quiet();
        Door door = find(s, Door.class, d -> d.def.rooms().contains("tr"));
        standAt(s, door.standX - 30, door.standY);
        idle(s, 1);
        press(s, PlayerInput.Builder::interact);
        assertThat(door.open).isFalse();
        assertThat(emitted(s, SimEvent.Denied.class)).isTrue();

        player(s).economy.points = 5000;
        press(s, PlayerInput.Builder::interact);
        assertThat(door.open).isTrue();
        assertThat(s.openRooms).contains("tr");
        assertThat(player(s).economy.points).isEqualTo(5000 - door.def.cost());
        assertThat(s.map.get(door.def.tiles().getFirst().get(0), door.def.tiles().getFirst().get(1))).isEqualTo(Tile.FLOOR);
    }

    @Test
    void perksAndSecondWind() {
        GameSim s = quiet();
        PerkMachine m = find(s, PerkMachine.class, p -> p.perk.id().equals("secondWind"));
        player(s).economy.points = 5000;
        standAt(s, m.standX, m.standY);
        press(s, PlayerInput.Builder::interact);
        assertThat(player(s).perks).containsExactly("secondWind");
        assertThat(player(s).economy.points).isEqualTo(5000 - m.perk.cost());

        player(s).hp = 5;
        s.damagePlayer(player(s), 1000);
        assertThat(s.over).isFalse();
        assertThat(player(s).hp).isEqualTo(player(s).maxHp());
        assertThat(player(s).perks).isEmpty();
        assertThat(player(s).invuln).isPositive();

        player(s).invuln = 0;
        s.damagePlayer(player(s), 1000);
        assertThat(s.over).isTrue();
        assertThat(emitted(s, SimEvent.GameOver.class)).isTrue();
    }

    @Test
    void toughHideRaisesMaxHealth() {
        GameSim s = quiet();
        s.openDoor(find(s, Door.class, d -> d.def.rooms().contains("bl")));
        PerkMachine m = find(s, PerkMachine.class, p -> p.perk.id().equals("toughHide"));
        player(s).economy.points = 5000;
        standAt(s, m.standX, m.standY);
        press(s, PlayerInput.Builder::interact);
        assertThat(player(s).maxHp()).isEqualTo(250);
        assertThat(player(s).hp).isEqualTo(250);
    }

    @Test
    void armourAbsorbsAndRepairs() {
        GameSim s = quiet();
        s.openDoor(find(s, Door.class, d -> d.def.rooms().contains("bl")));
        ArmourBench bench = find(s, ArmourBench.class, b -> true);
        player(s).economy.points = 10000;
        standAt(s, bench.standX, bench.standY);
        press(s, PlayerInput.Builder::interact);
        assertThat(player(s).armourLevel).isEqualTo(1);
        assertThat(player(s).armour).isEqualTo(50);

        s.damagePlayer(player(s), 50);
        assertThat(player(s).hp).isCloseTo(85, within(1e-9));
        assertThat(player(s).armour).isCloseTo(15, within(1e-9));

        press(s, PlayerInput.Builder::interact);
        assertThat(player(s).armour).isEqualTo(50);
        assertThat(player(s).armourLevel).isEqualTo(1);
    }

    @Test
    void upgradeBench() {
        GameSim s = quiet();
        UpgradeBench bench = find(s, UpgradeBench.class, b -> true);
        player(s).economy.points = 20000;
        standAt(s, bench.standX, bench.standY);
        press(s, PlayerInput.Builder::interact);
        Weapon w = player(s).weapon();
        assertThat(w.tier).isEqualTo(1);
        assertThat(w.name()).isEqualTo("Pistol Mk II");
        assertThat(w.damage()).isEqualTo(25 * 1.75);
        assertThat(w.mag).isEqualTo(12);
        assertThat(player(s).economy.points).isEqualTo(20000 - 3000);
    }

    @Test
    void mysteryBoxRollsAndOffersAWeaponYouDontHave() {
        GameSim s = quiet();
        MysteryBox box = find(s, MysteryBox.class, b -> true);
        player(s).economy.points = 5000;
        standAt(s, box.standX, box.standY);
        press(s, PlayerInput.Builder::interact);
        assertThat(box.state).isEqualTo(MysteryBox.State.ROLLING);
        idle(s, 60 * 3);
        assertThat(box.state).isEqualTo(MysteryBox.State.READY);
        assertThat(box.shown).isNotEqualTo("pistol");
        String shown = box.shown;
        press(s, PlayerInput.Builder::interact);
        assertThat(player(s).weapons[1].def.id()).isEqualTo(shown);
        assertThat(player(s).slot).isEqualTo(1);
    }

    @Test
    void powerUps() {
        GameSim s = quiet();
        Weapon w = player(s).weapon();
        w.mag = 0;
        w.reserve = 0;
        s.applyPowerUp(player(s), "ammo");
        assertThat(w.isFull()).isTrue();

        s.applyPowerUp(player(s), "double");
        idle(s, 1);
        int before = player(s).economy.points;
        zombie(s, player(s).x + 60, player(s).y, 1000);
        press(s, b -> b.aim(0).fire());
        assertThat(player(s).economy.points - before).isEqualTo(20);

        s.applyPowerUp(player(s), "instakill");
        idle(s, 30);
        press(s, b -> b.aim(0).fire());
        assertThat(s.zombies).isEmpty();
        assertThat(s.kills).isEqualTo(1);

        List<Zombie> zs = List.of(zombie(s, 100, 100, 1000), zombie(s, 200, 200, 1000));
        s.applyPowerUp(player(s), "nuke");
        assertThat(zs).allMatch(z -> z.dead);
    }

    @Test
    void plasmaSplashHitsACluster() {
        GameSim s = quiet();
        s.giveWeapon(player(s), new Weapon(s.defs, s.defs.weapon("plasma")));
        Player p = player(s);
        List<Zombie> zs = List.of(zombie(s, p.x + 100, p.y, 1000), zombie(s, p.x + 100, p.y + 30, 1000), zombie(s, p.x + 100, p.y - 30, 1000));
        press(s, b -> b.aim(0).fire());
        assertThat(zs).allMatch(z -> z.hp < 1000);
        assertThat(emitted(s, SimEvent.Explosion.class)).isTrue();
    }

    @Test
    void knife() {
        GameSim s = quiet();
        Player p = player(s);
        Zombie z = zombie(s, p.x + 30, p.y, 100);
        press(s, b -> b.aim(0).knife());
        assertThat(z.dead).isTrue();
        assertThat(player(s).economy.points).isEqualTo(500 + 130);

        Zombie behind = zombie(s, p.x - 30, p.y, 1000);
        idle(s, 60);
        press(s, b -> b.aim(0).knife());
        assertThat(behind.hp).isEqualTo(1000);

        p.weapon().mag = 0;
        p.weapon().reserve = 0;
        idle(s, 60);
        press(s, b -> b.aim(Math.PI).fire());
        assertThat(behind.hp).isEqualTo(1000 - 150);
    }

    @Test
    void rebuildingPaysUntilTheRoundCap() {
        GameSim s = quiet();
        Barricade b = s.barricades.getFirst();
        standAt(s, b.insidePoint.x(), b.insidePoint.y());
        b.planks = 0;
        for (int i = 0; i < 60 * 4; i++) press(s, PlayerInput.Builder::interactHeld);
        assertThat(b.planks).isEqualTo(Barricade.MAX_PLANKS);
        assertThat(player(s).economy.points).isEqualTo(500 + Barricade.MAX_PLANKS * 10);

        player(s).economy.rebuildLeft = 0;
        b.planks = 0;
        for (int i = 0; i < 60 * 4; i++) press(s, PlayerInput.Builder::interactHeld);
        assertThat(player(s).economy.points).isEqualTo(500 + Barricade.MAX_PLANKS * 10);
    }

    @Test
    void zombiesBreakInAndHurtAnIdlePlayer() {
        GameSim s = solo("house", 3);
        int ticks = 0;
        boolean torn = false, hurt = false;
        while (!s.over && ticks++ < 60 * 120) {
            s.step(DT, PlayerInput.NONE);
            torn |= emitted(s, SimEvent.PlankTorn.class);
            hurt |= emitted(s, SimEvent.PlayerHurt.class);
            s.events.clear();
        }
        assertThat(torn).isTrue();
        assertThat(hurt).isTrue();
        assertThat(s.over).isTrue();
    }

    @Test
    void defsMatchTheSharedFiles() throws IOException {
        Defs d = Defs.standard();
        assertThat(d.weapons).containsKeys("pistol", "shotgun", "smg", "rifle", "lmg", "magnum", "plasma");
        assertThat(d.weapon("plasma").splash()).isNotNull();
        assertThat(d.weapon("pistol").splash()).isNull();
        assertThat(d.powerUpIds).containsExactly("ammo", "instakill", "double", "nuke");
        assertThat(d.maxTier).isEqualTo(2);
        assertThat(Files.exists(Path.of("../../shared/defs/weapons.json"))).isTrue();
    }
}
