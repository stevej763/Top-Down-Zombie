import { VIEW_H, VIEW_W, type Game } from '../core/Game';
import { MAX_SCORES } from '../systems/HighScore';
import { DISPLAY_FONT, shadowText } from './text';

const COLS = { name: 300, kills: 560, points: 660 };

/** The results from the server's `gameOver`: rounds survived, then everyone's kills and points. */
export function drawGameOver(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.75, game.gameOverTimer * 0.6)})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const result = game.result;
  if (!result) return;
  const solo = game.room?.solo ?? result.players.length === 1;
  const cx = VIEW_W / 2;
  shadowText(ctx, solo ? 'YOU DIED' : 'OVERRUN', cx, 150, `80px ${DISPLAY_FONT}`, '#a01212', 'center', 'middle');
  const rounds = result.round;
  shadowText(ctx, `${solo ? 'You' : 'The team'} survived ${rounds} round${rounds === 1 ? '' : 's'}`, cx, 220, '20px monospace', '#e0e0e0', 'center', 'middle');

  const top = 262;
  shadowText(ctx, 'KILLS', COLS.kills, top, 'bold 13px monospace', '#7a7a7a', 'center', 'middle');
  shadowText(ctx, 'POINTS', COLS.points, top, 'bold 13px monospace', '#7a7a7a', 'center', 'middle');
  result.players.forEach((p, i) => {
    const y = top + 30 + i * 28;
    const color = p.id === game.you ? '#ffffff' : '#b8b8b8';
    shadowText(ctx, p.name, COLS.name, y, 'bold 18px monospace', color, 'left', 'middle');
    shadowText(ctx, String(p.kills), COLS.kills, y, '18px monospace', color, 'center', 'middle');
    shadowText(ctx, String(p.points), COLS.points, y, '18px monospace', color, 'center', 'middle');
  });

  const rank = game.myResult?.rank ?? -1;
  const best = game.scores.entries[0];
  const y = top + 30 + result.players.length * 28 + 20;
  if (rank === 0) {
    shadowText(ctx, 'NEW RECORD!', cx, y, `28px ${DISPLAY_FONT}`, '#f2d15c', 'center', 'middle');
  } else if (rank > 0 && rank < MAX_SCORES) {
    shadowText(ctx, `#${rank + 1} on the high scores`, cx, y, `24px ${DISPLAY_FONT}`, '#f2d15c', 'center', 'middle');
  } else if (best) {
    shadowText(ctx, `Record: ${best.name}, ${best.round} rounds, ${best.kills} kills`, cx, y, '15px monospace', '#a0a0a0', 'center', 'middle');
  }
  if (game.gameOverTimer > 1.5) {
    const again = solo ? 'Click or press Enter to play again' : 'Click or press Enter to return to the lobby';
    if (Math.floor(game.time * 2) % 2 === 0) shadowText(ctx, again, cx, 482, 'bold 18px monospace', '#ffffff', 'center', 'middle');
    shadowText(ctx, 'Esc for main menu', cx, 514, '14px monospace', '#9a9a9a', 'center', 'middle');
  }
}
