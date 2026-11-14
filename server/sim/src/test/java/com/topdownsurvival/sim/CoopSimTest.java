package com.topdownsurvival.sim;

import static org.assertj.core.api.Assertions.assertThat;

import com.topdownsurvival.sim.Interactable.Door;
import com.topdownsurvival.sim.Interactable.MysteryBox;
import com.topdownsurvival.sim.Interactable.WallBuy;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** Co-op: several players in one sim. Solo behaviour is pinned by GameSimTest and SimParityTest. */
class CoopSimTest {
    private static final double DT = 1.0 / 60;
    private static final double T = TileMap.TILE;

    /** A house sim with {@code n} players (ids 1..n) and no zombies coming. */
    private static GameSim quiet(int n) {
        GameSim s = new GameSim(TestMaps.load("house"), 1);
        for (int i = 1; i <= n; i++) s.addPlayer(i, "p" + i);
        s.rounds.intermission = 1e9;
        s.power = true;
        return s;
    }

    private static void step(GameSim s, Map<Integer, PlayerInput> inputs, int ticks) {
        for (int i = 0; i < ticks; i++) s.step(DT, inputs);
    }

    private static void idle(GameSim s, int ticks) {
        step(s, Map.of(), ticks);
    }

    private static PlayerInput interact() {
        return PlayerInput.builder().interact().build();
    }

    private static PlayerInput holdInteract() {
        return PlayerInput.builder().interactHeld().build();
    }

    private static void standAt(Player p, double x, double y) {
        p.x = x;
        p.y = y;
    }

    /** Centre of tile (tx, ty). */
    private static void standOnTile(Player p, int tx, int ty) {
        standAt(p, tx * T + T / 2, ty * T + T / 2);
    }

    private static Zombie zombie(GameSim s, double x, double y, double hp, double speed) {
        Zombie z = new Zombie(s.nextId(), s.barricades.getFirst(), x, y, hp, speed, 0, false, 1);
        z.state = Zombie.State.INSIDE;
        s.zombies.add(z);
        return z;
    }

    private static boolean emitted(GameSim s, Class<? extends SimEvent> type) {
        return s.events.stream().anyMatch(type::isInstance);
    }

    private static Door door(GameSim s, String room) {
        return s.interactables.stream().filter(Door.class::isInstance).map(Door.class::cast)
                .filter(d -> d.def.rooms().contains(room)).findFirst().orElseThrow();
    }

    @Test
    void playersStartApartAndOnFloor() {
        GameSim s = quiet(4);
        for (Player p : s.players) assertThat(s.map.tileAt(p.x, p.y)).isEqualTo(Tile.FLOOR);
        Player first = s.players.getFirst();
        assertThat(first.x).isEqualTo(17 * T + T / 2);
        assertThat(first.y).isEqualTo(9 * T + T / 2);
        assertThat(s.players.stream().map(p -> p.x + "," + p.y).distinct()).hasSize(4);
    }

    @Test
    void playersHaveTheirOwnPointsAndWeapons() {
        GameSim s = quiet(2);
        Player a = s.player(1), b = s.player(2);
        WallBuy shotgun = s.interactables.stream().filter(WallBuy.class::isInstance).map(WallBuy.class::cast)
                .filter(w -> w.def.id().equals("shotgun")).findFirst().orElseThrow();
        a.economy.points = 5000;
        standAt(a, shotgun.standX, shotgun.standY);
        standAt(b, shotgun.standX, shotgun.standY);
        s.step(DT, Map.of(1, interact()));

        assertThat(a.findWeapon("shotgun")).isNotNull();
        assertThat(a.economy.points).isEqualTo(5000 - shotgun.def.cost());
        assertThat(b.findWeapon("shotgun")).isNull();
        assertThat(b.economy.points).isEqualTo(500);
        assertThat(s.events).contains(new SimEvent.WeaponGiven(1, "shotgun", 0));

        // B can't afford it; the denial is B's.
        s.events.clear();
        s.step(DT, Map.of(2, interact()));
        assertThat(s.events).containsExactly(new SimEvent.Denied(2));

        // Points and kills go to the shooter.
        standAt(a, 300, 200);
        standAt(b, 300, 400);
        a.economy.points = 0;
        zombie(s, b.x + 60, b.y, 10, 0);
        s.step(DT, Map.of(2, PlayerInput.builder().aim(0).fire().build()));
        assertThat(b.kills).isEqualTo(1);
        assertThat(b.economy.points).isIn(500 + s.defs.points.kill(), 500 + s.defs.points.headshotKill());
        assertThat(a.kills).isZero();
        assertThat(a.economy.points).isZero();
        assertThat(s.kills).isEqualTo(1);
    }

