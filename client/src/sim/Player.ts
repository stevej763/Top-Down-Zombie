import { dist } from '../core/math';
import { KNIFE, PERK_EFFECTS, STARTER_WEAPON, WEAPONS, type PerkId, type WeaponId } from './defs';
import type { GameSim, Interaction } from './GameSim';
import type { PlayerInput } from './input';
import { MAX_PLANKS } from './Barricade';
import { Tile, type TileType } from './TileMap';
import { Weapon } from './Weapon';

const playerSolid = (t: TileType) => t !== Tile.Floor;
const REBUILD_RANGE = 54;
const REBUILD_INTERVAL = 0.45;
const REGEN_DELAY = 4;
const REGEN_RATE = 40;

export class Player {
  static readonly RADIUS = 12;
  static readonly SPEED = 165;
  static readonly BASE_HP = 100;

  hp = Player.BASE_HP;
  aim = 0;
  weapons: (Weapon | null)[] = [new Weapon(WEAPONS[STARTER_WEAPON]), null];
  slot = 0;
  perks = new Set<PerkId>();
  armour = 0;
  armourLevel = 0;
  sinceHit = 99;
  /** Seconds of invulnerability left (after Second Wind). */
  invuln = 0;
  knifeCooldown = 0;
  /** What E would do right now, if anything. */
  interaction: Interaction = null;
  private rebuildTimer = 0;

  constructor(public x: number, public y: number) {}

  get weapon(): Weapon {
    return this.weapons[this.slot]!;
  }

  get otherWeapon(): Weapon | null {
    return this.weapons[1 - this.slot];
  }

  get maxHp(): number {
    return this.perks.has('toughHide') ? PERK_EFFECTS.toughHideMaxHp : Player.BASE_HP;
  }

  get reloadMult(): number {
    return this.perks.has('quickHands') ? PERK_EFFECTS.quickHandsReloadMult : 1;
  }

  get fireIntervalMult(): number {
    return this.perks.has('rapidFire') ? PERK_EFFECTS.rapidFireIntervalMult : 1;
  }

  findWeapon(id: WeaponId): Weapon | null {
    return this.weapons.find((w) => w?.def.id === id) ?? null;
  }

  switchTo(slot: number): void {
    if (slot === this.slot || !this.weapons[slot]) return;
    this.weapon.cancelReload();
    this.slot = slot;
  }

  update(dt: number, inp: PlayerInput, sim: GameSim): void {
    const mx = Math.sign(inp.moveX);
    const my = Math.sign(inp.moveY);
    if (mx || my) {
      const l = Math.hypot(mx, my);
      this.x += (mx / l) * Player.SPEED * dt;
      this.y += (my / l) * Player.SPEED * dt;
    }
    sim.map.collideCircle(this, Player.RADIUS, playerSolid);

    this.aim = inp.aim;

    if (inp.selectSlot === 0 || inp.selectSlot === 1) this.switchTo(inp.selectSlot);
    if (inp.swap) this.switchTo(1 - this.slot);

    for (const w of this.weapons) w?.update(dt);
    const w = this.weapon;
    if (inp.reload) this.reload(sim);

    this.knifeCooldown = Math.max(0, this.knifeCooldown - dt);
    const outOfAmmo = w.mag === 0 && w.reserve === 0;
    // Out of ammo, the fire button knifes instead; holding it keeps slashing.
    const trigger = w.def.auto || outOfAmmo ? inp.fireHeld : inp.firePressed;
    if (inp.knife || (trigger && outOfAmmo)) {
      this.tryKnife(sim);
    } else if (trigger) {
      if (w.mag === 0) this.reload(sim);
      else if (w.canFire()) sim.fire(w);
    }

    this.sinceHit += dt;
    if (this.sinceHit > REGEN_DELAY) this.hp = Math.min(this.maxHp, this.hp + REGEN_RATE * dt);
    this.invuln = Math.max(0, this.invuln - dt);

    this.updateInteraction(dt, inp, sim);
  }

  private reload(sim: GameSim): void {
    if (this.weapon.startReload(this.reloadMult)) sim.emit({ type: 'reload' });
  }

  private tryKnife(sim: GameSim): void {
    if (this.knifeCooldown > 0) return;
    this.knifeCooldown = KNIFE.cooldown;
    sim.knife();
  }

  private updateInteraction(dt: number, inp: PlayerInput, sim: GameSim): void {
    let best: Interaction = null;
    let bestD = Infinity;
    for (const b of sim.barricades) {
      const d = dist(this.x, this.y, b.insidePoint.x, b.insidePoint.y);
      if (d < REBUILD_RANGE && d < bestD && b.planks < MAX_PLANKS && !b.climber) {
        best = { kind: 'rebuild', barricade: b };
        bestD = d;
      }
    }
    for (const it of sim.interactables) {
      const d = it.distance(this.x, this.y);
      if (d < it.range && d < bestD && it.usable(sim)) {
        best = { kind: 'use', target: it };
        bestD = d;
      }
    }
    this.interaction = best;

    if (best?.kind === 'rebuild' && inp.interactHeld) {
      this.rebuildTimer += dt;
      if (this.rebuildTimer >= REBUILD_INTERVAL) {
        this.rebuildTimer = 0;
        sim.rebuildPlank(best.barricade);
      }
    } else {
      // Primed so the first plank goes up quickly after pressing E.
      this.rebuildTimer = REBUILD_INTERVAL * 0.6;
    }
    if (best?.kind === 'use' && inp.interactPressed) best.target.use(sim);
  }
}
