import type { WeaponDef } from './WeaponDefs';

export const MAX_TIER = 2;
/** Cost to reach each tier at the upgrade bench. */
export const UPGRADE_COST = [0, 3000, 6000];
const TIER_DAMAGE = [1, 1.75, 2.75];
const TIER_AMMO = [1, 1.5, 2];
const TIER_SUFFIX = ['', ' Mk II', ' Mk III'];
export interface Halo {
  /** "r, g, b" */
  color: string;
  width: number;
}
/** Glow around an upgraded weapon's tracers. */
const TIER_HALO: (Halo | null)[] = [null, { color: '170, 110, 255', width: 7 }, { color: '230, 140, 255', width: 10 }];

export class Weapon {
  tier = 0;
  mag: number;
  reserve: number;
  cooldown = 0;
  reloadTimer = 0;
  private reloadDuration = 1;

  constructor(readonly def: WeaponDef) {
    this.mag = this.magSize;
    this.reserve = this.reserveSize;
  }

  get name(): string {
    return this.def.name + TIER_SUFFIX[this.tier];
  }

  get damage(): number {
    return this.def.damage * TIER_DAMAGE[this.tier];
  }

  get magSize(): number {
    return Math.round(this.def.mag * TIER_AMMO[this.tier]);
  }

  get reserveSize(): number {
    return Math.round(this.def.reserve * TIER_AMMO[this.tier]);
  }

  /** Upgraded weapons cost more to refill at the wall. */
  get ammoCost(): number {
    return this.def.ammoCost * (1 + this.tier * 2);
  }

  get halo(): Halo | null {
    return TIER_HALO[this.tier];
  }

  /** 0..1 through the current reload. */
  get reloadProgress(): number {
    return this.reloading ? 1 - this.reloadTimer / this.reloadDuration : 0;
  }

  get reloading(): boolean {
    return this.reloadTimer > 0;
  }

  get isFull(): boolean {
    return this.mag === this.magSize && this.reserve === this.reserveSize;
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.finishReload();
    }
  }

  canFire(): boolean {
    return this.cooldown <= 0 && !this.reloading && this.mag > 0;
  }

  startReload(timeMult = 1): boolean {
    if (this.reloading || this.mag >= this.magSize || this.reserve <= 0) return false;
    this.reloadTimer = this.reloadDuration = this.def.reloadTime * timeMult;
    return true;
  }

  cancelReload(): void {
    this.reloadTimer = 0;
  }

  refill(): void {
    this.mag = this.magSize;
    this.reserve = this.reserveSize;
    this.reloadTimer = 0;
  }

  upgrade(): void {
    if (this.tier >= MAX_TIER) return;
    this.tier++;
    this.refill();
  }

  private finishReload(): void {
    const n = Math.min(this.magSize - this.mag, this.reserve);
    this.mag += n;
    this.reserve -= n;
    this.reloadTimer = 0;
  }
}
