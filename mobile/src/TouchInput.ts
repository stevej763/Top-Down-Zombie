import { sound } from '../../client/src/audio/Sound';
import { VIEW_H, VIEW_W, type Game } from '../../client/src/core/Game';
import { Input } from '../../client/src/core/Input';
import { drawButton, drawStick, hitButton, layout, type Insets, type Layout, type Stick } from './controls';
import { Keyboard, type KeySink } from './keyboard';

/** Below this share of the stick's reach a thumb is resting, not pushing. */
const DEADZONE = 0.3;
/** Pushing the aim stick past this share of its reach fires, and keeps firing while held (semi-autos too). */
const FIRE_AT = 0.55;
/** How far ahead of the player (view px) the virtual mouse sits, so `Game.readInput` aims along the stick. */
const AIM_DIST = 120;
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
/** Menu pages with a text field, where a tap brings up the keyboard. */
const TEXT_PAGES = new Set(['name', 'join']);

type Binding =
  | { kind: 'move' | 'aim'; stick: Stick }
  | { kind: 'button'; code: string }
  | { kind: 'menu' };

/**
 * Twin-stick touch controls, turned into the keys and mouse `Game` already reads: the left stick
 * holds WASD, the right stick moves the mouse around the player (and holds the button down when
 * pushed far, re-pressing it every tick so semi-autos keep firing at their own rate), buttons press
 * their keys, and outside play a tap is a click.
 */
export class TouchInput extends Input implements KeySink {
  private game: Game | null = null;
  private readonly touches = new Map<number, Binding>();
  private readonly keyboard: Keyboard;
  private lay: Layout;
  private safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** Which way the player aims while no thumb is on the aim stick (the last stick or move direction). */
  private aimDir: { x: number; y: number } | null = null;
  private firing = false;

  constructor(canvas: HTMLCanvasElement, private surface: HTMLCanvasElement, keyboardEl: HTMLInputElement, private safeEl: HTMLElement) {
    super(canvas, VIEW_W, VIEW_H);
    this.keyboard = new Keyboard(keyboardEl, this);
    this.lay = this.relayout();
    const opts = { passive: false };
    surface.addEventListener('touchstart', (e) => this.onStart(e), opts);
    surface.addEventListener('touchmove', (e) => this.onMove(e), opts);
    surface.addEventListener('touchend', (e) => this.onEnd(e), opts);
    surface.addEventListener('touchcancel', (e) => this.onEnd(e), opts);
    window.addEventListener('resize', () => (this.lay = this.relayout()));
  }

  attach(game: Game): void {
    this.game = game;
  }

  typeText(text: string): void {
    this.typed += text;
  }

  tapKey(code: string): void {
    this.pressed.add(code);
  }

  private get playing(): boolean {
    return this.game?.state === 'playing';
  }

  private relayout(): Layout {
    const r = this.safeEl.getBoundingClientRect();
    this.safe = { top: r.top, left: r.left, right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom };
    return layout(window.innerWidth, window.innerHeight, this.safe);
  }

