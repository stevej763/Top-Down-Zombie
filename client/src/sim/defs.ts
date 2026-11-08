import economyJson from '../../../shared/defs/economy.json';
import perksJson from '../../../shared/defs/perks.json';
import powerUpsJson from '../../../shared/defs/powerups.json';
import weaponsJson from '../../../shared/defs/weapons.json';

/**
 * Typed views of the gameplay tuning in shared/defs/*.json (also loaded by the Java sim).
 * Visual-only data lives in render/visuals.ts.
 */

export type WeaponId = 'pistol' | 'shotgun' | 'smg' | 'rifle' | 'lmg' | 'magnum' | 'plasma';
export type PerkId = 'toughHide' | 'quickHands' | 'rapidFire' | 'secondWind';
export type PowerUpId = 'ammo' | 'instakill' | 'double' | 'nuke';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Wall-buy price (0 = starter or box-only). */
  cost: number;
  ammoCost: number;
  damage: number;
  pellets: number;
  /** Total random spread in radians. */
  spread: number;
  /** Seconds between shots. */
  fireInterval: number;
  auto: boolean;
  mag: number;
  reserve: number;
  reloadTime: number;
  range: number;
  /** How many zombies one bullet can pass through. */
  penetration: number;
  /** Area damage where the shot ends. */
  splash?: { radius: number; damage: number };
}

export interface PerkDef {
  id: PerkId;
  name: string;
  cost: number;
  desc: string;
}

export interface ArmourLevel {
  /** Armour points at this level. */
  cap: number;
  /** Price to upgrade to this level. */
  cost: number;
}

/** Attach each entry's key as its `id`. */
function withIds<K extends string, V>(table: Record<string, V>): Record<K, V & { id: K }> {
  return Object.fromEntries(Object.entries(table).map(([id, v]) => [id, { ...v, id }])) as Record<K, V & { id: K }>;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = withIds(weaponsJson.weapons as Record<string, Omit<WeaponDef, 'id'>>);
export const STARTER_WEAPON = weaponsJson.starter as WeaponId;
export const BOX_POOL = weaponsJson.boxPool as WeaponId[];

/** Melee: used with F/V at any time, or automatically when the gun in hand is completely out of ammo. */
export const KNIFE: {
  damage: number;
  /** Reach beyond the player's edge, in px. */
  reach: number;
  /** Full width of the slash, in radians. */
  arc: number;
  cooldown: number;
  /** Duration of the swing animation. */
  swing: number;
} = weaponsJson.knife;

export const UPGRADE = weaponsJson.upgrade;
export const MAX_TIER = UPGRADE.cost.length - 1;

export const PERKS: Record<PerkId, PerkDef> = withIds(perksJson.perks);
export const PERK_ORDER = perksJson.order as PerkId[];
export const PERK_EFFECTS = perksJson.effects;

export const STARTING_POINTS = economyJson.startingPoints;
/** Max points from rebuilding barricades per round, so it can't be farmed. */
export const REBUILD_CAP = economyJson.rebuildCap;
export const POINTS = economyJson.points;
export const BOX_COST = economyJson.boxCost;

/** Index 0 = no armour. */
export const ARMOUR_LEVELS: ArmourLevel[] = economyJson.armour.levels;
/** Share of each hit that armour soaks up while it lasts. */
export const ARMOUR_ABSORB = economyJson.armour.absorb;

export function repairCost(level: number): number {
  return economyJson.armour.repairCostPerLevel * level;
}

export const POWERUPS: Record<PowerUpId, { id: PowerUpId; name: string }> = withIds(powerUpsJson.powerUps);
export const POWERUP_IDS = Object.keys(POWERUPS) as PowerUpId[];
export const POWERUP_TUNING = {
  dropChance: powerUpsJson.dropChance,
  maxPerRound: powerUpsJson.maxPerRound,
  lifetime: powerUpsJson.lifetime,
  /** Seconds a timed power-up lasts. */
  duration: powerUpsJson.duration,
  pickupRadius: powerUpsJson.pickupRadius,
};

/** A weapon's display name at an upgrade tier, e.g. "Shotgun Mk II". */
export function weaponName(id: WeaponId, tier: number): string {
  return WEAPONS[id].name + UPGRADE.suffix[tier];
}

export function magSize(id: WeaponId, tier: number): number {
  return Math.round(WEAPONS[id].mag * UPGRADE.ammo[tier]);
}

export function reserveSize(id: WeaponId, tier: number): number {
  return Math.round(WEAPONS[id].reserve * UPGRADE.ammo[tier]);
}

/** Upgraded weapons cost more to refill at the wall. */
export function ammoCost(id: WeaponId, tier: number): number {
  return WEAPONS[id].ammoCost * (1 + tier * 2);
}

// Constants that live in code in the Java sim (Player, Zombie), mirrored for the client.
export const PLAYER_RADIUS = 12;
export const ZOMBIE_RADIUS = 13;
/** Seconds a downed co-op player lasts before bleeding out (Player.BLEEDOUT). */
export const BLEEDOUT = 30;
/** Seconds of holding E to revive a teammate (Player.REVIVE_TIME). */
export const REVIVE_TIME = 3;
