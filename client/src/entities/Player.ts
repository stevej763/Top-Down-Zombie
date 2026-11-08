import { sound } from '../audio/Sound';
import { dist } from '../core/math';
import type { Game, Interaction } from '../core/Game';
import type { PerkId } from '../systems/Perks';
import { MAX_PLANKS } from '../world/Barricade';
import { Tile, type TileType } from '../world/TileMap';
import { Weapon } from '../weapons/Weapon';
import { KNIFE, WEAPONS, type WeaponId } from '../weapons/WeaponDefs';

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
  weapons: (Weapon | null)[] = [new Weapon(WEAPONS.pistol), null];
  slot = 0;
  perks = new Set<PerkId>();
  armour = 0;
  armourLevel = 0;
  sinceHit = 99;
  hurtFlash = 0;
  /** Seconds of invulnerability left (after Second Wind). */
  invuln = 0;
  /** Muzzle-flash timer. */
  flash = 0;
  knifeCooldown = 0;
  /** Time left in the current knife swing animation. */
  knifeSwing = 0;
  private rebuildTimer = 0;

  constructor(public x: number, public y: number) {}

  get weapon(): Weapon {
    return this.weapons[this.slot]!;
  }

  get otherWeapon(): Weapon | null {
    return this.weapons[1 - this.slot];
  }

  get maxHp(): number {
    return this.perks.has('toughHide') ? 250 : Player.BASE_HP;
  }

  get reloadMult(): number {
    return this.perks.has('quickHands') ? 0.5 : 1;
  }

  get fireIntervalMult(): number {
    return this.perks.has('rapidFire') ? 0.75 : 1;
  }

  findWeapon(id: WeaponId): Weapon | null {
    return this.weapons.find((w) => w?.def.id === id) ?? null;
  }

  switchTo(slot: number): void {
    if (slot === this.slot || !this.weapons[slot]) return;
    this.weapon.cancelReload();
    this.slot = slot;
  }

  update(dt: number, game: Game): void {
    const inp = game.input;

    let mx = 0;
    let my = 0;
    if (inp.isDown('KeyA', 'ArrowLeft')) mx--;
    if (inp.isDown('KeyD', 'ArrowRight')) mx++;
    if (inp.isDown('KeyW', 'ArrowUp')) my--;
    if (inp.isDown('KeyS', 'ArrowDown')) my++;
    if (mx || my) {
      const l = Math.hypot(mx, my);
      this.x += (mx / l) * Player.SPEED * dt;
      this.y += (my / l) * Player.SPEED * dt;
    }
    game.map.collideCircle(this, Player.RADIUS, playerSolid);

    this.aim = Math.atan2(game.mouseWorld.y - this.y, game.mouseWorld.x - this.x);

    if (inp.wasPressed('Digit1')) this.switchTo(0);
    if (inp.wasPressed('Digit2')) this.switchTo(1);
    if (inp.wasPressed('KeyQ') || inp.wheel !== 0) this.switchTo(1 - this.slot);

    for (const w of this.weapons) w?.update(dt);
    const w = this.weapon;
    if (inp.wasPressed('KeyR') && w.startReload(this.reloadMult)) sound.reload();

    this.knifeCooldown = Math.max(0, this.knifeCooldown - dt);
    this.knifeSwing = Math.max(0, this.knifeSwing - dt);
    const outOfAmmo = w.mag === 0 && w.reserve === 0;
    // Out of ammo, the fire button knifes instead; holding it keeps slashing.
    const trigger = w.def.auto || outOfAmmo
      ? inp.isDown('Space') || inp.mouseDown
      : inp.wasPressed('Space') || inp.mousePressed;
    if (inp.wasPressed('KeyF', 'KeyV') || (trigger && outOfAmmo)) {
      this.tryKnife(game);
    } else if (trigger) {
      if (w.mag === 0) {
        if (w.startReload(this.reloadMult)) sound.reload();
      } else if (w.canFire()) {
        game.fire(w);
      }
    }

    this.sinceHit += dt;
    if (this.sinceHit > REGEN_DELAY) this.hp = Math.min(this.maxHp, this.hp + REGEN_RATE * dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
    this.invuln = Math.max(0, this.invuln - dt);
    this.flash = Math.max(0, this.flash - dt);

    this.updateInteraction(dt, game);
  }

  private tryKnife(game: Game): void {
    if (this.knifeCooldown > 0) return;
    this.knifeCooldown = KNIFE.cooldown;
    this.knifeSwing = KNIFE.swing;
    game.knife();
  }

  private updateInteraction(dt: number, game: Game): void {
    let best: Interaction = null;
    let bestD = Infinity;
    for (const b of game.barricades) {
      const d = dist(this.x, this.y, b.insidePoint.x, b.insidePoint.y);
      if (d < REBUILD_RANGE && d < bestD && b.planks < MAX_PLANKS && !b.climber) {
        best = { kind: 'rebuild', barricade: b };
        bestD = d;
      }
    }
    for (const it of game.interactables) {
      const d = it.distance(this.x, this.y);
      if (d < it.range && d < bestD && it.prompt(game)) {
        best = { kind: 'use', target: it };
        bestD = d;
      }
    }
    game.interaction = best;

    const inp = game.input;
    if (best?.kind === 'rebuild' && inp.isDown('KeyE')) {
      this.rebuildTimer += dt;
      if (this.rebuildTimer >= REBUILD_INTERVAL) {
        this.rebuildTimer = 0;
        game.rebuildPlank(best.barricade);
      }
    } else {
      // Primed so the first plank goes up quickly after pressing E.
      this.rebuildTimer = REBUILD_INTERVAL * 0.6;
    }
    if (best?.kind === 'use' && inp.wasPressed('KeyE')) best.target.use(game);
  }
}
