import { VIEW_H, VIEW_W, type Game } from '../core/Game';
import { sound } from '../audio/Sound';
import { PERK_VISUALS } from '../render/visuals';
import { ARMOUR_LEVELS, magSize, PERK_ORDER, weaponName } from '../sim/defs';
import { heldWeapon } from '../view/WorldView';
import { interactionPrompt } from './prompts';
import { DISPLAY_FONT, shadowText } from './text';

export function drawHUD(ctx: CanvasRenderingContext2D, game: Game): void {
  const { world, level } = game;
  const { round: rounds, powerUps } = world;
  const player = game.me;

  // Damage vignette.
  const a = Math.min(0.85, (1 - player.hp / player.maxHp) * 0.7 + game.playerFxOf(player.id).hurtFlash * 0.35);
  if (a > 0.01) {
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.3, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.65);
    g.addColorStop(0, 'rgba(120, 0, 0, 0)');
    g.addColorStop(1, `rgba(120, 0, 0, ${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // Round number + status.
  if (rounds.n > 0) shadowText(ctx, String(rounds.n), 24, 12, `64px ${DISPLAY_FONT}`, '#a01212', 'left', 'top');
  const status = rounds.active
    ? `${rounds.remaining} zombies left`
    : `${rounds.n > 0 ? 'Next round' : 'Get ready'} in ${Math.ceil(rounds.intermission)}`;
  shadowText(ctx, status, 26, 90, '14px monospace', '#c8c8c8', 'left', 'top');

  // Points, health, armour and perks, bottom-left.
  shadowText(ctx, String(player.points), 24, VIEW_H - 48, `32px ${DISPLAY_FONT}`, powerUps.double > 0 ? '#ffe880' : '#f2d15c');
  const barW = 160 * (player.maxHp / 100) ** 0.5;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(24, VIEW_H - 38, barW, 8);
  ctx.fillStyle = player.hp > player.maxHp * 0.4 ? '#c8c8c8' : '#d03030';
  ctx.fillRect(24, VIEW_H - 38, barW * (player.hp / player.maxHp), 8);
  if (player.armourLevel > 0) {
    const cap = ARMOUR_LEVELS[player.armourLevel].cap;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(24, VIEW_H - 26, barW, 6);
    ctx.fillStyle = '#5a8ad8';
    ctx.fillRect(24, VIEW_H - 26, barW * (player.armour / cap), 6);
    shadowText(ctx, `Lv${player.armourLevel}`, 30 + barW, VIEW_H - 20, '11px monospace', '#7aa8ff');
  }
  let px = 24;
  for (const id of PERK_ORDER) {
    if (!player.perks.includes(id)) continue;
    const perk = PERK_VISUALS[id];
    ctx.fillStyle = perk.color;
    ctx.fillRect(px, VIEW_H - 100, 22, 22);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, VIEW_H - 100, 22, 22);
    shadowText(ctx, perk.letter, px + 11, VIEW_H - 88, `14px ${DISPLAY_FONT}`, '#ffffff', 'center', 'middle');
    px += 28;
  }

  // Weapon + ammo, bottom-right.
  const w = heldWeapon(player);
  const right = VIEW_W - 24;
  shadowText(ctx, weaponName(w.id, w.tier).toUpperCase(), right, VIEW_H - 74, `18px ${DISPLAY_FONT}`, '#e0e0e0', 'right');
  const ammoColor = w.mag === 0 ? '#d03030' : '#ffffff';
  shadowText(ctx, `/ ${w.reserve}`, right, VIEW_H - 24, '20px monospace', '#b0b0b0', 'right');
  ctx.font = '20px monospace';
  const reserveW = ctx.measureText(`/ ${w.reserve}`).width;
  shadowText(ctx, String(w.mag), right - reserveW - 8, VIEW_H - 24, `38px ${DISPLAY_FONT}`, ammoColor, 'right');
  const other = player.weapons[1 - player.slot];
  if (other) shadowText(ctx, `[Q] ${weaponName(other.id, other.tier)}`, right, VIEW_H - 100, '13px monospace', '#8a8a8a', 'right');

  // Reload / ammo warnings, under the crosshair area.
  let warn = '';
  if (w.reloadProgress > 0) drawReloadBar(ctx, w.reloadProgress);
  else if (w.mag === 0 && w.reserve === 0) warn = 'NO AMMO - KNIFE';
  else if (w.mag <= Math.ceil(magSize(w.id, w.tier) * 0.25)) warn = 'Press R to reload';
  if (warn) shadowText(ctx, warn, VIEW_W / 2, VIEW_H / 2 + 60, 'bold 16px monospace', warn.startsWith('NO AMMO') ? '#d03030' : '#ffffff', 'center');

  // Interaction prompt.
  const prompt = interactionPrompt(level, world, player);
  if (prompt) {
    ctx.font = '16px monospace';
    const tw = ctx.measureText(prompt.text).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(VIEW_W / 2 - tw / 2 - 12, VIEW_H - 120, tw + 24, 30);
    shadowText(ctx, prompt.text, VIEW_W / 2, VIEW_H - 105, '16px monospace', prompt.color, 'center', 'middle');
  }

  // Active power-ups, top centre.
  const timers: [string, number, string][] = [];
  if (powerUps.instakill > 0) timers.push(['INSTAKILL', powerUps.instakill, '#e04040']);
  if (powerUps.double > 0) timers.push(['DOUBLE POINTS', powerUps.double, '#f2d15c']);
  timers.forEach(([label, t, color], i) => {
    if (t < 5 && Math.floor(t * 6) % 2 === 0) return;
    shadowText(ctx, `${label} ${Math.ceil(t)}`, VIEW_W / 2, 24 + i * 22, 'bold 16px monospace', color, 'center', 'top');
  });

  if (game.callout.timer > 0) {
    ctx.globalAlpha = Math.min(1, game.callout.timer * 1.5);
    shadowText(ctx, game.callout.text, VIEW_W / 2, VIEW_H * 0.42, `40px ${DISPLAY_FONT}`, game.callout.color, 'center', 'middle');
    ctx.globalAlpha = 1;
  }

  if (game.nowPlaying.timer > 0 && !sound.muted) {
    ctx.globalAlpha = Math.min(1, game.nowPlaying.timer);
    shadowText(ctx, `\u266A ${game.nowPlaying.title}`, VIEW_W - 16, 16, '12px monospace', '#b0b0b0', 'right', 'top');
    ctx.globalAlpha = 1;
  }
  if (sound.muted) shadowText(ctx, 'MUTED (M)', VIEW_W - 16, 16, '12px monospace', '#9a9a9a', 'right', 'top');

  // Round banner.
  if (game.banner.timer > 0) {
    ctx.globalAlpha = Math.min(1, game.banner.timer);
    shadowText(ctx, game.banner.text, VIEW_W / 2, VIEW_H * 0.3, `56px ${DISPLAY_FONT}`, '#a01212', 'center', 'middle');
    ctx.globalAlpha = 1;
  }
}

const RELOAD_BAR_W = 120;
const RELOAD_BAR_H = 8;

function drawReloadBar(ctx: CanvasRenderingContext2D, progress: number): void {
  const x = (VIEW_W - RELOAD_BAR_W) / 2;
  // Bottom centre: clear of the player, and below the interaction prompt box.
  const y = VIEW_H - 56;
  shadowText(ctx, 'RELOADING', VIEW_W / 2, y - 6, 'bold 12px monospace', '#d0d0d0', 'center');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(x - 2, y - 2, RELOAD_BAR_W + 4, RELOAD_BAR_H + 4);
  ctx.fillStyle = '#f2d15c';
  ctx.fillRect(x, y, RELOAD_BAR_W * progress, RELOAD_BAR_H);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 1.5, y - 1.5, RELOAD_BAR_W + 3, RELOAD_BAR_H + 3);
}
