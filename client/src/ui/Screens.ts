import { VIEW_H, VIEW_W, type Game } from '../core/Game';
import { DISPLAY_FONT, shadowText } from './text';

export function drawGameOver(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.75, game.gameOverTimer * 0.6)})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  shadowText(ctx, 'YOU DIED', VIEW_W / 2, 180, `80px ${DISPLAY_FONT}`, '#a01212', 'center', 'middle');
  const { round: rounds, kills, points } = game.result;
  const lines = [
    `You survived ${rounds} round${rounds === 1 ? '' : 's'}`,
    `Kills: ${kills}`,
    `Points earned: ${points}`,
  ];
  lines.forEach((l, i) => shadowText(ctx, l, VIEW_W / 2, 270 + i * 32, '20px monospace', '#e0e0e0', 'center', 'middle'));
  const { lastRank, entries } = game.scores;
  const best = entries[0];
  if (lastRank === 0) {
    shadowText(ctx, 'NEW BEST!', VIEW_W / 2, 380, `28px ${DISPLAY_FONT}`, '#f2d15c', 'center', 'middle');
  } else if (lastRank > 0) {
    shadowText(ctx, `#${lastRank + 1} on the high scores`, VIEW_W / 2, 380, `24px ${DISPLAY_FONT}`, '#f2d15c', 'center', 'middle');
  } else if (best) {
    shadowText(ctx, `Best: ${best.name ? `${best.name}, ` : ''}${best.round} rounds, ${best.kills} kills`, VIEW_W / 2, 380, '15px monospace', '#a0a0a0', 'center', 'middle');
  }
  if (game.gameOverTimer > 1.5) {
    if (Math.floor(game.time * 2) % 2 === 0) {
      shadowText(ctx, 'Click or press Enter to play again', VIEW_W / 2, 450, 'bold 18px monospace', '#ffffff', 'center', 'middle');
    }
    shadowText(ctx, 'Esc for main menu', VIEW_W / 2, 482, '14px monospace', '#9a9a9a', 'center', 'middle');
  }
}
