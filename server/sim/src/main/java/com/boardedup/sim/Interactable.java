package com.boardedup.sim;

import com.boardedup.sim.Defs.ArmourLevel;
import com.boardedup.sim.Defs.PerkDef;
import com.boardedup.sim.Defs.WeaponDef;
import com.boardedup.sim.map.MapDoc.DoorDef;
import com.boardedup.sim.map.MapDoc.WallSpot;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Buyable things: port of client/src/sim/Interactables.ts. */
public abstract sealed class Interactable {
    public enum Kind { WALL_BUY, PERK, ARMOUR, UPGRADE, BOX, DOOR }

    public double standX;
    public double standY;
    public double range = 50;

    public abstract Kind kind();

    public double distance(double x, double y) {
        return SimMath.dist(x, y, standX, standY);
    }

    /** Whether pressing E here does anything right now (affordability aside). */
    public boolean usable(GameSim sim) {
        return true;
    }

    public abstract void use(GameSim sim);

    public void update(double dt, GameSim sim) {}

    /** Pay for something, or report that the player can't afford it. */
    static boolean pay(GameSim sim, int cost) {
        if (sim.economy.spend(cost)) return true;
        sim.emit(new SimEvent.Denied());
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
        public void use(GameSim sim) {
            Weapon owned = sim.player.findWeapon(def.id());
            if (owned != null) {
                if (owned.isFull() || !pay(sim, owned.ammoCost())) return;
                owned.refill();
                sim.emit(new SimEvent.AmmoBought());
                return;
            }
            if (!pay(sim, def.cost())) return;
            sim.giveWeapon(new Weapon(sim.defs, def));
        }
    }

    public static final class PerkMachine extends WallMounted {
        public final PerkDef perk;

        public PerkMachine(WallSpot spot, PerkDef perk) {
            super(spot);
            this.perk = perk;
        }

        @Override public Kind kind() { return Kind.PERK; }

        @Override
        public void use(GameSim sim) {
            Player p = sim.player;
            if (p.perks.contains(perk.id()) || !pay(sim, perk.cost())) return;
            p.perks.add(perk.id());
            if (perk.id().equals("toughHide")) p.hp = p.maxHp();
            sim.emit(new SimEvent.PerkBought(perk.id()));
        }
    }

    public static final class ArmourBench extends WallMounted {
        public ArmourBench(WallSpot spot) {
            super(spot);
        }

        @Override public Kind kind() { return Kind.ARMOUR; }

        @Override
        public void use(GameSim sim) {
            Player p = sim.player;
            List<ArmourLevel> levels = sim.defs.armourLevels;
            int level = p.armourLevel;
            if (level > 0 && p.armour < levels.get(level).cap()) {
                if (!pay(sim, sim.defs.repairCost(level))) return;
            } else if (level < levels.size() - 1) {
                if (!pay(sim, levels.get(level + 1).cost())) return;
                p.armourLevel++;
            } else {
                return;
            }
            p.armour = levels.get(p.armourLevel).cap();
            sim.emit(new SimEvent.ArmourBought(p.armourLevel));
        }
    }

    public static final class UpgradeBench extends WallMounted {
        public UpgradeBench(WallSpot spot) {
            super(spot);
        }

        @Override public Kind kind() { return Kind.UPGRADE; }

        @Override
        public void use(GameSim sim) {
            Weapon w = sim.player.weapon();
            if (w.tier >= sim.defs.maxTier || !pay(sim, sim.defs.upgrade.cost().get(w.tier + 1))) return;
            w.upgrade();
            sim.emit(new SimEvent.Upgraded(w.def.id(), w.tier));
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
        private double tick;

        public MysteryBox(int tx, int ty) {
            this.tx = tx;
            this.ty = ty;
            this.standX = (tx + 1) * TileMap.TILE;
            this.standY = (ty + 1) * TileMap.TILE + TileMap.TILE / 2.0;
            this.range = 56;
        }

        @Override public Kind kind() { return Kind.BOX; }

        @Override
        public boolean usable(GameSim sim) {
            return state != State.ROLLING;
        }

        @Override
        public void use(GameSim sim) {
            if (state == State.CLOSED) {
                if (!pay(sim, sim.defs.boxCost)) return;
                state = State.ROLLING;
                timer = ROLL_TIME;
                tick = 0;
            } else if (state == State.READY) {
                sim.giveWeapon(new Weapon(sim.defs, sim.defs.weapon(shown)));
                state = State.CLOSED;
            }
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
                    for (Weapon w : sim.player.weapons) if (w != null) held.add(w.def.id());
                    shown = sim.rng.pick(sim.defs.boxPool.stream().filter(id -> !held.contains(id)).toList());
                    state = State.READY;
                    timer = OFFER_TIME;
                    sim.emit(new SimEvent.BoxReveal(shown));
                }
            } else if (timer <= 0) {
                state = State.CLOSED;
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
        public boolean usable(GameSim sim) {
            return !open;
        }

        @Override
        public void use(GameSim sim) {
            if (open || !pay(sim, def.cost())) return;
            sim.openDoor(this);
        }
    }
}
