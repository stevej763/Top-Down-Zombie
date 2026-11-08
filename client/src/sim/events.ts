import type { PerkId, PowerUpId, WeaponId } from './defs';

/**
 * Everything the sim reports for the client to show or play: sounds, particles, callouts.
 * Gameplay never depends on them. Positions are world px; `points` is what was awarded
 * (after Double Points), 0 if none.
 */
export type SimEvent =
  | { type: 'shot'; weapon: WeaponId; tier: number; x: number; y: number; aim: number }
  /** One pellet's path, from the shooter's centre to where it stopped. */
  | { type: 'tracer'; weapon: WeaponId; tier: number; x1: number; y1: number; x2: number; y2: number; hitWall: boolean }
  | { type: 'explosion'; x: number; y: number; radius: number }
  | { type: 'zombieHit'; zombie: number; x: number; y: number; angle: number; points: number }
  | { type: 'zombieKilled'; zombie: number; x: number; y: number; points: number }
  | { type: 'knife'; hit: boolean }
  | { type: 'reload' }
  | { type: 'playerHurt'; x: number; y: number }
  | { type: 'secondWind' }
  | { type: 'gameOver' }
  | { type: 'plankTorn'; x: number; y: number }
  | { type: 'plankPlaced'; x: number; y: number; points: number }
  | { type: 'doorOpened'; x: number; y: number }
  | { type: 'denied' }
  | { type: 'weaponGiven'; weapon: WeaponId; tier: number }
  | { type: 'ammoBought' }
  | { type: 'perkBought'; perk: PerkId }
  | { type: 'armourBought'; level: number }
  | { type: 'upgraded'; weapon: WeaponId; tier: number }
  | { type: 'powerUp'; id: PowerUpId }
  | { type: 'roundStart'; round: number }
  | { type: 'roundEnd'; round: number }
  | { type: 'boxTick' }
  | { type: 'boxReveal'; weapon: WeaponId };
