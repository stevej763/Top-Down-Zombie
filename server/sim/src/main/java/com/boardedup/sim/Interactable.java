package com.boardedup.sim;

import com.boardedup.sim.Defs.ArmourLevel;
import com.boardedup.sim.Defs.PerkDef;
import com.boardedup.sim.Defs.WeaponDef;
import com.boardedup.sim.map.MapDoc.DoorDef;
import com.boardedup.sim.map.MapDoc.WallSpot;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Buyable things. The client draws and prompts for them by {@link Kind} (view/Level.ts {@code Fixture}). */
public abstract sealed class Interactable {
    public enum Kind { WALL_BUY, PERK, ARMOUR, UPGRADE, BOX, DOOR, POWER }

    public double standX;
    public double standY;
    public double range = 50;

    public abstract Kind kind();

    public double distance(double x, double y) {
        return SimMath.dist(x, y, standX, standY);
    }

    /** Whether pressing E here does anything for this player right now (affordability aside). */
    public boolean usable(GameSim sim, Player p) {
        return true;
    }

    /** Only works once the power is on (see {@link GameSim#power}). */
    public boolean needsPower() {
        return false;
    }

    public abstract void use(GameSim sim, Player p);

    public void update(double dt, GameSim sim) {}

    /** Pay for something, or report that the player can't afford it. */
    static boolean pay(GameSim sim, Player p, int cost) {
        if (p.economy.spend(cost)) return true;
        sim.emit(new SimEvent.Denied(p.id));
        return false;
    }

    public abstract static sealed class WallMounted extends Interactable {
        public final WallSpot spot;

        WallMounted(WallSpot spot) {
            this.spot = spot;
            this.standX = (spot.tx() + spot.nx()) * TileMap.TILE + TileMap.TILE / 2.0;
            this.standY = (spot.ty() + spot.ny()) * TileMap.TILE + TileMap.TILE / 2.0;
        }
    }

    public static final class WallBuy extends WallMounted {
        public final WeaponDef def;

        public WallBuy(WallSpot spot, WeaponDef def) {
            super(spot);
            this.def = def;
        }

        @Override public Kind kind() { return Kind.WALL_BUY; }

        @Override
        public void use(GameSim sim, Player p) {
            Weapon owned = p.findWeapon(def.id());
            if (owned != null) {
                if (owned.isFull() || !pay(sim, p, owned.ammoCost())) return;
                owned.refill();
                sim.emit(new SimEvent.AmmoBought(p.id));
                return;
            }
            if (!pay(sim, p, def.cost())) return;
            sim.giveWeapon(p, new Weapon(sim.defs, def));
        }
    }

    public static final class PerkMachine extends WallMounted {
        public final PerkDef perk;

        public PerkMachine(WallSpot spot, PerkDef perk) {
            super(spot);
            this.perk = perk;
        }

        @Override public Kind kind() { return Kind.PERK; }

        @Override public boolean needsPower() { return true; }

        @Override
        public void use(GameSim sim, Player p) {
            if (p.perks.contains(perk.id()) || !pay(sim, p, perk.cost())) return;
            p.perks.add(perk.id());
            if (perk.id().equals("toughHide")) p.hp = p.maxHp();
            sim.emit(new SimEvent.PerkBought(p.id, perk.id()));
        }
    }

    public static final class ArmourBench extends WallMounted {
        public ArmourBench(WallSpot spot) {
            super(spot);
        }

        @Override public Kind kind() { return Kind.ARMOUR; }

        @Override
        public void use(GameSim sim, Player p) {
            List<ArmourLevel> levels = sim.defs.armourLevels;
            int level = p.armourLevel;
            if (level > 0 && p.armour < levels.get(level).cap()) {
                if (!pay(sim, p, sim.defs.repairCost(level))) return;
            } else if (level < levels.size() - 1) {
                if (!pay(sim, p, levels.get(level + 1).cost())) return;
                p.armourLevel++;
            } else {
                return;
            }
            p.armour = levels.get(p.armourLevel).cap();
            sim.emit(new SimEvent.ArmourBought(p.id, p.armourLevel));
        }
    }

    public static final class UpgradeBench extends WallMounted {
        public UpgradeBench(WallSpot spot) {
            super(spot);
        }

        @Override public Kind kind() { return Kind.UPGRADE; }

        @Override public boolean needsPower() { return true; }

