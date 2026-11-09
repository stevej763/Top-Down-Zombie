import type { PerkId, PowerUpId, WeaponId } from '../game/defs';
import type { Fixture } from '../view/Level';

/** Visual-only tuning: everything here is cosmetic, so it stays out of shared/defs. */

export type CasingKind = 'brass' | 'shell';

export interface WeaponFx {
  /** "r, g, b" */
  tracer: string;
  /** Tracer core width in px. */
  width: number;
  /** Seconds a tracer takes to fade. */
  life: number;
  /** "r, g, b" muzzle flash and its light. */
  flash: string;
  flashSize: number;
  casing: CasingKind | null;
  /** Drawn barrel length in px. */
  barrel: number;
  shake: number;
}

export const WEAPON_FX: Record<WeaponId, WeaponFx> = {
  pistol: { tracer: '255, 220, 130', width: 1.5, life: 0.06, flash: '255, 225, 140', flashSize: 1, casing: 'brass', barrel: 8, shake: 1.5 },
  shotgun: { tracer: '255, 150, 60', width: 1.2, life: 0.05, flash: '255, 160, 70', flashSize: 1.6, casing: 'shell', barrel: 16, shake: 6 },
  smg: { tracer: '255, 240, 190', width: 1.2, life: 0.04, flash: '255, 235, 170', flashSize: 0.8, casing: 'brass', barrel: 12, shake: 1.2 },
  rifle: { tracer: '255, 200, 80', width: 2, life: 0.07, flash: '255, 215, 110', flashSize: 1.1, casing: 'brass', barrel: 20, shake: 2.2 },
  lmg: { tracer: '255, 110, 60', width: 2, life: 0.07, flash: '255, 140, 70', flashSize: 1.2, casing: 'brass', barrel: 18, shake: 2 },
  magnum: { tracer: '255, 255, 255', width: 3, life: 0.12, flash: '255, 250, 235', flashSize: 1.6, casing: 'brass', barrel: 10, shake: 4 },
  plasma: { tracer: '120, 220, 255', width: 3.5, life: 0.15, flash: '120, 220, 255', flashSize: 1.3, casing: null, barrel: 16, shake: 3 },
};

export interface Halo {
  /** "r, g, b" */
  color: string;
  width: number;
}

/** Glow around an upgraded weapon's tracers, by upgrade tier. */
export const TIER_HALO: (Halo | null)[] = [null, { color: '170, 110, 255', width: 7 }, { color: '230, 140, 255', width: 10 }];

export const PERK_VISUALS: Record<PerkId, { color: string; letter: string }> = {
  toughHide: { color: '#d03a2a', letter: 'T' },
  quickHands: { color: '#2fa84f', letter: 'Q' },
  rapidFire: { color: '#e0a020', letter: 'R' },
  secondWind: { color: '#3a8ad0', letter: 'S' },
};

export const POWERUP_VISUALS: Record<PowerUpId, { label: string; color: string }> = {
  ammo: { label: 'A', color: '#5ad15a' },
  instakill: { label: 'K', color: '#e04040' },
  double: { label: '2x', color: '#f2d15c' },
  nuke: { label: 'N', color: '#ff8a30' },
};

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Kinds that stay dark and do nothing until the power is on. */
export function needsPower(kind: Fixture['kind']): boolean {
  return kind === 'perk' || kind === 'upgrade' || kind === 'box';
}

/** Coloured light an interactable casts in the dark ("r, g, b"), if any. */
export function glowOf(it: Fixture, powered: boolean): string | null {
  if (!powered && needsPower(it.kind)) return null;
  switch (it.kind) {
    case 'wallBuy': return '200, 200, 190';
    case 'perk': return hexToRgb(PERK_VISUALS[it.perk].color);
    case 'armour': return '90, 140, 220';
    case 'upgrade': return '170, 80, 230';
    case 'box': return '240, 190, 70';
    case 'door': return null;
    // A red light to find it by in the dark, green once thrown.
    case 'power': return powered ? '90, 220, 120' : '230, 60, 40';
  }
}

/** Body colour of the local player, and of teammates (picked by player id). */
export const LOCAL_BODY = { fill: '#2e5d8c', stroke: '#132a42' };
export const TEAM_BODIES = [
  { fill: '#8c3a2e', stroke: '#421813' },
  { fill: '#3a7d45', stroke: '#14361b' },
  { fill: '#8c7a2e', stroke: '#423813' },
];

/** Sideways offset of each akimbo gun from the aim line, in px. */
export const AKIMBO_OFFSET = 6;

/** Client-side animation state for one player, driven by sim events. `hurtFlash` is only used for the local player. */
export interface PlayerFx {
  /** Muzzle-flash timer. */
  flash: number;
  /** Which akimbo gun fired last: 1 = right hand, -1 = left. */
  hand: number;
  hurtFlash: number;
  /** Time left in the current knife swing animation. */
  knifeSwing: number;
}

/** Client-side animation state for one zombie. */
export interface ZombieFx {
  hitFlash: number;
  /** Arm-swing phase. */
  wobble: number;
}
