export interface ArmourLevel {
  /** Armour points at this level. */
  cap: number;
  /** Price to upgrade to this level. */
  cost: number;
}

/** Index 0 = no armour. */
export const ARMOUR_LEVELS: ArmourLevel[] = [
  { cap: 0, cost: 0 },
  { cap: 50, cost: 1500 },
  { cap: 100, cost: 3000 },
  { cap: 150, cost: 5000 },
];

/** Share of each hit that armour soaks up while it lasts. */
export const ARMOUR_ABSORB = 0.7;

export function repairCost(level: number): number {
  return 250 * level;
}
