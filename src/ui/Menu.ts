import { sound, type VolumeChannel } from '../audio/Sound';
import { VIEW_H, VIEW_W, type Game } from '../core/Game';
import { MAX_SCORES } from '../systems/HighScore';
import { DISPLAY_FONT, shadowText } from './text';

/** Title menu and pause menu: pages of buttons/sliders driven by keyboard or mouse. */

type Page = 'main' | 'scores' | 'audio' | 'controls';
export type MenuMode = 'title' | 'pause';

type Item =
  | { type: 'button'; label: string; run: () => void }
  | { type: 'slider'; label: string; get: () => number; set: (v: number) => void }
  | { type: 'toggle'; label: string; get: () => boolean; set: (v: boolean) => void };

interface Rect { x: number; y: number; w: number; h: number }

/** Where each page's item column starts, and row spacing. */
const LAYOUT: Record<Page, { y: number; step: number; w: number }> = {
  main: { y: 290, step: 52, w: 300 },
  audio: { y: 180, step: 54, w: 560 },
  scores: { y: 515, step: 0, w: 240 },
  controls: { y: 515, step: 0, w: 240 },
};
const PAUSE_MAIN_Y = 230;
const ROW_H = 42;
const BUTTON_MAX_W = 300;
/** Slider track span inside a row: offset from the left edge and inset from the right. */
const TRACK_LEFT = 200;
const TRACK_RIGHT = 90;
const SLIDER_STEP = 0.1;

const CONTROLS = [
  ['WASD / Arrows', 'Move'],
  ['Mouse', 'Aim'],
  ['Space / Left Click', 'Shoot'],
  ['R', 'Reload'],
  ['E', 'Buy / use  (hold to rebuild)'],
  ['F / V', 'Knife  (auto when out of ammo)'],
  ['1 / 2 / Q / Wheel', 'Switch weapon'],
  ['M', 'Mute'],
  ['Esc / P', 'Pause'],
];

const TITLES: Record<Page, string> = {
  main: 'PAUSED', scores: 'HIGH SCORES', audio: 'AUDIO', controls: 'CONTROLS',
};

export class Menu {
  mode: MenuMode = 'title';
  page: Page = 'main';
  private index = 0;
  /** Main-page selection to restore when backing out of a sub-page. */
  private mainIndex = 0;
  private lastMouse = { x: -1, y: -1 };

  open(mode: MenuMode): void {
    this.mode = mode;
    this.page = 'main';
    this.index = this.mainIndex = 0;
  }

  private go(page: Page): void {
    if (this.page === 'main') this.mainIndex = this.index;
    this.page = page;
    this.index = page === 'main' ? this.mainIndex : 0;
  }

  private items(game: Game): Item[] {
    const back: Item = { type: 'button', label: 'Back', run: () => this.go('main') };
    const volume = (label: string, ch: VolumeChannel): Item => ({
      type: 'slider', label, get: () => sound.volume(ch), set: (v) => sound.setVolume(ch, v),
    });
    switch (this.page) {
      case 'main':
        return [
          this.mode === 'title'
            ? { type: 'button', label: 'New Game', run: () => game.newGame() }
            : { type: 'button', label: 'Resume', run: () => game.resume() },
          ...(this.mode === 'title' ? [{ type: 'button', label: 'High Scores', run: () => this.go('scores') } as Item] : []),
          { type: 'button', label: 'Audio', run: () => this.go('audio') },
          { type: 'button', label: 'Controls', run: () => this.go('controls') },
          ...(this.mode === 'pause' ? [{ type: 'button', label: 'Quit to Menu', run: () => game.toMenu() } as Item] : []),
        ];
      case 'audio':
        return [
          volume('Master', 'master'),
          volume('Music', 'music'),
          volume('Effects', 'sfx'),
          { type: 'toggle', label: 'Mute', get: () => sound.muted, set: () => sound.toggleMute() },
          { type: 'button', label: 'Next Track', run: () => sound.skipTrack() },
          back,
        ];
      default:
        return [back];
    }
  }

  private rects(items: Item[]): Rect[] {
    const l = LAYOUT[this.page];
    const y0 = this.page === 'main' && this.mode === 'pause' ? PAUSE_MAIN_Y : l.y;
    return items.map((it, i) => {
      const w = it.type === 'button' ? Math.min(l.w, BUTTON_MAX_W) : l.w;
      return { x: (VIEW_W - w) / 2, y: y0 + i * l.step, w, h: ROW_H };
    });
  }