  // ---------------------------------------------------------------- touch events

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    const game = this.game;
    if (!game) return;
    for (const t of Array.from(e.changedTouches)) {
      const x = t.clientX;
      const y = t.clientY;
      const button = hitButton(this.lay.buttons, x, y);
      if (this.playing) {
        if (button) {
          this.touches.set(t.identifier, { kind: 'button', code: button.code });
          this.pressed.add(button.code);
          this.down.add(button.code);
        } else {
          const kind = x < window.innerWidth / 2 ? 'move' : 'aim';
          this.touches.set(t.identifier, { kind, stick: { ox: x, oy: y, x, y } });
        }
        continue;
      }
      // Game over: the pause button becomes MENU (Esc); anywhere else is a click (play again).
      if (game.state === 'gameover' && button?.id === 'pause') {
        this.pressed.add('Escape');
        continue;
      }
      this.touches.set(t.identifier, { kind: 'menu' });
      this.pointAt(x, y);
      this.mouseDown = true;
      this.mousePressed = true;
      if (game.state !== 'gameover' && TEXT_PAGES.has(game.menu.page)) this.keyboard.open();
    }
    this.applySticks();
  }

  private onMove(e: TouchEvent): void {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const b = this.touches.get(t.identifier);
      if (!b) continue;
      if (b.kind === 'move' || b.kind === 'aim') {
        b.stick.x = t.clientX;
        b.stick.y = t.clientY;
        // A thumb that drifts past the rim drags the stick along, so it never has to come back.
        const dx = b.stick.x - b.stick.ox;
        const dy = b.stick.y - b.stick.oy;
        const d = Math.hypot(dx, dy);
        const r = this.lay.stickR;
        if (d > r) {
          b.stick.ox += (dx * (d - r)) / d;
          b.stick.oy += (dy * (d - r)) / d;
        }
      } else if (b.kind === 'menu') {
        this.pointAt(t.clientX, t.clientY);
      }
    }
    this.applySticks();
  }

  private onEnd(e: TouchEvent): void {
    e.preventDefault();
    // iOS only lets audio start from a gesture that ends.
    sound.unlock();
    for (const t of Array.from(e.changedTouches)) {
      const b = this.touches.get(t.identifier);
      this.touches.delete(t.identifier);
      if (b?.kind === 'button') this.down.delete(b.code);
      else if (b?.kind === 'menu') this.mouseDown = false;
    }
    this.applySticks();
  }

  /** Screen point → view coordinates, like Input does for the mouse. */
  private pointAt(clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - r.left) * this.viewW) / r.width;
    this.mouse.y = ((clientY - r.top) * this.viewH) / r.height;
  }

  // ---------------------------------------------------------------- sticks → keys and mouse

  private stick(kind: 'move' | 'aim'): Stick | undefined {
    for (const b of this.touches.values()) if (b.kind === kind) return b.stick;
    return undefined;
  }

  /** The stick's push as a vector of length 0..1, or null inside the deadzone. */
  private push(s: Stick | undefined): { x: number; y: number; mag: number } | null {
    if (!s) return null;
    const dx = (s.x - s.ox) / this.lay.stickR;
    const dy = (s.y - s.oy) / this.lay.stickR;
    const mag = Math.min(1, Math.hypot(dx, dy));
    if (mag < DEADZONE) return null;
    const d = Math.hypot(dx, dy);
    return { x: dx / d, y: dy / d, mag };
  }

  private applySticks(): void {
    for (const k of MOVE_KEYS) this.down.delete(k);
    const move = this.push(this.stick('move'));
    if (move) {
      // Eight directions, like the keys: the sim normalises diagonals, and prediction stays exact.
      const sector = Math.round(Math.atan2(move.y, move.x) / (Math.PI / 4));
      const a = (sector * Math.PI) / 4;
      const x = Math.round(Math.cos(a));
      const y = Math.round(Math.sin(a));
      if (x > 0) this.down.add('KeyD');
      if (x < 0) this.down.add('KeyA');
      if (y > 0) this.down.add('KeyS');
      if (y < 0) this.down.add('KeyW');
    }
    const aimStick = this.stick('aim');
    const aim = this.push(aimStick);
    if (aim) this.aimDir = { x: aim.x, y: aim.y };
    else if (!aimStick && move) this.aimDir = { x: move.x, y: move.y };
    const fire = !!aim && aim.mag >= FIRE_AT;
    if (this.playing) {
      if (fire && !this.firing) this.mousePressed = true;
      if (fire || this.firing) this.mouseDown = fire;
    }
    this.firing = fire;
    this.aimMouse();
  }

  /** Put the virtual mouse ahead of the player along the aim. Runs every tick, since the player moves. */
  private aimMouse(): void {
    const game = this.game;
    if (!game || !this.playing) return;
    const me = game.me;
    const dir = this.aimDir ?? { x: Math.cos(me.aim), y: Math.sin(me.aim) };
    this.mouse.x = me.x - game.camera.x + dir.x * AIM_DIST;
    this.mouse.y = me.y - game.camera.y + dir.y * AIM_DIST;
  }

  /** Leaving play (pause, game over) lets go of everything the thumbs were holding. */
  private releasePlay(): void {
    let any = false;
    for (const [id, b] of this.touches) {
      if (b.kind === 'menu') continue;
      if (b.kind === 'button') this.down.delete(b.code);
      this.touches.delete(id);
      any = true;
    }
    if (any || this.firing) {
      for (const k of MOVE_KEYS) this.down.delete(k);
      this.firing = false;
      this.mouseDown = false;
    }
  }

  override endTick(): void {
    super.endTick();
    if (this.playing) {
      // A held stick pulls the trigger again each tick; the gun's fire interval sets the pace.
      if (this.firing) this.mousePressed = true;
      this.aimMouse();
    } else this.releasePlay();
  }

  // ---------------------------------------------------------------- drawing

  /** Draw the controls on the overlay; called once per animation frame. */
  draw(): void {
    const game = this.game;
    const c = this.surface;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      this.lay = this.relayout();
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!game) return;
    const inMenu = game.state === 'menu' || game.state === 'paused';
    if (!(inMenu && TEXT_PAGES.has(game.menu.page))) this.keyboard.close();
    if (inMenu) return;
    const pause = this.lay.buttons.find((b) => b.id === 'pause')!;
    if (game.state === 'gameover') {
      if (game.gameOverTimer > 1.5) drawButton(ctx, { ...pause, r: pause.r * 1.4, x: pause.x + pause.r * 0.4, y: pause.y + pause.r * 0.4 }, false, false, 'MENU');
      return;
    }
    if (!this.playing) return;

    this.drawAim(ctx);
    const held = new Set<string>();
    for (const b of this.touches.values()) if (b.kind === 'button') held.add(b.code);
    const canUse = game.me.interaction !== null && game.me.interaction !== undefined;
    for (const b of this.lay.buttons) drawButton(ctx, b, held.has(b.code), b.id === 'use' && canUse);
    drawStick(ctx, this.lay.moveHome, this.stick('move'), this.lay.stickR, '#9ec7ff');
    drawStick(ctx, this.lay.aimHome, this.stick('aim'), this.lay.stickR, this.firing ? '#ff6a5a' : '#ffffff');
  }

  /** A short dashed line out from the player along the aim, in place of the crosshair. */
  private drawAim(ctx: CanvasRenderingContext2D): void {
    const game = this.game!;
    const me = game.me;
    if (me.state !== 'alive') return;
    const r = this.canvas.getBoundingClientRect();
    const k = r.width / this.viewW;
    const px = r.left + (me.x - game.camera.x) * k;
    const py = r.top + (me.y - game.camera.y) * k;
    const mx = r.left + this.mouse.x * k;
    const my = r.top + this.mouse.y * k;
    const d = Math.hypot(mx - px, my - py) || 1;
    const ux = (mx - px) / d;
    const uy = (my - py) / d;
    ctx.save();
    ctx.globalAlpha = this.firing ? 0.55 : 0.3;
    ctx.strokeStyle = this.firing ? '#ff8a7a' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(px + ux * 24 * k, py + uy * 24 * k);
    ctx.lineTo(px + ux * 150 * k, py + uy * 150 * k);
    ctx.stroke();
    ctx.restore();
  }
}