    @Test
    void zombieChasesTheNearerPlayer() {
        GameSim s = quiet(2);
        Player a = s.player(1), b = s.player(2);
        standAt(a, 200, 200);
        standAt(b, 560, 420);
        Zombie z = zombie(s, 300, 220, 1000, 60);
        double before = SimMath.dist(z.x, z.y, a.x, a.y);
        idle(s, 30);
        assertThat(SimMath.dist(z.x, z.y, a.x, a.y)).isLessThan(before - 20);

        // A goes down: the zombie loses interest in them and heads for B.
        standAt(a, z.x + 20, z.y);
        s.damagePlayer(a, 1000);
        assertThat(a.state).isEqualTo(Player.State.DOWNED);
        double toB = SimMath.dist(z.x, z.y, b.x, b.y);
        idle(s, 30);
        assertThat(SimMath.dist(z.x, z.y, b.x, b.y)).isLessThan(toB - 20);
    }

    @Test
    void flowFieldLeadsToWhoeverIsNearestByPath() {
        GameSim s = quiet(2);
        Player a = s.player(1), b = s.player(2);
        s.openDoor(door(s, "tr"));
        // The zombie is in the top-right room, just through the wall from A (no line of sight).
        // B is in the same room, farther in a straight line but nearer by path than A, who is
        // round through the door.
        standOnTile(a, 20, 5);
        standOnTile(b, 29, 8);
        Zombie z = zombie(s, 23 * T + T / 2, 5 * T + T / 2, 1000, 70);
        assertThat(SimMath.dist(z.x, z.y, a.x, a.y)).isLessThan(SimMath.dist(z.x, z.y, b.x, b.y));
        assertThat(SimMath.dist(z.x, z.y, b.x, b.y)).isGreaterThan(180);

        boolean reachedB = false;
        for (int i = 0; i < 60 * 6 && !reachedB; i++) {
            s.step(DT, Map.of());
            reachedB = SimMath.dist(z.x, z.y, b.x, b.y) < Zombie.RADIUS + Player.RADIUS + 6;
        }
        assertThat(reachedB).isTrue();

        // With B out of the room, the field leads through the door to A.
        s.removePlayer(2);
        boolean reachedA = false;
        for (int i = 0; i < 60 * 10 && !reachedA; i++) {
            s.step(DT, Map.of());
            reachedA = SimMath.dist(z.x, z.y, a.x, a.y) < Zombie.RADIUS + Player.RADIUS + 6;
        }
        assertThat(reachedA).isTrue();
    }

    @Test
    void downedPlayerIsRevivedByATeammate() {
        GameSim s = quiet(2);
        Player a = s.player(1), b = s.player(2);
        standAt(a, 300, 340);
        standAt(b, 320, 340);
        s.damagePlayer(b, 1000);
        assertThat(b.state).isEqualTo(Player.State.DOWNED);
        assertThat(s.over).isFalse();
        assertThat(emitted(s, SimEvent.PlayerDowned.class)).isTrue();

        // A downed player can't move or shoot.
        int mag = b.weapon().mag;
        s.step(DT, Map.of(2, PlayerInput.builder().move(1, 0).aim(0).fire().build()));
        assertThat(b.x).isEqualTo(320);
        assertThat(b.weapon().mag).isEqualTo(mag);

        idle(s, 1);
        assertThat(a.interaction).isEqualTo(new Interaction.Revive(b));

        // Letting go part way resets the progress (and bleed-out continues meanwhile).
        step(s, Map.of(1, holdInteract()), 60);
        assertThat(b.reviveProgress).isGreaterThan(0.9);
        double bleed = b.bleedout;
        idle(s, 1);
        assertThat(b.reviveProgress).isZero();
        assertThat(b.bleedout).isLessThan(bleed);

        s.events.clear();
        step(s, Map.of(1, holdInteract()), (int) (60 * Player.REVIVE_TIME) + 2);
        assertThat(b.state).isEqualTo(Player.State.ALIVE);
        assertThat(b.hp).isEqualTo(b.maxHp() * 0.5);
        assertThat(s.events).contains(new SimEvent.PlayerRevived(2, 1));
    }

