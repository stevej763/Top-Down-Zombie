import type { GameSim } from '../sim/GameSim';
import { Door, MysteryBox } from '../sim/Interactables';
import type { Weapon } from '../sim/Weapon';
import type { InteractableView, InteractionView, PlayerView, WeaponView, WorldView } from './WorldView';

/** The TS sim has one player; this is its id in the view. */
export const LOCAL_PLAYER_ID = 1;

/**
 * Builds a `WorldView` from the TS `GameSim`, the way the server's SnapshotBuilder does from
 * the Java one (minus the rounding). A temporary adapter: deleted with the TS sim in Phase 4 M5.
 */
export function localView(sim: GameSim, name: string): WorldView {
  const p = sim.player;
  const player: PlayerView = {
    id: LOCAL_PLAYER_ID,
    name,
    x: p.x,
    y: p.y,
    aim: p.aim,
    hp: p.hp,
    maxHp: p.maxHp,
    state: 'alive',
    bleedout: 0,
    reviveProgress: 0,
    armour: p.armour,
    armourLevel: p.armourLevel,
    points: sim.economy.points,
    kills: sim.kills,
    slot: p.slot,
    weapons: [weapon(p.weapons[0]), weapon(p.weapons[1])],
    perks: [...p.perks],
    invuln: p.invuln,
    interaction: interaction(sim),
  };
  return {
    round: {
      n: sim.rounds.round,
      active: sim.rounds.active,
      remaining: sim.rounds.remaining(sim),
      intermission: sim.rounds.intermission,
    },
    powerUps: {
      instakill: sim.powerUps.instakill,
      double: sim.powerUps.double,
      drops: sim.powerUps.drops.map((d) => ({ ...d })),
    },
    players: [player],
    zombies: sim.zombies.map((z) => ({ id: z.id, x: z.x, y: z.y, facing: z.facing, state: z.state, runner: z.runner })),
    windows: sim.barricades.map((b) => b.planks),
    interactables: sim.interactables.map((it): InteractableView => {
      if (it instanceof Door) return { open: it.open };
      if (it instanceof MysteryBox) {
        return { state: it.state, shown: it.shown, timer: it.timer, owner: it.state === 'closed' ? -1 : LOCAL_PLAYER_ID };
      }
      return {};
    }),
  };
}

function weapon(w: Weapon | null): WeaponView | null {
  return w && { id: w.def.id, tier: w.tier, mag: w.mag, reserve: w.reserve, reloadProgress: w.reloadProgress };
}

function interaction(sim: GameSim): InteractionView | null {
  const it = sim.player.interaction;
  if (!it) return null;
  if (it.kind === 'rebuild') return { kind: 'rebuild', window: sim.barricades.indexOf(it.barricade) };
  return { kind: 'use', target: sim.interactables.indexOf(it.target) };
}
