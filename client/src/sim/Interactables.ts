import { dist } from '../core/math';
import {
  ARMOUR_LEVELS, BOX_COST, BOX_POOL, MAX_TIER, PERKS, repairCost, UPGRADE, WEAPONS,
  type PerkDef, type PerkId, type WeaponDef, type WeaponId,
} from './defs';
import type { GameSim } from './GameSim';
import type { DoorDef, WallSpot } from './MapData';
import { TILE } from './TileMap';
import { Weapon } from './Weapon';

/**
 * Buyable things. Gameplay only: prompt text is in ui/prompts.ts and drawing in render/.
 * `kind` lets the client pick those without instanceof chains.
 */
export abstract class Interactable {
  abstract readonly kind: 'wallBuy' | 'perk' | 'armour' | 'upgrade' | 'box' | 'door';
  abstract readonly standX: number;
  abstract readonly standY: number;
  range = 50;

  distance(x: number, y: number): number {
    return dist(x, y, this.standX, this.standY);
  }

  /** Whether pressing E here does anything right now (affordability aside). */
  usable(_sim: GameSim): boolean {
    return true;
  }

  abstract use(sim: GameSim): void;
  update(_dt: number, _sim: GameSim): void {}
}

/** Pay for something, or report that the player can't afford it. */
function pay(sim: GameSim, cost: number): boolean {
  if (sim.economy.spend(cost)) return true;
  sim.emit({ type: 'denied' });
  return false;
}

abstract class WallMounted extends Interactable {
  readonly standX: number;
  readonly standY: number;

  constructor(readonly spot: WallSpot) {
    super();
    this.standX = (spot.tx + spot.nx) * TILE + TILE / 2;
    this.standY = (spot.ty + spot.ny) * TILE + TILE / 2;
  }
}

export class WallBuy extends WallMounted {
  readonly kind = 'wallBuy';

  constructor(spot: WallSpot, readonly def: WeaponDef) {
    super(spot);
  }

  use(sim: GameSim): void {
    const owned = sim.player.findWeapon(this.def.id);
    if (owned) {
      if (owned.isFull || !pay(sim, owned.ammoCost)) return;
      owned.refill();
      sim.emit({ type: 'ammoBought' });
      return;
    }
    if (!pay(sim, this.def.cost)) return;
    sim.giveWeapon(new Weapon(this.def));
  }
}

export class PerkMachine extends WallMounted {
  readonly kind = 'perk';
  readonly perk: PerkDef;

  constructor(spot: WallSpot, perkId: PerkId) {
    super(spot);
    this.perk = PERKS[perkId];
  }

  use(sim: GameSim): void {
    const p = sim.player;
    if (p.perks.has(this.perk.id) || !pay(sim, this.perk.cost)) return;
    p.perks.add(this.perk.id);
    if (this.perk.id === 'toughHide') p.hp = p.maxHp;
    sim.emit({ type: 'perkBought', perk: this.perk.id });
  }
}

export class ArmourBench extends WallMounted {
  readonly kind = 'armour';

  use(sim: GameSim): void {
    const p = sim.player;
    const level = p.armourLevel;
    if (level > 0 && p.armour < ARMOUR_LEVELS[level].cap) {
      if (!pay(sim, repairCost(level))) return;
    } else if (level < ARMOUR_LEVELS.length - 1) {
      if (!pay(sim, ARMOUR_LEVELS[level + 1].cost)) return;
      p.armourLevel++;
    } else {
      return;
    }
    p.armour = ARMOUR_LEVELS[p.armourLevel].cap;
    sim.emit({ type: 'armourBought', level: p.armourLevel });
  }
}

export class UpgradeBench extends WallMounted {
  readonly kind = 'upgrade';

  use(sim: GameSim): void {
    const w = sim.player.weapon;
    if (w.tier >= MAX_TIER || !pay(sim, UPGRADE.cost[w.tier + 1])) return;
    w.upgrade();
    sim.emit({ type: 'upgraded', weapon: w.def.id, tier: w.tier });
  }
}

const BOX_ROLL_TIME = 2.6;
const BOX_OFFER_TIME = 8;

export class MysteryBox extends Interactable {
  readonly kind = 'box';
  readonly standX: number;
  readonly standY: number;
  state: 'closed' | 'rolling' | 'ready' = 'closed';
  /** Weapon currently shown above the box. */
  shown: WeaponId = 'shotgun';
  /** Seconds left in the current state (rolling or ready). */
  timer = 0;
  private tick = 0;

  constructor(readonly tx: number, readonly ty: number) {
    super();
    this.standX = (tx + 1) * TILE;
    this.standY = (ty + 1) * TILE + TILE / 2;
    this.range = 56;
  }

  usable(): boolean {
    return this.state !== 'rolling';
  }

  use(sim: GameSim): void {
    if (this.state === 'closed') {
      if (!pay(sim, BOX_COST)) return;
      this.state = 'rolling';
      this.timer = BOX_ROLL_TIME;
      this.tick = 0;
    } else if (this.state === 'ready') {
      sim.giveWeapon(new Weapon(WEAPONS[this.shown]));
      this.state = 'closed';
    }
  }

  update(dt: number, sim: GameSim): void {
    if (this.state === 'closed') return;
    this.timer -= dt;
    if (this.state === 'rolling') {
      this.tick -= dt;
      // Cycle faster at first, slowing down as it settles.
      if (this.tick <= 0) {
        this.shown = sim.rng.pick(BOX_POOL);
        this.tick = 0.06 + (1 - this.timer / BOX_ROLL_TIME) * 0.2;
        sim.emit({ type: 'boxTick' });
      }
      if (this.timer <= 0) {
        const held = new Set(sim.player.weapons.map((w) => w?.def.id));
        this.shown = sim.rng.pick(BOX_POOL.filter((id) => !held.has(id)));
        this.state = 'ready';
        this.timer = BOX_OFFER_TIME;
        sim.emit({ type: 'boxReveal', weapon: this.shown });
      }
    } else if (this.timer <= 0) {
      this.state = 'closed';
    }
  }
}

export class Door extends Interactable {
  readonly kind = 'door';
  readonly standX: number;
  readonly standY: number;
  open = false;

  constructor(readonly def: DoorDef) {
    super();
    const mid = def.tiles[Math.floor(def.tiles.length / 2)];
    this.standX = mid[0] * TILE + TILE / 2;
    this.standY = mid[1] * TILE + TILE / 2;
    this.range = 56;
  }

  distance(x: number, y: number): number {
    let best = Infinity;
    for (const [tx, ty] of this.def.tiles) best = Math.min(best, dist(x, y, tx * TILE + TILE / 2, ty * TILE + TILE / 2));
    return best;
  }

  usable(): boolean {
    return !this.open;
  }

  use(sim: GameSim): void {
    if (this.open || !pay(sim, this.def.cost)) return;
    sim.openDoor(this);
  }
}
