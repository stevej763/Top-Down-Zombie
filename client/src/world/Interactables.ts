import { sound } from '../audio/Sound';
import { dist, rand } from '../core/math';
import type { Game } from '../core/Game';
import {
  drawArmourBench, drawDoor, drawMysteryBox, drawPerkMachine, drawUpgradeBench, drawWallBuy,
} from '../render/draw';
import { ARMOUR_LEVELS, repairCost } from '../systems/Armour';
import { PERKS, type PerkDef, type PerkId } from '../systems/Perks';
import { shadowText } from '../ui/text';
import { MAX_TIER, UPGRADE_COST, Weapon } from '../weapons/Weapon';
import { BOX_POOL, WEAPONS, type WeaponDef, type WeaponId } from '../weapons/WeaponDefs';
import type { DoorDef, WallSpot } from './MapData';
import { TILE } from './TileMap';

export interface Prompt {
  text: string;
  color: string;
}

const WHITE = '#ffffff';
const GREY = '#9a9a9a';

function priced(game: Game, text: string, cost: number): Prompt {
  return { text: `${text} [${cost}]`, color: game.economy.points >= cost ? WHITE : '#d05050' };
}

/** Pay for something, or show feedback if the player can't afford it. */
function pay(game: Game, cost: number): boolean {
  if (game.economy.spend(cost)) return true;
  game.denied();
  return false;
}

export abstract class Interactable {
  abstract readonly standX: number;
  abstract readonly standY: number;
  range = 50;
  /** Coloured light cast around it in the dark (an "r, g, b" string), if any. */
  glow: string | null = null;

  distance(x: number, y: number): number {
    return dist(x, y, this.standX, this.standY);
  }

  /** The prompt to show when the player is close, or null if it can't be used right now. */
  abstract prompt(game: Game): Prompt | null;
  abstract use(game: Game): void;
  abstract draw(ctx: CanvasRenderingContext2D, game: Game): void;
  update(_dt: number, _game: Game): void {}
  /** Drawn on top of the lighting layer (labels etc.). */
  drawOverlay(_ctx: CanvasRenderingContext2D, _game: Game): void {}
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
  constructor(spot: WallSpot, readonly def: WeaponDef) {
    super(spot);
    this.glow = '200, 200, 190';
  }

  prompt(game: Game): Prompt {
    const owned = game.player.findWeapon(this.def.id);
    if (!owned) return priced(game, `Press E to buy ${this.def.name}`, this.def.cost);
    if (owned.isFull) return { text: `${owned.name} ammo full`, color: GREY };
    return priced(game, `Press E to buy ${owned.name} ammo`, owned.ammoCost);
  }

  use(game: Game): void {
    const owned = game.player.findWeapon(this.def.id);
    if (owned) {
      if (owned.isFull || !pay(game, owned.ammoCost)) return;
      owned.refill();
      sound.buy();
      game.particles.text('Ammo', game.player.x, game.player.y - 20, WHITE);
      return;
    }
    if (!pay(game, this.def.cost)) return;
    game.giveWeapon(new Weapon(this.def));
    sound.buy();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    drawWallBuy(ctx, this.spot.tx, this.spot.ty, this.def);
  }
}

export class PerkMachine extends WallMounted {
  readonly perk: PerkDef;

  constructor(spot: WallSpot, perkId: PerkId) {
    super(spot);
    this.perk = PERKS[perkId];
    this.glow = hexToRgb(this.perk.color);
  }

  prompt(game: Game): Prompt {
    if (game.player.perks.has(this.perk.id)) return { text: `${this.perk.name} — owned`, color: GREY };
    return priced(game, `Press E for ${this.perk.name} (${this.perk.desc})`, this.perk.cost);
  }

  use(game: Game): void {
    const p = game.player;
    if (p.perks.has(this.perk.id) || !pay(game, this.perk.cost)) return;
    p.perks.add(this.perk.id);
    if (this.perk.id === 'toughHide') p.hp = p.maxHp;
    sound.perk();
    game.particles.text(this.perk.name, p.x, p.y - 20, this.perk.color);
  }

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    drawPerkMachine(ctx, this.spot.tx, this.spot.ty, this.perk, game.time);
  }
}

export class ArmourBench extends WallMounted {
  constructor(spot: WallSpot) {
    super(spot);
    this.glow = '90, 140, 220';
  }

  prompt(game: Game): Prompt {
    const p = game.player;
    const level = p.armourLevel;
    if (level > 0 && p.armour < ARMOUR_LEVELS[level].cap) return priced(game, 'Press E to repair armour', repairCost(level));
    if (level >= ARMOUR_LEVELS.length - 1) return { text: 'Armour maxed', color: GREY };
    return priced(game, `Press E for armour level ${level + 1}`, ARMOUR_LEVELS[level + 1].cost);
  }

