import { VIEW_H, VIEW_W, type Game } from '../core/Game';
import { sound } from '../audio/Sound';
import { PERK_VISUALS } from '../render/visuals';
import { TEAM_BODIES } from '../render/visuals';
import { ARMOUR_LEVELS, BLEEDOUT, magSize, PERK_ORDER, REVIVE_TIME, weaponName } from '../game/defs';
import { heldWeapon, type PlayerView } from '../view/WorldView';
import { interactionPrompt } from './prompts';
import { DISPLAY_FONT, shadowText } from './text';

export function drawHUD(ctx: CanvasRenderingContext2D, game: Game): void {
  const { world, level } = game;
  const { round: rounds, powerUps } = world;
  const player = game.me;

  // Damage vignette (not while spectating).
  const a = player.state === 'dead' ? 0 : Math.min(0.85, (1 - player.hp / player.maxHp) * 0.7 + game.playerFxOf(player.id).hurtFlash * 0.35);
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
  if (game.room && !game.room.solo) shadowText(ctx, `Room ${game.room.code}`, 26, 110, '13px monospace', '#8a8a8a', 'left', 'top');
  drawTeammates(ctx, game);

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

  // Revive and reload progress, or ammo warnings under the crosshair area; none while down.
  let warn = '';
  const it = player.interaction;
  const reviving = it?.kind === 'revive' ? world.players.find((o) => o.id === it.player) : undefined;
  if (player.state === 'alive') {
    if (reviving && reviving.reviveProgress > 0) drawProgressBar(ctx, 'REVIVING', reviving.reviveProgress / REVIVE_TIME);
    else if (w.reloadProgress > 0) drawProgressBar(ctx, 'RELOADING', w.reloadProgress);
    else if (w.mag === 0 && w.reserve === 0) warn = 'NO AMMO - KNIFE';
    else if (w.mag <= Math.ceil(magSize(w.id, w.tier) * 0.25)) warn = 'Press R to reload';
  }
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

  drawDownState(ctx, game, player);

  game.feed.forEach((line, i) => {
    ctx.globalAlpha = Math.min(1, line.timer);
    shadowText(ctx, line.text, VIEW_W / 2, 74 + i * 20, 'bold 14px monospace', line.color, 'center', 'top');
    ctx.globalAlpha = 1;
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

  if (game.room && game.link.status !== 'open' && Math.floor(game.time * 2) % 2 === 0) {
    shadowText(ctx, 'RECONNECTING…', VIEW_W / 2, VIEW_H * 0.36, `36px ${DISPLAY_FONT}`, '#e0e0e0', 'center', 'middle');
  }
}

const TEAM_W = 150;
const TEAM_ROW_H = 36;

/** Top right, under the music toast: everyone else's name, points, health and state. */
function drawTeammates(ctx: CanvasRenderingContext2D, game: Game): void {
  const others = game.world.players.filter((p) => p.id !== game.you);
  const x = VIEW_W - 16 - TEAM_W;
  others.forEach((p, i) => {
    const y = 40 + i * TEAM_ROW_H;
    const away = game.lobby?.players.find((l) => l.id === p.id)?.connected === false;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x - 6, y - 4, TEAM_W + 12, TEAM_ROW_H - 4);
    ctx.fillStyle = TEAM_BODIES[p.id % TEAM_BODIES.length].fill;
    ctx.fillRect(x - 6, y - 4, 3, TEAM_ROW_H - 4);
    shadowText(ctx, p.name, x, y, 'bold 12px monospace', '#e0e0e0', 'left', 'top');
    shadowText(ctx, String(p.points), x + TEAM_W, y, '12px monospace', '#f2d15c', 'right', 'top');
    const by = y + 18;
    if (p.state === 'alive') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(x, by, TEAM_W, 6);
      ctx.fillStyle = p.hp > p.maxHp * 0.4 ? '#c8c8c8' : '#d03030';
      ctx.fillRect(x, by, TEAM_W * (p.hp / p.maxHp), 6);
    } else {
      const label = p.state === 'downed' ? `DOWN  ${Math.ceil(p.bleedout)}s` : 'DEAD  back next round';
      shadowText(ctx, label, x, by - 3, 'bold 11px monospace', p.state === 'downed' ? '#e05040' : '#8a8a8a', 'left', 'top');
    }
    if (away) shadowText(ctx, 'AWAY', x + TEAM_W, by - 3, 'bold 11px monospace', '#e05050', 'right', 'top');
  });
}

/** Downed: the bleed-out timer (and revive progress). Dead: who you're watching until the next round. */
function drawDownState(ctx: CanvasRenderingContext2D, game: Game, player: PlayerView): void {
  const cx = VIEW_W / 2;
  if (player.state === 'downed') {
    shadowText(ctx, 'YOU ARE DOWN', cx, VIEW_H / 2 + 70, `30px ${DISPLAY_FONT}`, '#e05040', 'center', 'middle');
    const being = player.reviveProgress > 0;
    const text = being ? 'Being revived…' : `Bleeding out in ${Math.ceil(player.bleedout)}  ·  a teammate can revive you`;
    shadowText(ctx, text, cx, VIEW_H / 2 + 100, '15px monospace', '#e0e0e0', 'center', 'middle');
    const w = 220;
    const x = cx - w / 2;
    const y = VIEW_H / 2 + 116;
    const frac = being ? player.reviveProgress / REVIVE_TIME : player.bleedout / BLEEDOUT;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x - 2, y - 2, w + 4, 10);
    ctx.fillStyle = being ? '#ffffff' : '#d03030';
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), 6);
  } else if (player.state === 'dead') {
    const target = game.spectating;
    shadowText(ctx, target ? `SPECTATING ${target.name.toUpperCase()}` : 'YOU BLED OUT', cx, VIEW_H - 150, `26px ${DISPLAY_FONT}`, '#e0e0e0', 'center', 'middle');
    shadowText(ctx, "You'll be back at the start of the next round", cx, VIEW_H - 122, '14px monospace', '#a0a0a0', 'center', 'middle');
  }
}

const RELOAD_BAR_W = 120;
const RELOAD_BAR_H = 8;

function drawProgressBar(ctx: CanvasRenderingContext2D, label: string, progress: number): void {
  const x = (VIEW_W - RELOAD_BAR_W) / 2;
  // Bottom centre: clear of the player, and below the interaction prompt box.
  const y = VIEW_H - 56;
  shadowText(ctx, label, VIEW_W / 2, y - 6, 'bold 12px monospace', '#d0d0d0', 'center');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(x - 2, y - 2, RELOAD_BAR_W + 4, RELOAD_BAR_H + 4);
  ctx.fillStyle = '#f2d15c';
  ctx.fillRect(x, y, RELOAD_BAR_W * Math.min(1, progress), RELOAD_BAR_H);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 1.5, y - 1.5, RELOAD_BAR_W + 3, RELOAD_BAR_H + 3);
}