    @Test
    void secondWindBeatsGoingDown() {
        GameSim s = quiet(2);
        Player b = s.player(2);
        b.perks.add("secondWind");
        s.damagePlayer(b, 1000);
        assertThat(b.state).isEqualTo(Player.State.ALIVE);
        assertThat(b.hp).isEqualTo(b.maxHp());
        assertThat(s.events).contains(new SimEvent.SecondWind(2));
    }

    @Test
    void bledOutPlayerIsDeadUntilTheNextRound() {
        GameSim s = quiet(2);
        Player b = s.player(2);
        b.economy.points = 1234;
        s.giveWeapon(b, new Weapon(s.defs, s.defs.weapon("shotgun")));
        b.perks.add("rapidFire");
        b.armourLevel = 1;
        b.armour = 50;
        standAt(b, 400, 400);
        s.damagePlayer(b, 1000);
        boolean died = false;
        for (int i = 0; i < 60 * (Player.BLEEDOUT + 1); i++) {
            s.step(DT, Map.of());
            died |= emitted(s, SimEvent.PlayerDied.class);
            s.events.clear();
        }
        assertThat(died).isTrue();
        assertThat(b.state).isEqualTo(Player.State.DEAD);
        assertThat(s.over).isFalse();

        s.rounds.intermission = 0;
        s.step(DT, Map.of());
        assertThat(s.rounds.round).isEqualTo(1);
        assertThat(b.state).isEqualTo(Player.State.ALIVE);
        assertThat(b.hp).isEqualTo(Player.BASE_HP);
        assertThat(b.weapons[0].def.id()).isEqualTo(s.defs.starterWeapon);
        assertThat(b.weapons[1]).isNull();
        assertThat(b.perks).isEmpty();
        assertThat(b.armourLevel).isZero();
        assertThat(b.economy.points).isEqualTo(1234);
        assertThat(SimMath.dist(b.x, b.y, 17 * T + T / 2, 9 * T + T / 2)).isLessThan(40);
        assertThat(emitted(s, SimEvent.PlayerRespawned.class)).isTrue();
    }

    @Test
    void gameOverWhenNobodyIsUp() {
        GameSim s = quiet(3);
        s.damagePlayer(s.player(1), 1000);
        s.damagePlayer(s.player(2), 1000);
        assertThat(s.over).isFalse();
        s.damagePlayer(s.player(3), 1000);
        assertThat(s.over).isTrue();
        assertThat(s.events.stream().filter(e -> e instanceof SimEvent.GameOver).count()).isEqualTo(1);
    }

    @Test
    void leavingCanEndTheGame() {
        GameSim s = quiet(2);
        s.damagePlayer(s.player(1), 1000);
        s.removePlayer(2);
        assertThat(s.over).isTrue();
    }

    @Test
    void onlyTheBoxOwnerCanTakeTheWeapon() {
        GameSim s = quiet(2);
        Player a = s.player(1), b = s.player(2);
        s.openDoor(door(s, "tr"));
        MysteryBox box = s.interactables.stream().filter(MysteryBox.class::isInstance).map(MysteryBox.class::cast).findFirst().orElseThrow();
        a.economy.points = 5000;
        standAt(a, box.standX, box.standY);
        standAt(b, box.standX, box.standY);
        s.step(DT, Map.of(1, interact()));
        assertThat(box.owner).isEqualTo(1);
        idle(s, 60 * 3);
        assertThat(box.state).isEqualTo(MysteryBox.State.READY);

        assertThat(b.interaction).isNull();
        s.step(DT, Map.of(2, interact()));
        assertThat(box.state).isEqualTo(MysteryBox.State.READY);
        assertThat(b.weapons[1]).isNull();

        String shown = box.shown;
        s.step(DT, Map.of(1, interact()));
        assertThat(a.weapons[1].def.id()).isEqualTo(shown);
        assertThat(box.state).isEqualTo(MysteryBox.State.CLOSED);
        assertThat(box.owner).isEqualTo(-1);
    }

