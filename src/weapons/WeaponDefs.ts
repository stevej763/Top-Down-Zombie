export type WeaponId = 'pistol' | 'shotgun' | 'smg' | 'rifle' | 'lmg' | 'magnum' | 'plasma';

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
  /** Drawn barrel length in px. */
  barrel: number;
  shake: number;
  /** Area damage where the shot ends. */
  splash?: { radius: number; damage: number };
  tracer?: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    id: 'pistol', name: 'Pistol', cost: 0, ammoCost: 0,
    damage: 25, pellets: 1, spread: 0.03, fireInterval: 0.25, auto: false,
    mag: 8, reserve: 80, reloadTime: 1.2, range: 600, penetration: 1, barrel: 8, shake: 1.5,
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', cost: 1000, ammoCost: 500,
    damage: 18, pellets: 7, spread: 0.38, fireInterval: 0.9, auto: false,
    mag: 6, reserve: 36, reloadTime: 2.4, range: 260, penetration: 1, barrel: 16, shake: 6,
  },
  smg: {
    id: 'smg', name: 'SMG', cost: 1200, ammoCost: 600,
    damage: 20, pellets: 1, spread: 0.07, fireInterval: 0.07, auto: true,
    mag: 30, reserve: 180, reloadTime: 1.8, range: 500, penetration: 1, barrel: 12, shake: 1.2,
  },
  rifle: {
    id: 'rifle', name: 'Rifle', cost: 1500, ammoCost: 750,
    damage: 50, pellets: 1, spread: 0.02, fireInterval: 0.12, auto: true,
    mag: 24, reserve: 144, reloadTime: 2.0, range: 800, penetration: 2, barrel: 20, shake: 2.2,
  },
  // Mystery box only.
  lmg: {
    id: 'lmg', name: 'LMG', cost: 0, ammoCost: 0,
    damage: 40, pellets: 1, spread: 0.08, fireInterval: 0.09, auto: true,
    mag: 75, reserve: 300, reloadTime: 3.5, range: 700, penetration: 2, barrel: 18, shake: 2,
  },
  magnum: {
    id: 'magnum', name: 'Hand Cannon', cost: 0, ammoCost: 0,
    damage: 180, pellets: 1, spread: 0.01, fireInterval: 0.4, auto: false,
    mag: 6, reserve: 48, reloadTime: 1.8, range: 700, penetration: 3, barrel: 10, shake: 4,
  },
  plasma: {
    id: 'plasma', name: 'Plasma Caster', cost: 0, ammoCost: 0,
    damage: 120, pellets: 1, spread: 0.02, fireInterval: 0.35, auto: false,
    mag: 16, reserve: 120, reloadTime: 2.5, range: 600, penetration: 1, barrel: 16, shake: 3,
    splash: { radius: 80, damage: 220 }, tracer: '120, 220, 255',
  },
};

/** Melee: used with F/V at any time, or automatically when the gun in hand is completely out of ammo. */
export const KNIFE = {
  damage: 150,
  /** Reach beyond the player's edge, in px. */
  reach: 34,
  /** Full width of the slash, in radians. */
  arc: 1.8,
  cooldown: 0.55,
  /** Duration of the swing animation. */
  swing: 0.18,
} as const;

export const BOX_POOL: WeaponId[] = ['shotgun', 'smg', 'rifle', 'lmg', 'magnum', 'plasma'];
