import { sound, type VolumeChannel } from '../audio/Sound';
import { VIEW_H, VIEW_W, type Game } from '../core/Game';
import { loadIdentity, NAME_MAX, setName, validName } from '../net/api';
import { MAX_SCORES } from '../systems/HighScore';
import { controlText } from './keys';
import { DISPLAY_FONT, shadowText } from './text';

/** Title menu and pause menu: pages of buttons/sliders driven by keyboard or mouse. */

type Page = 'main' | 'scores' | 'audio' | 'controls' | 'name' | 'maps' | 'mode' | 'join' | 'lobby';
export type MenuMode = 'title' | 'pause';

type Item =
  | { type: 'button'; label: string; run: () => void }
  | { type: 'slider'; label: string; get: () => number; set: (v: number) => void }
  | { type: 'toggle'; label: string; get: () => boolean; set: (v: boolean) => void }
  | { type: 'text'; label: string; max: number; get: () => string; set: (v: string) => void; submit: () => void };

interface Rect { x: number; y: number; w: number; h: number }

/** Where each page's item column starts, and row spacing. */
const LAYOUT: Record<Page, { y: number; step: number; w: number }> = {
  main: { y: 270, step: 44, w: 300 },
  audio: { y: 180, step: 54, w: 560 },
  scores: { y: 515, step: 0, w: 240 },
  controls: { y: 515, step: 0, w: 240 },
  name: { y: 250, step: 56, w: 440 },
  maps: { y: 200, step: 52, w: 300 },
  mode: { y: 230, step: 52, w: 300 },
  join: { y: 250, step: 56, w: 440 },
  lobby: { y: 430, step: 52, w: 300 },
};
/** Room codes: 4 letters, without I, L or O (LobbyService.CODE_LETTERS). */
const CODE_LENGTH = 4;
const CODE_FILTER = /[^A-HJKMNP-Z]/g;
const PAUSE_MAIN_Y = 230;
const ROW_H = 42;
const BUTTON_MAX_W = 300;
/** Slider track span inside a row: offset from the left edge and inset from the right. */
const TRACK_LEFT = 200;
const TRACK_RIGHT = 90;
const SLIDER_STEP = 0.1;

const TITLES: Record<Page, string> = {
  main: 'PAUSED', scores: 'HIGH SCORES', audio: 'AUDIO', controls: 'CONTROLS', name: 'YOUR NAME', maps: 'CHOOSE MAP',
  mode: 'NEW GAME', join: 'JOIN GAME', lobby: 'LOBBY',
};

export class Menu {
  mode: MenuMode = 'title';
  page: Page = 'main';
  private index = 0;
  /** Main-page selection to restore when backing out of a sub-page. */
  private mainIndex = 0;
  private lastMouse = { x: -1, y: -1 };
  private nameDraft = '';
  private codeDraft = '';
  /** What confirming the name page does: carry on to New Game or Join Game (first play), or return to the menu. */
  private nameThen: 'play' | 'join' | 'back' = 'back';
  private notice = '';
  /** Waiting for the server to answer a create or join; ignore further picks. */
  private loading = false;

  open(mode: MenuMode): void {
    this.mode = mode;
    this.page = 'main';
    this.index = this.mainIndex = 0;
  }

  /** The server refused something (or the connection was lost); show why. */
  fail(message: string): void {
    this.notice = message;
    this.loading = false;
    sound.denied();
  }

  /** The server answered the create or join. */
  done(): void {
    this.loading = false;
    this.notice = '';
  }

  showLobby(): void {
    this.go('lobby');
  }

  private go(page: Page): void {
    if (this.page === 'main') this.mainIndex = this.index;
    this.page = page;
    this.index = page === 'main' ? this.mainIndex : 0;
    this.notice = '';
  }

  /** New Game: ask for a name the first time, then pick a map if there's a choice, then solo or co-op. */
  private startRun(game: Game): void {
    if (!loadIdentity()) this.openName('play');
    else this.afterName(game);
  }

  private afterName(game: Game): void {
    if (game.maps.length <= 1) {
      this.go('mode');
      return;
    }
    this.go('maps');
    this.index = Math.max(0, game.maps.findIndex((m) => m.id === game.mapId));
  }

  private chooseMap(game: Game, id: string): void {
    game.selectMap(id);
    this.go('mode');
  }

  private openJoin(): void {
    if (!loadIdentity()) {
      this.openName('join');
      return;
    }
    this.codeDraft = '';
    this.go('join');
  }

  /** Ask the server for a room; `welcome` (or an error) ends the wait. */
  private request(run: () => void): void {
    if (this.loading) return;
    this.loading = true;
    this.notice = 'Connecting…';
    run();
  }