    @Test
    void powerUpsAreShared() {
        GameSim s = quiet(3);
        Player a = s.player(1), b = s.player(2), c = s.player(3);
        standAt(b, 500, 400);
        standAt(c, 200, 200);
        b.weapon().mag = 0;
        b.weapon().reserve = 0;

        // Anyone up can pick one up.
        s.powerUps.drops.add(new PowerUps.Drop("ammo", b.x, b.y, 10));
        idle(s, 1);
        assertThat(b.weapon().isFull()).isTrue();
        assertThat(s.events).contains(new SimEvent.PowerUp(2, "ammo"));

        // Detonation: the kills are the picker's, the bonus goes to everyone still in the game.
        s.damagePlayer(c, 1000);
        for (int i = 0; i < 3; i++) zombie(s, 700, 300 + i * 30, 1000, 0);
        s.applyPowerUp(a, "nuke");
        int bonus = s.defs.points.nuke();
        assertThat(a.economy.points).isEqualTo(500 + bonus);
        assertThat(b.economy.points).isEqualTo(500 + bonus);
        assertThat(c.economy.points).isEqualTo(500 + bonus);
        assertThat(a.kills).isEqualTo(3);
        assertThat(b.kills).isZero();
    }

    @Test
    void zombieCountScalesWithPartySize() {
        for (int r = 1; r <= 30; r++) {
            assertThat(RoundManager.zombieCount(r, 1)).isEqualTo(RoundManager.zombieCount(r));
        }
        assertThat(RoundManager.zombieCount(1, 2)).isEqualTo(9);
        assertThat(RoundManager.zombieCount(1, 4)).isEqualTo(15);
        assertThat(RoundManager.maxAlive(1)).isEqualTo(RoundManager.MAX_ALIVE);
        assertThat(RoundManager.maxAlive(4)).isEqualTo(RoundManager.MAX_ALIVE + 18);

        GameSim s = quiet(3);
        s.rounds.intermission = 0;
        s.step(DT, Map.of());
        assertThat(s.rounds.round).isEqualTo(1);
        assertThat(s.rounds.toSpawn).isEqualTo(12);
    }

    /** How the server will send them: a field declared as {@code List<SimEvent>}. */
    record EventsMessage(List<SimEvent> events) {}

    @Test
    void eventsSerializeWithTheClientTypeNames() {
        JsonMapper json = JsonMapper.builder().build();
        var msg = new EventsMessage(List.of(new SimEvent.ZombieHit(1, 7, 1.5, 2, 0.25, 10), new SimEvent.GameOver(), new SimEvent.Reload(2)));
        assertThat(json.writeValueAsString(msg)).isEqualTo(
                "{\"events\":[{\"type\":\"zombieHit\",\"player\":1,\"zombie\":7,\"x\":1.5,\"y\":2.0,\"angle\":0.25,\"points\":10},"
                        + "{\"type\":\"gameOver\"},{\"type\":\"reload\",\"player\":2}]}");
    }

    // ------------------------------------------------------------- bot runs

    /** The solo bot, but it goes to revive a downed teammate first. */
    private static PlayerInput coopBot(GameSim s, Player p) {
        if (!p.alive()) return PlayerInput.NONE;
        for (Player o : s.players) {
            if (o == p || o.state != Player.State.DOWNED) continue;
            double dx = o.x - p.x, dy = o.y - p.y;
            PlayerInput.Builder in = PlayerInput.builder();
            if (Math.hypot(dx, dy) > 20) in.move((int) Math.signum(Math.round(dx / 8)), (int) Math.signum(Math.round(dy / 8)));
            in.interactHeld = true;
            return in.build();
        }
        return GameSimTest.bot(s, p);
    }

    private static int roundsSurvived(int players, long seed) {
        GameSim s = new GameSim(TestMaps.load("house"), seed);
        for (int i = 1; i <= players; i++) s.addPlayer(i, "bot" + i);
        Map<Integer, PlayerInput> inputs = new HashMap<>();
        for (int i = 0; i < 60 * 900 && !s.over && s.rounds.round < 10; i++) {
            for (Player p : s.players) inputs.put(p.id, coopBot(s, p));
            s.step(DT, inputs);
            s.events.clear();
        }
        return s.rounds.round;
    }

    @Test
    void twoBotsLastAtLeastAsLongAsOne() {
        int solo = 0, duo = 0;
        for (long seed = 1; seed <= 5; seed++) {
            solo += roundsSurvived(1, seed);
            duo += roundsSurvived(2, seed);
        }
        System.out.printf("bot rounds over 5 seeds: solo %d, duo %d%n", solo, duo);
        assertThat(duo).isGreaterThanOrEqualTo(solo);
    }
}
