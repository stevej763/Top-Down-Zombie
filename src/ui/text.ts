export const DISPLAY_FONT = 'Impact, "Arial Black", sans-serif';

export function shadowText(
  ctx: CanvasRenderingContext2D, s: string, x: number, y: number,
  font: string, color: string, align: CanvasTextAlign = 'left', baseline: CanvasTextBaseline = 'alphabetic',
): void {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillText(s, x + 2, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}