  update(game: Game): void {
    const inp = game.input;
    const items = this.items(game);
    const rects = this.rects(items);

    if (inp.wasPressed('Escape', 'Backspace')) {
      sound.menuMove();
      if (this.page !== 'main') this.go('main');
      else if (this.mode === 'pause') game.resume();
      return;
    }

    const step = (inp.wasPressed('ArrowDown', 'KeyS') ? 1 : 0) - (inp.wasPressed('ArrowUp', 'KeyW') ? 1 : 0);
    if (step) {
      this.index = (this.index + step + items.length) % items.length;
      sound.menuMove();
    }

    // Hover only steals the selection when the mouse actually moves, so a resting cursor doesn't fight the keys.
    const m = inp.mouse;
    const moved = m.x !== this.lastMouse.x || m.y !== this.lastMouse.y;
    this.lastMouse = { x: m.x, y: m.y };
    const hover = rects.findIndex((r) => m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h);
    if (hover >= 0 && hover !== this.index && (moved || inp.mousePressed)) {
      this.index = hover;
      sound.menuMove();
    }

    const item = items[this.index];
    const r = rects[this.index];
    if (item.type === 'slider') {
      const dir = (inp.wasPressed('ArrowRight', 'KeyD') ? 1 : 0) - (inp.wasPressed('ArrowLeft', 'KeyA') ? 1 : 0);
      if (dir) setSlider(item, item.get() + dir * SLIDER_STEP);
      if (inp.mouseDown && hover === this.index) {
        const x0 = r.x + TRACK_LEFT;
        setSlider(item, (m.x - x0) / (r.w - TRACK_LEFT - TRACK_RIGHT));
      }
    } else if (inp.wasPressed('Enter', 'Space') || (inp.mousePressed && hover === this.index)) {
      sound.menuSelect();
      if (item.type === 'button') item.run();
      else item.set(!item.get());
    }
  }