  use(game: Game): void {
    const p = game.player;
    const level = p.armourLevel;
    if (level > 0 && p.armour < ARMOUR_LEVELS[level].cap) {
      if (!pay(game, repairCost(level))) return;
    } else if (level < ARMOUR_LEVELS.length - 1) {
      if (!pay(game, ARMOUR_LEVELS[level + 1].cost)) return;
      p.armourLevel++;
    } else {
      return;
    }
    p.armour = ARMOUR_LEVELS[p.armourLevel].cap;
    sound.armour();
    game.particles.text(`Armour ${p.armourLevel}`, p.x, p.y - 20, '#7aa8ff');
  }

  draw(ctx: CanvasRenderingContext2D): void {
    drawArmourBench(ctx, this.spot.tx, this.spot.ty);
  }
}

export class UpgradeBench extends WallMounted {
  constructor(spot: WallSpot) {
    super(spot);
    this.glow = '170, 80, 230';
  }

  prompt(game: Game): Prompt {
    const w = game.player.weapon;
    if (w.tier >= MAX_TIER) return { text: `${w.name} is fully upgraded`, color: GREY };
    return priced(game, `Press E to upgrade ${w.name}`, UPGRADE_COST[w.tier + 1]);
  }

  use(game: Game): void {
    const w = game.player.weapon;
    if (w.tier >= MAX_TIER || !pay(game, UPGRADE_COST[w.tier + 1])) return;
    w.upgrade();
    sound.upgrade();
    game.particles.text(w.name, game.player.x, game.player.y - 20, '#c890ff');
  }

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    drawUpgradeBench(ctx, this.spot.tx, this.spot.ty, game.time);
  }
}

const BOX_COST = 950;
const BOX_ROLL_TIME = 2.6;
const BOX_OFFER_TIME = 8;

export class MysteryBox extends Interactable {
  readonly standX: number;
  readonly standY: number;
  state: 'closed' | 'rolling' | 'ready' = 'closed';
  /** Weapon currently shown above the box. */
  shown: WeaponId = 'shotgun';
  private timer = 0;
  private tick = 0;

  constructor(readonly tx: number, readonly ty: number) {
    super();
    this.standX = (tx + 1) * TILE;
    this.standY = (ty + 1) * TILE + TILE / 2;
    this.range = 56;
    this.glow = '240, 190, 70';
  }

  prompt(game: Game): Prompt | null {
    if (this.state === 'rolling') return null;
    if (this.state === 'ready') return { text: `Press E to take ${WEAPONS[this.shown].name}`, color: WHITE };
    return priced(game, 'Press E for a random weapon', BOX_COST);
  }

  use(game: Game): void {
    if (this.state === 'closed') {
      if (!pay(game, BOX_COST)) return;
      this.state = 'rolling';
      this.timer = BOX_ROLL_TIME;
      this.tick = 0;
    } else if (this.state === 'ready') {
      game.giveWeapon(new Weapon(WEAPONS[this.shown]));
      sound.buy();
      this.state = 'closed';
    }
  }

  update(dt: number, game: Game): void {
    if (this.state === 'closed') return;
    this.timer -= dt;
    if (this.state === 'rolling') {
      this.tick -= dt;
      // Cycle faster at first, slowing down as it settles.
      if (this.tick <= 0) {
        this.shown = BOX_POOL[Math.floor(rand(0, BOX_POOL.length))];
        this.tick = 0.06 + (1 - this.timer / BOX_ROLL_TIME) * 0.2;
        sound.boxTick();
      }
      if (this.timer <= 0) {
        const held = new Set(game.player.weapons.map((w) => w?.def.id));
        const options = BOX_POOL.filter((id) => !held.has(id));
        this.shown = options[Math.floor(rand(0, options.length))];
        this.state = 'ready';
        this.timer = BOX_OFFER_TIME;
        sound.boxReveal();
      }
    } else if (this.timer <= 0) {
      this.state = 'closed';
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    drawMysteryBox(ctx, this.tx, this.ty, this.state !== 'closed');
  }

  drawOverlay(ctx: CanvasRenderingContext2D, game: Game): void {
    if (this.state === 'closed') return;
    const x = (this.tx + 1) * TILE;
    const y = this.ty * TILE - 8 - (this.state === 'ready' ? 4 + Math.sin(game.time * 4) * 2 : 0);
    const color = this.state === 'ready' && this.timer < 3 && Math.floor(game.time * 6) % 2 ? GREY : '#f2d15c';
    shadowText(ctx, WEAPONS[this.shown].name, x, y, 'bold 14px monospace', color, 'center', 'bottom');
  }
}

export class Door extends Interactable {
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

  prompt(game: Game): Prompt | null {
    return this.open ? null : priced(game, 'Press E to open door', this.def.cost);
  }

  use(game: Game): void {
    if (this.open || !pay(game, this.def.cost)) return;
    game.openDoor(this);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.open) drawDoor(ctx, this.def.tiles);
  }
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