        @Override
        public void use(GameSim sim, Player p) {
            Weapon w = p.weapon();
            if (w.tier >= sim.defs.maxTier || !pay(sim, p, sim.defs.upgrade.cost().get(w.tier + 1))) return;
            w.upgrade();
            sim.emit(new SimEvent.Upgraded(p.id, w.def.id(), w.tier));
        }
    }

    public static final class MysteryBox extends Interactable {
        public enum State { CLOSED, ROLLING, READY }

        private static final double ROLL_TIME = 2.6;
        private static final double OFFER_TIME = 8;

        public final int tx;
        public final int ty;
        public State state = State.CLOSED;
        /** Weapon currently shown above the box. */
        public String shown = "shotgun";
        /** Seconds left in the current state (rolling or ready). */
        public double timer;
        /** Id of the player who paid for the current roll (only they can take it), or -1. */
        public int owner = -1;
        private double tick;

        public MysteryBox(int tx, int ty) {
            this.tx = tx;
            this.ty = ty;
            this.standX = (tx + 1) * TileMap.TILE;
            this.standY = (ty + 1) * TileMap.TILE + TileMap.TILE / 2.0;
            this.range = 56;
        }

        @Override public Kind kind() { return Kind.BOX; }

        @Override public boolean needsPower() { return true; }

        @Override
        public boolean usable(GameSim sim, Player p) {
            return state == State.CLOSED || (state == State.READY && p.id == owner);
        }

        @Override
        public void use(GameSim sim, Player p) {
            if (state == State.CLOSED) {
                if (!pay(sim, p, sim.defs.boxCost)) return;
                state = State.ROLLING;
                owner = p.id;
                timer = ROLL_TIME;
                tick = 0;
            } else if (state == State.READY && p.id == owner) {
                sim.giveWeapon(p, new Weapon(sim.defs, sim.defs.weapon(shown)));
                close();
            }
        }

        private void close() {
            state = State.CLOSED;
            owner = -1;
        }

        @Override
        public void update(double dt, GameSim sim) {
            if (state == State.CLOSED) return;
            timer -= dt;
            if (state == State.ROLLING) {
                tick -= dt;
                // Cycle faster at first, slowing down as it settles.
                if (tick <= 0) {
                    shown = sim.rng.pick(sim.defs.boxPool);
                    tick = 0.06 + (1 - timer / ROLL_TIME) * 0.2;
                    sim.emit(new SimEvent.BoxTick());
                }
                if (timer <= 0) {
                    Set<String> held = new HashSet<>();
                    Player p = sim.player(owner);
                    if (p != null) for (Weapon w : p.weapons) if (w != null) held.add(w.def.id());
                    shown = sim.rng.pick(sim.defs.boxPool.stream().filter(id -> !held.contains(id)).toList());
                    state = State.READY;
                    timer = OFFER_TIME;
                    sim.emit(new SimEvent.BoxReveal(shown));
                }
            } else if (timer <= 0) {
                close();
            }
        }
    }

    public static final class Door extends Interactable {
        public final DoorDef def;
        public boolean open;

        public Door(DoorDef def) {
            this.def = def;
            List<Integer> mid = def.tiles().get(def.tiles().size() / 2);
            this.standX = mid.get(0) * TileMap.TILE + TileMap.TILE / 2.0;
            this.standY = mid.get(1) * TileMap.TILE + TileMap.TILE / 2.0;
            this.range = 56;
        }

        @Override public Kind kind() { return Kind.DOOR; }

        @Override
        public double distance(double x, double y) {
            double best = Double.POSITIVE_INFINITY;
            for (List<Integer> t : def.tiles()) {
                best = Math.min(best, SimMath.dist(x, y, t.get(0) * TileMap.TILE + TileMap.TILE / 2.0, t.get(1) * TileMap.TILE + TileMap.TILE / 2.0));
            }
            return best;
        }

        @Override
        public boolean usable(GameSim sim, Player p) {
            return !open;
        }

        @Override
        public void use(GameSim sim, Player p) {
            if (open || !pay(sim, p, def.cost())) return;
            sim.openDoor(this);
        }
    }

    /** Free to throw; turns the power on for everyone. */
    public static final class PowerSwitch extends WallMounted {
        public PowerSwitch(WallSpot spot) {
            super(spot);
        }

        @Override public Kind kind() { return Kind.POWER; }

        @Override
        public boolean usable(GameSim sim, Player p) {
            return !sim.power;
        }

        @Override
        public void use(GameSim sim, Player p) {
            sim.turnOnPower(p);
        }
    }
}
