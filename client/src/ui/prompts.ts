import { ARMOUR_LEVELS, BOX_COST, MAX_TIER, repairCost, UPGRADE, WEAPONS } from '../sim/defs';
import type { GameSim, Interaction } from '../sim/GameSim';
import type { Door, Interactable, MysteryBox, PerkMachine, WallBuy } from '../sim/Interactables';

export interface Prompt {
  text: string;
  color: string;
}

const WHITE = '#ffffff';
const GREY = '#9a9a9a';

function priced(sim: GameSim, text: string, cost: number): Prompt {
  return { text: `${text} [${cost}]`, color: sim.economy.points >= cost ? WHITE : '#d05050' };
}

/** What the HUD shows for the player's current interaction. */
export function interactionPrompt(sim: GameSim, it: Interaction): Prompt | null {
  if (!it) return null;
  if (it.kind === 'rebuild') return { text: 'Hold E to rebuild barricade', color: WHITE };
  return prompt(sim, it.target);
}

function prompt(sim: GameSim, it: Interactable): Prompt | null {
  const p = sim.player;
  switch (it.kind) {
    case 'wallBuy': {
      const def = (it as WallBuy).def;
      const owned = p.findWeapon(def.id);
      if (!owned) return priced(sim, `Press E to buy ${def.name}`, def.cost);
      if (owned.isFull) return { text: `${owned.name} ammo full`, color: GREY };
      return priced(sim, `Press E to buy ${owned.name} ammo`, owned.ammoCost);
    }
    case 'perk': {
      const perk = (it as PerkMachine).perk;
      if (p.perks.has(perk.id)) return { text: `${perk.name} — owned`, color: GREY };
      return priced(sim, `Press E for ${perk.name} (${perk.desc})`, perk.cost);
    }
    case 'armour': {
      const level = p.armourLevel;
      if (level > 0 && p.armour < ARMOUR_LEVELS[level].cap) return priced(sim, 'Press E to repair armour', repairCost(level));
      if (level >= ARMOUR_LEVELS.length - 1) return { text: 'Armour maxed', color: GREY };
      return priced(sim, `Press E for armour level ${level + 1}`, ARMOUR_LEVELS[level + 1].cost);
    }
    case 'upgrade': {
      const w = p.weapon;
      if (w.tier >= MAX_TIER) return { text: `${w.name} is fully upgraded`, color: GREY };
      return priced(sim, `Press E to upgrade ${w.name}`, UPGRADE.cost[w.tier + 1]);
    }
    case 'box': {
      const box = it as MysteryBox;
      if (box.state === 'rolling') return null;
      if (box.state === 'ready') return { text: `Press E to take ${WEAPONS[box.shown].name}`, color: WHITE };
      return priced(sim, 'Press E for a random weapon', BOX_COST);
    }
    case 'door': {
      const door = it as Door;
      return door.open ? null : priced(sim, 'Press E to open door', door.def.cost);
    }
  }
}
