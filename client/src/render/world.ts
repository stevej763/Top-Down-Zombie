import type { Particles } from '../systems/Particles';
import type { Level } from '../view/Level';
import type { WorldView } from '../view/WorldView';
import {
  drawInteractable, drawInteractableOverlay, drawLamps, drawPlayer, drawPlayerOverlay, drawPowerUps, drawWindow, drawZombie,
  type DoorSwing,
} from './draw';
import type { Lighting } from './lighting';
import type { PlayerFx, ZombieFx } from './visuals';

/** The cosmetic state a world is drawn with. The game passes its own; the admin spectator passes stubs. */
export interface WorldLook {
  time: number;
  /** Drawn on top and as the local player; -1 for none. */
  you: number;
  /** Room light brightness, 0..1. */
  light: number;
  playerFx(id: number): PlayerFx;
  zombieFx(id: number): ZombieFx;
  doorSwing(i: number): DoorSwing | undefined;
  particles?: Particles;
  /** Null draws the world fully lit. */
  lighting: Lighting | null;
}

/**
 * The world layer, the lighting overlay, then what's drawn after lighting (power-ups, labels, name
 * tags). `cx`/`cy` is the camera's top-left in world pixels; the lighting covers its own size from
 * there. Leaves the transform as it found it.
 */
export function drawWorld(
  ctx: CanvasRenderingContext2D, level: Level, world: WorldView, mapCanvas: CanvasImageSource, cx: number, cy: number,
  look: WorldLook,
): void {
  const { time, you, light, particles } = look;
  ctx.save();
  ctx.translate(-cx, -cy);
  ctx.drawImage(mapCanvas, 0, 0);
  particles?.drawDecals(ctx);
  drawLamps(ctx, level.lights, 0);
  level.fixtures.forEach((f, i) => drawInteractable(ctx, f, world.interactables[i], time, world.power, look.doorSwing(i)));
  level.windows.forEach((w, i) => drawWindow(ctx, w, world.windows[i]));
  for (const z of world.zombies) drawZombie(ctx, z, look.zombieFx(z.id), world.round.n);
  // The local player on top of teammates.
  const players = [...world.players].sort((a, b) => Number(a.id === you) - Number(b.id === you));
  for (const p of players) drawPlayer(ctx, p, look.playerFx(p.id), p.id === you);
  particles?.draw(ctx);
  ctx.restore();

  look.lighting?.draw(ctx, level, world, look.playerFx, cx, cy, light);

  ctx.save();
  ctx.translate(-cx, -cy);
  if (light > 0) drawLamps(ctx, level.lights, light);
  particles?.drawGlow(ctx);
  drawPowerUps(ctx, world.powerUps.drops, time);
  level.fixtures.forEach((f, i) => drawInteractableOverlay(ctx, f, world.interactables[i], time));
  for (const p of players) drawPlayerOverlay(ctx, p, p.id === you, time);
  particles?.drawTexts(ctx);
  ctx.restore();
}
