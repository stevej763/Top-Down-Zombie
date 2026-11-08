import {
  ammoCost, ARMOUR_LEVELS, BOX_COST, magSize, MAX_TIER, PERKS, repairCost, reserveSize, UPGRADE, WEAPONS, weaponName,
} from '../sim/defs';
import type { Fixture, Level } from '../view/Level';
import { heldWeapon, type InteractableView, type PlayerView, type WorldView } from '../view/WorldView';

export interface Prompt {
  text: string;
  color: string;
}

const WHITE = '#ffffff';
const GREY = '#9a9a9a';

function priced(p: PlayerView, text: string, cost: number): Prompt {
  return { text: `${text} [${cost}]`, color: p.points >= cost ? WHITE : '#d05050' };
}

/** What the HUD shows for a player's current interaction. */
export function interactionPrompt(level: Level, world: WorldView, p: PlayerView): Prompt | null {
  const it = p.interaction;
  if (!it) return null;
  switch (it.kind) {
    case 'rebuild':
      return { text: 'Hold E to rebuild barricade', color: WHITE };
    case 'revive': {
      const name = world.players.find((o) => o.id === it.player)?.name ?? 'teammate';
      return { text: `Hold E to revive ${name}`, color: WHITE };
    }
    case 'use':
      return prompt(p, level.fixtures[it.target], world.interactables[it.target]);
  }
}

function prompt(p: PlayerView, f: Fixture, s: InteractableView): Prompt | null {
  switch (f.kind) {
    case 'wallBuy': {
      const def = WEAPONS[f.weapon];
      const owned = p.weapons.find((w) => w?.id === def.id);
      if (!owned) return priced(p, `Press E to buy ${def.name}`, def.cost);
      const name = weaponName(owned.id, owned.tier);
      const full = owned.mag === magSize(owned.id, owned.tier) && owned.reserve === reserveSize(owned.id, owned.tier);
      if (full) return { text: `${name} ammo full`, color: GREY };
      return priced(p, `Press E to buy ${name} ammo`, ammoCost(owned.id, owned.tier));
    }
    case 'perk': {
      const perk = PERKS[f.perk];
      if (p.perks.includes(perk.id)) return { text: `${perk.name} — owned`, color: GREY };
      return priced(p, `Press E for ${perk.name} (${perk.desc})`, perk.cost);
    }
    case 'armour': {
      const level = p.armourLevel;
      if (level > 0 && p.armour < ARMOUR_LEVELS[level].cap) return priced(p, 'Press E to repair armour', repairCost(level));
      if (level >= ARMOUR_LEVELS.length - 1) return { text: 'Armour maxed', color: GREY };
      return priced(p, `Press E for armour level ${level + 1}`, ARMOUR_LEVELS[level + 1].cost);
    }
    case 'upgrade': {
      const w = heldWeapon(p);
      const name = weaponName(w.id, w.tier);
      if (w.tier >= MAX_TIER) return { text: `${name} is fully upgraded`, color: GREY };
      return priced(p, `Press E to upgrade ${name}`, UPGRADE.cost[w.tier + 1]);
    }
    case 'box': {
      if (s.state === 'rolling') return null;
      if (s.state === 'ready') {
        // Only whoever paid can take it.
        return s.owner === p.id && s.shown ? { text: `Press E to take ${WEAPONS[s.shown].name}`, color: WHITE } : null;
      }
      return priced(p, 'Press E for a random weapon', BOX_COST);
    }
    case 'door':
      return s.open ? null : priced(p, 'Press E to open door', f.def.cost);
  }
}