  draw(ctx: CanvasRenderingContext2D, game: Game): void {
    const items = this.items(game);
    const rects = this.rects(items);
    const cx = VIEW_W / 2;

    ctx.fillStyle = `rgba(0, 0, 0, ${this.mode === 'title' ? 0.72 : 0.62})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    vignette(ctx);

    if (this.page === 'main' && this.mode === 'title') {
      drawLogo(ctx, cx, 135);
      shadowText(ctx, 'Hold the house. Survive the rounds.', cx, 215, '16px monospace', '#c8c8c8', 'center', 'middle');
      const best = game.scores[0];
      if (best) {
        shadowText(ctx, `Best: ${plural(best.round, 'round')} · ${plural(best.kills, 'kill')}`, cx, 520, '15px monospace', '#a0a0a0', 'center', 'middle');
      }
    } else {
      shadowText(ctx, TITLES[this.page], cx, this.page === 'main' ? 140 : 95, `${this.page === 'main' ? 64 : 52}px ${DISPLAY_FONT}`, '#e0e0e0', 'center', 'middle');
    }
    if (this.page === 'scores') drawScores(ctx, game);
    else if (this.page === 'controls') drawControls(ctx);
    else if (this.page === 'audio' && game.nowPlaying.title) {
      shadowText(ctx, `Now playing: ${game.nowPlaying.title}`, cx, 140, '14px monospace', '#9a9a9a', 'center', 'middle');
    }

    items.forEach((it, i) => drawItem(ctx, it, rects[i], i === this.index));

    const hint = this.page === 'audio'
      ? '↑↓ select   ←→ adjust   Enter toggle   Esc back'
      : this.page === 'main' && this.mode === 'title'
        ? '↑↓ select   Enter confirm'
        : '↑↓ select   Enter confirm   Esc back';
    shadowText(ctx, hint, cx, VIEW_H - 22, '13px monospace', '#7a7a7a', 'center', 'middle');
  }
}

function setSlider(item: Extract<Item, { type: 'slider' }>, raw: number): void {
  // Snap to 5% so dragging only ticks (and saves) on visible changes.
  const v = Math.min(1, Math.max(0, Math.round(raw * 20) / 20));
  if (v === item.get()) return;
  item.set(v);
  sound.menuMove();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function vignette(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.65);
  g.addColorStop(0, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

/** A nailed-on board, drawn centred at (x, y). */
function drawPlank(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(-w / 2 + 5, -h / 2 + 5, w, h);
  ctx.fillStyle = '#4e3520';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = '#634429';
  ctx.fillRect(-w / 2, -h / 2, w, h * 0.5);
  ctx.strokeStyle = 'rgba(25, 14, 6, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const gy = -h / 2 + h * (0.25 + i * 0.25);
    ctx.moveTo(-w / 2 + 10 + i * 40, gy);
    ctx.lineTo(w / 2 - 30 - i * 25, gy + (i - 1) * 2);
  }
  ctx.stroke();
  ctx.fillStyle = '#8c8c8c';
  for (const nx of [-w / 2 + 16, w / 2 - 16]) {
    ctx.beginPath();
    ctx.arc(nx, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  drawPlank(ctx, x - 6, y - 20, 580, 36, -0.05);
  drawPlank(ctx, x + 8, y + 24, 540, 34, 0.04);
  shadowText(ctx, 'BOARDED UP', x, y, `92px ${DISPLAY_FONT}`, '#b01414', 'center', 'middle');
}

function drawItem(ctx: CanvasRenderingContext2D, it: Item, r: Rect, sel: boolean): void {
  ctx.fillStyle = sel ? 'rgba(140, 16, 16, 0.9)' : 'rgba(12, 12, 12, 0.72)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = sel ? '#e04848' : 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);

  const my = r.y + r.h / 2;
  const color = sel ? '#ffffff' : '#c8c8c8';
  if (it.type === 'button') {
    shadowText(ctx, it.label, r.x + r.w / 2, my + 1, `24px ${DISPLAY_FONT}`, color, 'center', 'middle');
    return;
  }
  shadowText(ctx, it.label, r.x + 22, my + 1, `22px ${DISPLAY_FONT}`, color, 'left', 'middle');
  if (it.type === 'toggle') {
    const on = it.get();
    shadowText(ctx, on ? 'ON' : 'OFF', r.x + r.w - 22, my, 'bold 16px monospace', on ? '#f2d15c' : '#8a8a8a', 'right', 'middle');
    return;
  }
  const v = it.get();
  const tx = r.x + TRACK_LEFT;
  const tw = r.w - TRACK_LEFT - TRACK_RIGHT;
  ctx.fillStyle = '#262626';
  ctx.fillRect(tx, my - 4, tw, 8);
  ctx.fillStyle = sel ? '#f2d15c' : '#a03030';
  ctx.fillRect(tx, my - 4, tw * v, 8);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(tx + tw * v - 5, my - 11, 10, 22);
  shadowText(ctx, `${Math.round(v * 100)}%`, r.x + r.w - 22, my, 'bold 16px monospace', color, 'right', 'middle');
}

function drawScores(ctx: CanvasRenderingContext2D, game: Game): void {
  const cols = [
    { x: 270, label: '#' },
    { x: 380, label: 'ROUNDS' },
    { x: 490, label: 'KILLS' },
    { x: 610, label: 'POINTS' },
    { x: 730, label: 'DATE' },
  ];
  const top = 145;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(200, top, 560, 350);
  cols.forEach((c) => shadowText(ctx, c.label, c.x, top + 22, 'bold 13px monospace', '#7a7a7a', 'center', 'middle'));

  if (game.scores.length === 0) {
    shadowText(ctx, 'No runs yet. Grab a hammer.', VIEW_W / 2, top + 170, '16px monospace', '#a0a0a0', 'center', 'middle');
    return;
  }
  for (let i = 0; i < MAX_SCORES; i++) {
    const s = game.scores[i];
    const y = top + 56 + i * 29;
    if (!s) {
      shadowText(ctx, `${i + 1}`, cols[0].x, y, '16px monospace', '#444', 'center', 'middle');
      continue;
    }
    const color = i === game.lastRank ? '#f2d15c' : i === 0 ? '#ffffff' : '#c8c8c8';
    const date = s.date ? new Date(s.date).toLocaleDateString() : '—';
    [`${i + 1}`, `${s.round}`, `${s.kills}`, s.points ? `${s.points}` : '—', date]
      .forEach((v, c) => shadowText(ctx, v, cols[c].x, y, '16px monospace', color, 'center', 'middle'));
  }
}

function drawControls(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(170, 145, 620, 345);
  CONTROLS.forEach(([key, action], i) => {
    const y = 180 + i * 35;
    shadowText(ctx, key, VIEW_W / 2 - 20, y, 'bold 16px monospace', '#f2d15c', 'right', 'middle');
    shadowText(ctx, action, VIEW_W / 2 + 20, y, '16px monospace', '#e0e0e0', 'left', 'middle');
  });
}
