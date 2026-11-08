import type { PerkId, PowerUpId, WeaponId } from '../sim/defs';

/**
 * What the renderer, HUD and prompts read: the dynamic world, shaped exactly like a server
 * snapshot (net/protocol.ts `Snapshot` is these fields plus `type`, `tick` and `acks`; the Java
 * records in game/protocol/Snapshot.java use the same names). The static half of a map (tiles,
 * window and fixture positions) is a `Level`. Today `localView` builds this from the TS sim;
 * from Phase 4 M4 it comes from interpolated snapshots.
 */
export interface WorldView {
  round: RoundView;
  powerUps: PowerUpsView;
  players: PlayerView[];
  zombies: ZombieView[];
  /** Plank count per window, in map order (`Level.windows`). */
  windows: WindowView[];
  /** In `Level.fixtures` order: wall buys, perks, armour, upgrade, box, doors. */
  interactables: InteractableView[];
}

export interface RoundView {
  n: number;
  active: boolean;
  /** Zombies still to spawn plus those alive. */
  remaining: number;
  /** Seconds until the next round starts, while not active. */
  intermission: number;
}

export interface PowerUpsView {
  /** Seconds left on each timed power-up; they apply to everyone. */
  instakill: number;
  double: number;
  drops: DropView[];
}

/** `id` is the power-up kind; drops have no entity id. */
export interface DropView {
  id: PowerUpId;
  x: number;
  y: number;
  life: number;
}

export type PlayerState = 'alive' | 'downed' | 'dead';
export type ZombieStateName = 'outside' | 'breaching' | 'climbing' | 'inside';
export type BoxState = 'closed' | 'rolling' | 'ready';

export interface WeaponView {
  id: WeaponId;
  tier: number;
  mag: number;
  reserve: number;
  /** 0..1, 0 when not reloading. */
  reloadProgress: number;
}

/** `window` and `target` index `WorldView.windows` and `WorldView.interactables`. */
export type InteractionView =
  | { kind: 'rebuild'; window: number }
  | { kind: 'use'; target: number }
  | { kind: 'revive'; player: number };

export interface PlayerView {
  id: number;
  name: string;
  x: number;
  y: number;
  aim: number;
  hp: number;
  maxHp: number;
  state: PlayerState;
  /** Seconds left before a downed player dies. */
  bleedout: number;
  /** Seconds of reviving so far (REVIVE_TIME to finish). */
  reviveProgress: number;
  armour: number;
  armourLevel: number;
  points: number;
  kills: number;
  slot: number;
  /** Always two entries; an empty slot is null. */
  weapons: [WeaponView | null, WeaponView | null];
  perks: PerkId[];
  invuln: number;
  interaction: InteractionView | null;
}

export interface ZombieView {
  id: number;
  x: number;
  y: number;
  facing: number;
  state: ZombieStateName;
  runner: boolean;
}

/** A window's plank count. */
export type WindowView = number;

/** Doors carry `open`; the box carries its state; everything else is `{}`. */
export interface InteractableView {
  open?: boolean;
  state?: BoxState;
  shown?: WeaponId;
  timer?: number;
  /** Player id who paid for the roll, or -1. */
  owner?: number;
}

/** The weapon in hand. */
export function heldWeapon(p: PlayerView): WeaponView {
  return p.weapons[p.slot]!;
}
