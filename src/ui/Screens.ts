import { VIEW_H, VIEW_W, type Game } from '../core/Game';
import { DISPLAY_FONT, shadowText } from './text';

function dim(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

const CONTROLS = [
  ['WASD / Arrows', 'Move'],
  ['Mouse', 'Aim'],
  ['Space / Left Click', 'Shoot'],
  ['R', 'Reload'],
  ['E', 'Rebuild barricades (hold) / buy weapons'],
  ['1 / 2 / Q / Wheel', 'Switch weapon'],
  ['M', 'Mute'],
  ['F / V', 'Knife (automatic when out of ammo)'],
  ['Esc / P', 'Pause'],
];

export function drawTitle(ctx: CanvasRenderingContext2D, game: Game): void {
  const time = game.time;
  dim(ctx, 0.7);
  shadowText(ctx, 'BOARDED UP', VIEW_W / 2, 140, `84px ${DISPLAY_FONT}`, '#a01212', 'center', 'middle');
  shadowText(ctx, 'Hold the house. Survive the rounds.', VIEW_W / 2, 200, '16px monospace', '#c8c8c8', 'center', 'middle');

  CONTROLS.forEach(([key, action], i) => {
    const y = 260 + i * 26;
    shadowText(ctx, key, VIEW_W / 2 - 16, y, 'bold 15px monospace', '#f2d15c', 'right', 'middle');
    shadowText(ctx, action, VIEW_W / 2 + 16, y, '15px monospace', '#e0e0e0', 'left', 'middle');
  });

  if (game.best.round > 0) {
    shadowText(ctx, `Best: ${game.best.round} rounds, ${game.best.kills} kills`, VIEW_W / 2, 460, '15px monospace', '#a0a0a0', 'center', 'middle');
  }
  if (Math.floor(time * 2) % 2 === 0) {
    shadowText(ctx, 'Click or press Enter to start', VIEW_W / 2, 500, 'bold 18px monospace', '#ffffff', 'center', 'middle');
  }
}

export function drawPause(ctx: CanvasRenderingContext2D): void {
  dim(ctx, 0.6);
  shadowText(ctx, 'PAUSED', VIEW_W / 2, VIEW_H / 2 - 20, `64px ${DISPLAY_FONT}`, '#e0e0e0', 'center', 'middle');
  shadowText(ctx, 'Press Esc or click to resume', VIEW_W / 2, VIEW_H / 2 + 36, '16px monospace', '#c8c8c8', 'center', 'middle');
}

export function drawGameOver(ctx: CanvasRenderingContext2D, game: Game): void {
  dim(ctx, Math.min(0.75, game.gameOverTimer * 0.6));
  shadowText(ctx, 'YOU DIED', VIEW_W / 2, 180, `80px ${DISPLAY_FONT}`, '#a01212', 'center', 'middle');
  const rounds = Math.max(0, game.rounds.round - 1);
  const lines = [
    `You survived ${rounds} round${rounds === 1 ? '' : 's'}`,
    `Kills: ${game.kills}`,
    `Points earned: ${game.economy.earned}`,
  ];
  lines.forEach((l, i) => shadowText(ctx, l, VIEW_W / 2, 270 + i * 32, '20px monospace', '#e0e0e0', 'center', 'middle'));
  if (game.newBest) {
    shadowText(ctx, 'NEW BEST!', VIEW_W / 2, 380, `28px ${DISPLAY_FONT}`, '#f2d15c', 'center', 'middle');
  } else if (game.best.round > 0) {
    shadowText(ctx, `Best: ${game.best.round} rounds, ${game.best.kills} kills`, VIEW_W / 2, 380, '15px monospace', '#a0a0a0', 'center', 'middle');
  }
  if (game.gameOverTimer > 1.5 && Math.floor(game.time * 2) % 2 === 0) {
    shadowText(ctx, 'Click or press Enter to play again', VIEW_W / 2, 450, 'bold 18px monospace', '#ffffff', 'center', 'middle');
  }
}
