import { ammoCost, magSize, MAX_TIER, reserveSize, UPGRADE, weaponName, type WeaponDef } from './defs';

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
    return weaponName(this.def.id, this.tier);
  }

  get damage(): number {
    return this.def.damage * UPGRADE.damage[this.tier];
  }

  get magSize(): number {
    return magSize(this.def.id, this.tier);
  }

  get reserveSize(): number {
    return reserveSize(this.def.id, this.tier);
  }

  get ammoCost(): number {
    return ammoCost(this.def.id, this.tier);
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
