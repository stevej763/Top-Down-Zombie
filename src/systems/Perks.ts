export type PerkId = 'toughHide' | 'quickHands' | 'rapidFire' | 'secondWind';

export interface PerkDef {
  id: PerkId;
  name: string;
  cost: number;
  color: string;
  letter: string;
  desc: string;
}

export const PERKS: Record<PerkId, PerkDef> = {
  toughHide: { id: 'toughHide', name: 'Tough Hide', cost: 2500, color: '#d03a2a', letter: 'T', desc: 'Max health 250' },
  quickHands: { id: 'quickHands', name: 'Quick Hands', cost: 3000, color: '#2fa84f', letter: 'Q', desc: 'Reload twice as fast' },
  rapidFire: { id: 'rapidFire', name: 'Rapid Fire', cost: 2000, color: '#e0a020', letter: 'R', desc: 'Fire 33% faster' },
  secondWind: { id: 'secondWind', name: 'Second Wind', cost: 1500, color: '#3a8ad0', letter: 'S', desc: 'Get back up once (lose all perks)' },
};

export const PERK_ORDER: PerkId[] = ['toughHide', 'quickHands', 'rapidFire', 'secondWind'];
