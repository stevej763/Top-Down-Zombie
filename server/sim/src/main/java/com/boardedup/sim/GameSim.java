package com.boardedup.sim;

import com.boardedup.sim.Interactable.ArmourBench;
import com.boardedup.sim.Interactable.Door;
import com.boardedup.sim.Interactable.MysteryBox;
import com.boardedup.sim.Interactable.PerkMachine;
import com.boardedup.sim.Interactable.UpgradeBench;
import com.boardedup.sim.Interactable.WallBuy;
import com.boardedup.sim.map.MapDoc;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * The whole game simulation: world state plus {@link #step}. A port of client/src/sim/GameSim.ts;
 * keep the two in step. Not thread-safe: one thread steps a sim.
 */
public final class GameSim {
    private static final String TILE_CHARS = "._#WCD";

    public final Defs defs;
    public final String mapId;
    public final TileMap map;
    public final List<Barricade> barricades;
    public final List<Interactable> interactables = new ArrayList<>();
    public final Set<String> openRooms = new HashSet<>();
    public final Player player;
    public final List<Zombie> zombies = new ArrayList<>();
    public final RoundManager rounds = new RoundManager();
    public final FlowField flow;
    public final Economy economy;
    public final PowerUps powerUps = new PowerUps();
    public final Rng rng;
    public int kills;
    public double time;
    public boolean over;
    /** Filled during {@link #step}; the caller takes and clears it. */
    public final List<SimEvent> events = new ArrayList<>();
    private int lastId;

    public GameSim(MapDoc doc, long seed) {
        this(Defs.standard(), doc, seed);
    }

    public GameSim(Defs defs, MapDoc doc, long seed) {
        this.defs = defs;
        this.mapId = doc.id();
        int[] tiles = new int[doc.width() * doc.height()];
        for (int y = 0; y < doc.height(); y++) {
            String row = doc.tiles().get(y);
            for (int x = 0; x < doc.width(); x++) {
                int t = TILE_CHARS.indexOf(row.charAt(x));
                tiles[y * doc.width() + x] = t < 0 ? Tile.WALL : t;
            }
        }
        this.map = new TileMap(doc.width(), doc.height(), tiles);
        this.barricades = doc.windows().stream().map(Barricade::new).toList();
        for (var wb : doc.wallBuys()) {
            interactables.add(new WallBuy(new MapDoc.WallSpot(wb.tx(), wb.ty(), wb.nx(), wb.ny()), defs.weapon(wb.weapon())));
        }
        for (var p : doc.perks()) {
            interactables.add(new PerkMachine(new MapDoc.WallSpot(p.tx(), p.ty(), p.nx(), p.ny()), defs.perks.get(p.perk())));
        }
        interactables.add(new ArmourBench(doc.armour()));
        interactables.add(new UpgradeBench(doc.upgrade()));
        interactables.add(new MysteryBox(doc.box().tx(), doc.box().ty()));
        for (var d : doc.doors()) interactables.add(new Door(d));
        openRooms.add(doc.startRoom());
        double t = TileMap.TILE;
        this.player = new Player(defs, doc.playerStart().tx() * t + t / 2, doc.playerStart().ty() * t + t / 2);
        this.flow = new FlowField(map, tile -> tile == Tile.FLOOR);
        this.economy = new Economy(defs);
        this.rng = new Rng(seed);
    }

    public void emit(SimEvent e) {
        events.add(e);
    }

    public int nextId() {
        return ++lastId;
    }

    public void step(double dt, PlayerInput input) {
        if (over) return;
        time += dt;
        economy.multiplier = powerUps.doublePoints > 0 ? 2 : 1;

        player.update(dt, input, this);
        flow.update(player.x, player.y);
        rounds.update(dt, this);
        for (Interactable it : interactables) it.update(dt, this);
        for (Zombie z : zombies) z.update(dt, this);
        separate();
        zombies.removeIf(z -> z.dead);
        powerUps.update(dt, this);
    }

    /** Push overlapping zombies apart, and the player out of zombies. */
    private void separate() {
        List<Zombie> zs = zombies;
        double minD = Zombie.RADIUS * 2;
        for (int i = 0; i < zs.size(); i++) {
            Zombie a = zs.get(i);
            if (a.state == Zombie.State.CLIMBING) continue;
            for (int j = i + 1; j < zs.size(); j++) {
                Zombie b = zs.get(j);
                if (b.state == Zombie.State.CLIMBING || (a.state == Zombie.State.INSIDE) != (b.state == Zombie.State.INSIDE)) continue;
                double dx = b.x - a.x;
                double dy = b.y - a.y;
                double d2 = dx * dx + dy * dy;
                if (d2 >= minD * minD || d2 == 0) continue;
                double d = Math.sqrt(d2);
                double push = (minD - d) / 2 / d;
                a.x -= dx * push;
                a.y -= dy * push;
                b.x += dx * push;
                b.y += dy * push;
            }
        }

        Player p = player;
        double minPD = Zombie.RADIUS + Player.RADIUS;
        for (Zombie z : zs) {
            if (z.state != Zombie.State.INSIDE) continue;
            double dx = p.x - z.x;
            double dy = p.y - z.y;
            double d = Math.hypot(dx, dy);
            if (d >= minPD || d == 0) continue;
            double overlap = minPD - d;
            p.x += (dx / d) * overlap * 0.7;
            p.y += (dy / d) * overlap * 0.7;
            z.x -= (dx / d) * overlap * 0.3;
            z.y -= (dy / d) * overlap * 0.3;
        }

        map.collideCircle(p, Player.RADIUS, t -> t != Tile.FLOOR);
        for (Zombie z : zs) {
            if (z.state != Zombie.State.CLIMBING) map.collideCircle(z, Zombie.RADIUS, z.solid());
        }
    }

    // --------------------------------------------------------------- actions

    void fire(Weapon w) {
        Player p = player;
        Defs.WeaponDef def = w.def;
        w.mag--;
        w.cooldown = def.fireInterval() * p.fireIntervalMult();

        double base = AimAssist.apply(this, p.x, p.y, p.aim, def.range());
        for (int i = 0; i < def.pellets(); i++) {
            traceShot(p.x, p.y, base + rng.range(-def.spread() / 2, def.spread() / 2), w);
        }
        emit(new SimEvent.Shot(def.id(), w.tier, p.x, p.y, p.aim));
    }

    private record Hit(Zombie z, double t) {}

    /** Hitscan from the player's centre. */
    private void traceShot(double ox, double oy, double angle, Weapon w) {
        Defs.WeaponDef def = w.def;
        double dx = Math.cos(angle);
        double dy = Math.sin(angle);
        double wallD = map.rayWall(ox, oy, dx, dy, def.range());

        List<Hit> hits = new ArrayList<>();
        for (Zombie z : zombies) {
            if (z.dead) continue;
            double t = SimMath.rayCircle(ox, oy, dx, dy, z.x, z.y, Zombie.RADIUS);
            if (t >= 0 && t <= wallD) hits.add(new Hit(z, t));
        }
        hits.sort(Comparator.comparingDouble(Hit::t));

        double end = wallD;
        int pens = def.penetration();
        for (Hit h : hits) {
            // Headshot: the ray passes close to the centre line and the zombie is facing the shooter.
            double offset = Math.abs((h.z.x - ox) * dy - (h.z.y - oy) * dx);
            boolean facingShooter = Math.abs(SimMath.angleDiff(h.z.facing, Math.atan2(oy - h.z.y, ox - h.z.x))) < 1.2;
            boolean head = offset < Zombie.RADIUS * 0.35 && facingShooter;
            hitZombie(h.z, w.damage(), ox + dx * h.t, oy + dy * h.t, angle, head, head ? defs.points.headshotKill() : defs.points.kill());
            if (--pens <= 0) {
                end = h.t;
                break;
            }
        }

        double ex = ox + dx * end;
        double ey = oy + dy * end;
        boolean hitWall = def.splash() == null && end == wallD && wallD < def.range();
        emit(new SimEvent.Tracer(def.id(), w.tier, ox, oy, ex, ey, hitWall));
        if (def.splash() != null) explode(ex, ey, def.splash().radius(), def.splash().damage() * (w.damage() / def.damage()));
    }

    /** Slash the closest zombie inside the knife arc. */
    void knife() {
        Player p = player;
        Defs.Knife k = defs.knife;
        double reach = Player.RADIUS + k.reach() + Zombie.RADIUS;
        Zombie target = null;
        double bestD = Double.POSITIVE_INFINITY;
        for (Zombie z : zombies) {
            if (z.dead || z.state == Zombie.State.CLIMBING) continue;
            double d = SimMath.dist(p.x, p.y, z.x, z.y);
            if (d > reach || d >= bestD) continue;
            if (Math.abs(SimMath.angleDiff(p.aim, Math.atan2(z.y - p.y, z.x - p.x))) > k.arc() / 2) continue;
            if (!map.hasLOS(p.x, p.y, z.x, z.y)) continue;
            target = z;
            bestD = d;
        }
        emit(new SimEvent.Knife(target != null));
        if (target == null) return;
        double angle = Math.atan2(target.y - p.y, target.x - p.x);
        hitZombie(target, k.damage(), target.x, target.y, angle, false, defs.points.knifeKill());
        if (!target.dead && target.state == Zombie.State.INSIDE) {
            target.x += Math.cos(angle) * 8;
            target.y += Math.sin(angle) * 8;
        }
    }

    private void explode(double x, double y, double radius, double damage) {
        for (Zombie z : zombies) {
            if (z.dead) continue;
            double d = SimMath.dist(x, y, z.x, z.y);
            if (d < radius + Zombie.RADIUS) {
                hitZombie(z, damage * (1 - 0.5 * Math.min(1, d / radius)), z.x, z.y, Math.atan2(z.y - y, z.x - x), false,
                        defs.points.kill());
            }
        }
        emit(new SimEvent.Explosion(x, y, radius));
    }

    private void hitZombie(Zombie z, double damage, double hx, double hy, double angle, boolean head, int killPoints) {
        if (z.dead) return;
        z.hp -= powerUps.instakill > 0 ? z.hp : head ? damage * 1.5 : damage;
        if (z.state == Zombie.State.INSIDE) {
            z.x += Math.cos(angle) * 2;
            z.y += Math.sin(angle) * 2;
        }
        int points = z.hp <= 0 ? 0 : economy.award(defs.points.hit());
        emit(new SimEvent.ZombieHit(z.id, hx, hy, angle, points));
        if (z.hp <= 0) killZombie(z, killPoints);
    }

    private void killZombie(Zombie z, int points) {
        z.dead = true;
        if (z.window.climber == z) z.window.climber = null;
        kills++;
        int awarded = points > 0 ? economy.award(points) : 0;
        emit(new SimEvent.ZombieKilled(z.id, z.x, z.y, awarded));
        // Only drop power-ups where the player can reach them.
        if (z.state == Zombie.State.INSIDE) powerUps.maybeDrop(this, z.x, z.y);
    }

    public void applyPowerUp(String id) {
        switch (id) {
            case "ammo" -> {
                for (Weapon w : player.weapons) if (w != null) w.refill();
            }
            case "instakill" -> powerUps.instakill = defs.powerUpTuning.duration();
            case "double" -> powerUps.doublePoints = defs.powerUpTuning.duration();
            case "nuke" -> {
                for (Zombie z : zombies) if (!z.dead) killZombie(z, 0);
                economy.award(defs.points.nuke());
            }
            default -> throw new IllegalArgumentException("Unknown power-up " + id);
        }
        emit(new SimEvent.PowerUp(id));
    }

    public void damagePlayer(double amount) {
        Player p = player;
        if (p.invuln > 0) return;
        if (p.armour > 0) {
            double absorbed = Math.min(p.armour, amount * defs.armourAbsorb);
            p.armour -= absorbed;
            amount -= absorbed;
        }
        p.hp -= amount;
        p.sinceHit = 0;
        emit(new SimEvent.PlayerHurt(p.x, p.y));
        if (p.hp > 0) return;

        if (p.perks.contains("secondWind")) {
            secondWind();
        } else {
            p.hp = 0;
            over = true;
            emit(new SimEvent.GameOver());
        }
    }

    /** Get back up: lose every perk, full health, brief invulnerability, zombies shoved back. */
    private void secondWind() {
        Player p = player;
        p.perks.clear();
        p.hp = p.maxHp();
        p.invuln = defs.perkEffects.secondWindInvuln();
        for (Zombie z : zombies) {
            if (z.state != Zombie.State.INSIDE) continue;
            double d = SimMath.dist(p.x, p.y, z.x, z.y);
            if (d < 140 && d > 0) {
                z.x += ((z.x - p.x) / d) * 60;
                z.y += ((z.y - p.y) / d) * 60;
                map.collideCircle(z, Zombie.RADIUS, z.solid());
            }
        }
        emit(new SimEvent.SecondWind());
    }

    void tearPlank(Barricade b) {
        if (!b.tear()) return;
        emit(new SimEvent.PlankTorn(b.center.x(), b.center.y()));
    }

    void rebuildPlank(Barricade b) {
        if (!b.rebuild()) return;
        int points = 0;
        if (economy.rebuildLeft >= defs.points.plank()) {
            economy.rebuildLeft -= defs.points.plank();
            points = economy.award(defs.points.plank());
        }
        emit(new SimEvent.PlankPlaced(b.center.x(), b.center.y(), points));
    }

    /** Put a weapon in the empty slot, or replace the one in hand. */
    public void giveWeapon(Weapon w) {
        Player p = player;
        int empty = p.weapons[0] == null ? 0 : p.weapons[1] == null ? 1 : -1;
        int slot = empty >= 0 ? empty : p.slot;
        p.weapon().cancelReload();
        p.weapons[slot] = w;
        p.slot = slot;
        emit(new SimEvent.WeaponGiven(w.def.id(), w.tier));
    }

    public void openDoor(Door door) {
        door.open = true;
        for (List<Integer> t : door.def.tiles()) map.set(t.get(0), t.get(1), Tile.FLOOR);
        openRooms.addAll(door.def.rooms());
        flow.invalidate();
        emit(new SimEvent.DoorOpened(door.standX, door.standY));
    }
}