  private submitCode(game: Game): void {
    if (this.codeDraft.length !== CODE_LENGTH) {
      this.fail(`Codes are ${CODE_LENGTH} letters`);
      return;
    }
    this.request(() => game.joinRoom(this.codeDraft));
  }

  /** Esc or Back out of a page that may hold a room (or be waiting for one). */
  private leave(game: Game): void {
    if (this.loading || this.page === 'lobby') game.leaveRoom();
    this.loading = false;
    this.go('main');
  }

  private cycleScoresMap(game: Game, dir: number): void {
    const n = game.maps.length;
    if (n <= 1) return;
    const i = game.maps.findIndex((m) => m.id === game.scores.mapId);
    game.scores.show(game.maps[(i + dir + n) % n].id);
    sound.menuMove();
  }

  private openName(then: 'play' | 'join' | 'back'): void {
    this.nameDraft = loadIdentity()?.name ?? '';
    this.nameThen = then;
    this.go('name');
  }

  private submitName(game: Game): void {
    const name = this.nameDraft.trim();
    if (!validName(name)) {
      this.notice = name ? "Letters, numbers, spaces and . _ ' - only" : 'Type a name first';
      sound.denied();
      return;
    }
    // Registration finishes in the background; a failed one is retried when a score is submitted.
    void setName(name);
    if (this.nameThen === 'play') this.afterName(game);
    else if (this.nameThen === 'join') this.openJoin();
    else this.go('main');
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
            ? { type: 'button', label: 'New Game', run: () => this.startRun(game) }
            : { type: 'button', label: 'Resume', run: () => game.resume() },
          ...(this.mode === 'title'
            ? [
              { type: 'button', label: 'Join Game', run: () => this.openJoin() },
              { type: 'button', label: 'High Scores', run: () => { this.go('scores'); game.scores.show(game.mapId); } },
              { type: 'button', label: 'Player Name', run: () => this.openName('back') },
            ] as Item[]
            : []),
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
      case 'maps':
        return [
          ...game.maps.map((m): Item => ({ type: 'button', label: m.name, run: () => this.chooseMap(game, m.id) })),
          back,
        ];
      case 'mode':
        return [
          { type: 'button', label: 'Play Solo', run: () => this.request(() => game.createRoom(true)) },
          { type: 'button', label: 'Host Co-op', run: () => this.request(() => game.createRoom(false)) },
          { type: 'button', label: 'Back', run: () => this.leave(game) },
        ];
      case 'join':
        return [
          {
            type: 'text', label: 'Code', max: CODE_LENGTH, get: () => this.codeDraft,
            set: (v) => { this.codeDraft = v.toUpperCase().replace(CODE_FILTER, ''); this.notice = ''; },
            submit: () => this.submitCode(game),
          },
          { type: 'button', label: 'Join', run: () => this.submitCode(game) },
          { type: 'button', label: 'Back', run: () => this.leave(game) },
        ];
      case 'lobby': {
        const me = game.lobbyMe;
        return [
          game.isHost
            ? { type: 'button', label: 'Start', run: () => game.startGame() }
            : { type: 'toggle', label: 'Ready', get: () => me?.ready ?? false, set: (v) => game.setReady(v) },
          { type: 'button', label: 'Leave', run: () => this.leave(game) },
        ];
      }
      case 'name':
        return [
          {
            type: 'text', label: 'Name', max: NAME_MAX, get: () => this.nameDraft,
            set: (v) => { this.nameDraft = v; this.notice = ''; }, submit: () => this.submitName(game),
          },
          { type: 'button', label: this.nameThen === 'back' ? 'Save' : 'Next', run: () => this.submitName(game) },
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
    // While a text field is selected, letters and Backspace type instead of navigating.
    const typing = items[this.index].type === 'text';

    if (inp.wasPressed('Escape') || (!typing && inp.wasPressed('Backspace'))) {
      sound.menuMove();
      if (this.page === 'mode' || this.page === 'join' || this.page === 'lobby') this.leave(game);
      else if (this.page !== 'main') this.go('main');
      else if (this.mode === 'pause') game.resume();
      return;
    }

    const down = typing ? inp.wasPressed('ArrowDown') : inp.wasPressed('ArrowDown', 'KeyS');
    const up = typing ? inp.wasPressed('ArrowUp') : inp.wasPressed('ArrowUp', 'KeyW');
    const step = (down ? 1 : 0) - (up ? 1 : 0);
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

    if (this.page === 'scores') {
      const dir = (inp.wasPressed('ArrowRight', 'KeyD') ? 1 : 0) - (inp.wasPressed('ArrowLeft', 'KeyA') ? 1 : 0);
      if (dir) this.cycleScoresMap(game, dir);
    }

    const item = items[this.index];
    const r = rects[this.index];
    if (item.type === 'text') {
      // Only if it was already selected at the start of the tick, so the S that moved here isn't typed.
      if (typing) {
        if (inp.typed) item.set((item.get() + inp.typed).slice(0, item.max));
        if (inp.wasPressed('Backspace')) item.set(item.get().slice(0, -1));
      }
      if (inp.wasPressed('Enter')) {
        sound.menuSelect();
        item.submit();
      }
    } else if (item.type === 'slider') {
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
      const parts: string[] = [];
      const name = loadIdentity()?.name;
      if (name) parts.push(`Playing as ${name}`);
      const best = game.scores.entries[0];
      if (best) {
        const who = best.name ? `${best.name}, ` : '';
        parts.push(`${game.scores.online ? 'Record' : 'Best'}: ${who}${plural(best.round, 'round')} · ${plural(best.kills, 'kill')}`);
      }
      if (parts.length) shadowText(ctx, parts.join('   ·   '), cx, 548, '15px monospace', '#a0a0a0', 'center', 'middle');
    } else {
      shadowText(ctx, TITLES[this.page], cx, this.page === 'main' ? 140 : 95, `${this.page === 'main' ? 64 : 52}px ${DISPLAY_FONT}`, '#e0e0e0', 'center', 'middle');
    }
    if (this.page === 'scores') drawScores(ctx, game);
    else if (this.page === 'name') {
      shadowText(ctx, 'Shown on the online high scores.', cx, 200, '16px monospace', '#c8c8c8', 'center', 'middle');
    } else if (this.page === 'mode') {
      const map = game.maps.find((m) => m.id === game.mapId)?.name ?? game.mapId;
      shadowText(ctx, map, cx, 170, '18px monospace', '#c8c8c8', 'center', 'middle');
    } else if (this.page === 'join') {
      shadowText(ctx, 'Ask the host for their room code.', cx, 200, '16px monospace', '#c8c8c8', 'center', 'middle');
    } else if (this.page === 'lobby') {
      drawLobby(ctx, game);
    } else if (this.page === 'main' && this.mode === 'pause' && game.room) {
      shadowText(ctx, 'The game keeps running', cx, 190, '15px monospace', '#c8c8c8', 'center', 'middle');
    }
    const notice = this.loading && game.link.problem ? `${game.link.problem}. Retrying…` : this.notice;
    if (notice && rects.length) {
      const last = rects[rects.length - 1];
      const color = this.loading && !game.link.problem ? '#c8c8c8' : '#e05050';
      shadowText(ctx, notice, cx, last.y + last.h + 36, '16px monospace', color, 'center', 'middle');
    }
    else if (this.page === 'controls') drawControls(ctx);
    else if (this.page === 'audio' && game.nowPlaying.title) {
      shadowText(ctx, `Now playing: ${game.nowPlaying.title}`, cx, 140, '14px monospace', '#9a9a9a', 'center', 'middle');
    }

    items.forEach((it, i) => drawItem(ctx, it, rects[i], i === this.index));

    const hint = !controlText.menuHints
      ? this.page === 'lobby' ? 'Share the code with your friends' : ''
      : this.page === 'audio'
      ? '↑↓ select   ←→ adjust   Enter toggle   Esc back'
      : this.page === 'name'
        ? 'Type your name   Enter confirm   Esc back'
        : this.page === 'join'
          ? 'Type the code   Enter join   Esc back'
        : this.page === 'lobby'
          ? 'Share the code with your friends   Esc leave'
        : this.page === 'scores' && game.maps.length > 1
          ? '←→ change map   Esc back'
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
  if (it.type === 'text') {
    const caret = sel && Math.floor(performance.now() / 500) % 2 === 0 ? '_' : ' ';
    shadowText(ctx, it.get() + caret, r.x + 110, my, 'bold 18px monospace', '#ffffff', 'left', 'middle');
    return;
  }
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

interface Column { x: number; label: string; align?: CanvasTextAlign }

const SCORE_TABLE = { x: 120, w: 720 };
const SCORE_COLS: Column[] = [
  { x: 160, label: '#' }, { x: 200, label: 'NAME', align: 'left' }, { x: 470, label: 'ROUNDS' },
  { x: 560, label: 'KILLS' }, { x: 660, label: 'POINTS' }, { x: 770, label: 'DATE' },
];

function drawScores(ctx: CanvasRenderingContext2D, game: Game): void {
  const board = game.scores;
  const { x, w } = SCORE_TABLE;
  const cols = SCORE_COLS;
  const top = 145;
  const status = board.loading ? 'Loading…' : board.online ? 'Online leaderboard' : "Can't reach the server";
  const mapName = game.maps.find((m) => m.id === board.mapId)?.name ?? board.mapId;
  const label = game.maps.length > 1 ? `◀  ${mapName}  ▶` : mapName;
  shadowText(ctx, `${label}   ·   ${status}`, VIEW_W / 2, 130, '14px monospace', '#9a9a9a', 'center', 'middle');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(x, top, w, 350);
  cols.forEach((c) => shadowText(ctx, c.label, c.x, top + 22, 'bold 13px monospace', '#7a7a7a', c.align ?? 'center', 'middle'));

  if (board.entries.length === 0) {
    const empty = board.online || board.loading ? 'No runs yet. Grab a hammer.' : 'High scores are kept on the server.';
    shadowText(ctx, empty, VIEW_W / 2, top + 170, '16px monospace', '#a0a0a0', 'center', 'middle');
    return;
  }
  for (let i = 0; i < MAX_SCORES; i++) {
    const s = board.entries[i];
    const y = top + 56 + i * 29;
    if (!s) {
      shadowText(ctx, `${i + 1}`, cols[0].x, y, '16px monospace', '#444', 'center', 'middle');
      continue;
    }
    const color = i === board.lastRank ? '#f2d15c' : i === 0 ? '#ffffff' : '#c8c8c8';
    const date = s.date ? new Date(s.date).toLocaleDateString() : '—';
    const name = s.partySize > 1 ? `${s.name} (${s.partySize}P)` : s.name;
    const values = [`${i + 1}`, name, `${s.round}`, `${s.kills}`, s.points ? `${s.points}` : '—', date];
    values.forEach((v, c) => shadowText(ctx, v, cols[c].x, y, '16px monospace', color, cols[c].align ?? 'center', 'middle'));
  }
}

/** GameRoom.MAX_PLAYERS. */
const MAX_PLAYERS = 4;
const LOBBY_ROW_H = 36;

function drawLobby(ctx: CanvasRenderingContext2D, game: Game): void {
  const cx = VIEW_W / 2;
  const room = game.room;
  shadowText(ctx, 'ROOM CODE', cx, 140, 'bold 13px monospace', '#9a9a9a', 'center', 'middle');
  shadowText(ctx, room?.code ?? '····', cx, 182, `64px ${DISPLAY_FONT}`, '#f2d15c', 'center', 'middle');
  const map = game.maps.find((m) => m.id === room?.mapId)?.name ?? room?.mapId ?? '';
  shadowText(ctx, map, cx, 222, '14px monospace', '#9a9a9a', 'center', 'middle');

  const x = 250;
  const w = 460;
  const top = 238;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(x, top, w, MAX_PLAYERS * LOBBY_ROW_H + 12);
  const players = game.lobby?.players ?? [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = players[i];
    const y = top + 6 + i * LOBBY_ROW_H + LOBBY_ROW_H / 2;
    if (!p) {
      shadowText(ctx, 'Open seat', x + 24, y, '16px monospace', '#555', 'left', 'middle');
      continue;
    }
    const you = p.id === game.you;
    shadowText(ctx, you ? `${p.name} (you)` : p.name, x + 24, y, 'bold 17px monospace', you ? '#ffffff' : '#d8d8d8', 'left', 'middle');
    const [tag, color] = !p.connected
      ? ['AWAY', '#e05050']
      : p.id === game.lobby?.ownerId
        ? ['HOST', '#f2d15c']
        : p.ready ? ['READY', '#6ad06a'] : ['NOT READY', '#8a8a8a'];
    shadowText(ctx, tag, x + w - 24, y, 'bold 14px monospace', color, 'right', 'middle');
  }
  const waiting = players.filter((p) => p.id !== game.lobby?.ownerId && !p.ready).length;
  const status = game.isHost
    ? waiting > 0 ? `Waiting for ${waiting} to ready up` : players.length > 1 ? 'Everyone is ready' : 'Start alone, or wait for friends'
    : 'The host starts the game';
  shadowText(ctx, status, cx, top + MAX_PLAYERS * LOBBY_ROW_H + 30, '14px monospace', '#a0a0a0', 'center', 'middle');
}

function drawControls(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(170, 145, 620, 345);
  controlText.controls.forEach(([key, action], i) => {
    const y = 180 + i * 35;
    shadowText(ctx, key, VIEW_W / 2 - 20, y, 'bold 16px monospace', '#f2d15c', 'right', 'middle');
    shadowText(ctx, action, VIEW_W / 2 + 20, y, '16px monospace', '#e0e0e0', 'left', 'middle');
  });
}
