import { sound } from '../audio/Sound';
import { fetchMap, type MapSummary } from '../net/api';
import {
  drawCrosshair, drawInteractable, drawInteractableOverlay, drawPlayer, drawPowerUps, drawWindow, drawZombie, renderMap,
} from '../render/draw';
import { Lighting } from '../render/lighting';
import {
  PERK_VISUALS, POWERUP_VISUALS, TIER_HALO, WEAPON_FX, type PlayerFx, type ZombieFx,
} from '../render/visuals';
import { KNIFE, PERKS, POWERUPS, UPGRADE, WEAPONS, type WeaponId } from '../sim/defs';
import type { SimEvent } from '../sim/events';
import { GameSim } from '../sim/GameSim';
import type { PlayerInput } from '../sim/input';
import type { MapDoc } from '../sim/MapData';
import { Player } from '../sim/Player';
import { Leaderboard } from '../systems/HighScore';
import { Particles } from '../systems/Particles';
import { drawHUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { drawGameOver } from '../ui/Screens';
import { Camera } from './Camera';
import { Input } from './Input';
import { dist, rand, TAU } from './math';

export const VIEW_W = 960;
export const VIEW_H = 600;
const STEP = 1 / 60;
const HEARING_RANGE = 700;
const BANNER_TIME = 3;
const WHITE = '#ffffff';

export type GameState = 'menu' | 'playing' | 'paused' | 'gameover';

/**
 * The browser client: owns the canvas, input, camera, particles, audio, menus and HUD, and
 * drives a `GameSim`. Everything gameplay happens in the sim; this turns the keyboard and
 * mouse into `PlayerInput` and the sim's events into sound and effects.
 */
export class Game {
  state: GameState = 'menu';
  readonly input: Input;
  readonly menu = new Menu();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly lighting = new Lighting(VIEW_W, VIEW_H);

  sim!: GameSim;
  private mapCanvas!: HTMLCanvasElement;
  particles!: Particles;
  camera!: Camera;
  playerFx: PlayerFx = { flash: 0, hurtFlash: 0, knifeSwing: 0 };
  private zombieFx = new Map<number, ZombieFx>();

  time = 0;
  gameOverTimer = 0;
  readonly scores: Leaderboard;
  /** Big centre-screen callout (power-ups, Second Wind). */
  callout = { text: '', color: WHITE, timer: 0 };
  /** Round start/end banner. */
  banner = { text: '', timer: 0 };
  /** "Now playing" toast. */
  nowPlaying = { title: '', timer: 0 };
  /** White flash overlay (nuke). */
  screenFlash = 0;

  private groanTimer = 2;
  private last = 0;
  private acc = 0;

  /** `maps` is the server's map list; `mapDoc` is the map New Game plays (changed by `loadMap`). */
  constructor(private canvas: HTMLCanvasElement, readonly maps: MapSummary[], public mapDoc: MapDoc) {
    this.scores = new Leaderboard(mapDoc.id);
    this.ctx = canvas.getContext('2d')!;
    this.input = new Input(canvas, VIEW_W, VIEW_H);
    this.toMenu();
    window.addEventListener('blur', () => {
      if (this.state === 'playing') this.pause();
    });
    for (const ev of ['keydown', 'mousedown']) window.addEventListener(ev, () => sound.unlock());
    sound.onTrackChange = (t) => { this.nowPlaying = { title: t.title, timer: 5 }; };
    void this.scores.refresh();
  }

  /** Fetch a map and make it the one New Game plays. */
  async loadMap(id: string): Promise<void> {
    if (id !== this.mapDoc.id) this.mapDoc = await fetchMap(id);
    this.scores.show(id);
  }

  newGame(): void {
    this.sim = new GameSim(this.mapDoc, (Math.random() * 2 ** 32) >>> 0);
    const map = this.sim.map;
    this.mapCanvas = renderMap(map);
    this.particles = new Particles(map.pxW, map.pxH);
    this.camera = new Camera(VIEW_W, VIEW_H, map.pxW, map.pxH);
    this.camera.snap(this.sim.player.x, this.sim.player.y);
    this.playerFx = { flash: 0, hurtFlash: 0, knifeSwing: 0 };
    this.zombieFx.clear();
    this.gameOverTimer = 0;
    this.scores.lastRank = -1;
    this.callout.timer = 0;
    this.banner.timer = 0;
    this.screenFlash = 0;
    this.state = 'playing';
  }

  /** Back to the title menu, with a fresh (frozen) world behind it. */
  toMenu(): void {
    const lastRank = this.scores.lastRank;
    this.newGame();
    this.scores.lastRank = lastRank;
    this.state = 'menu';
    this.menu.open('title');
  }

  pause(): void {
    this.state = 'paused';
    this.menu.open('pause');
  }

  resume(): void {
    this.state = 'playing';
  }

  start(): void {
    requestAnimationFrame((t) => {
      this.last = t;
      requestAnimationFrame(this.frame);
    });
  }

  private frame = (t: number): void => {
    const dt = Math.min((t - this.last) / 1000, 0.25);
    this.last = t;
    this.acc += dt;
    while (this.acc >= STEP) {
      this.update(STEP);
      this.input.endTick();
      this.acc -= STEP;
    }
    this.render();
    requestAnimationFrame(this.frame);
  };

  // ---------------------------------------------------------------- update

  private update(dt: number): void {
    this.time += dt;
    const inp = this.input;
    if (inp.wasPressed('KeyM')) sound.toggleMute();
    sound.startMusic();
    // Keep the music audible on the audio page so the slider can be judged.
    sound.setMusicPaused(this.state === 'paused' && this.menu.page !== 'audio');
    switch (this.state) {
      case 'menu':
      case 'paused':
        if (this.state === 'paused' && inp.wasPressed('KeyP')) this.resume();
        else this.menu.update(this);
        break;
      case 'gameover':
        this.gameOverTimer += dt;
        this.updateEffects(dt);
        if (this.gameOverTimer > 1.5) {
          if (inp.wasPressed('Enter') || inp.mousePressed) this.newGame();
          else if (inp.wasPressed('Escape')) this.toMenu();
        }
        break;
      case 'playing':
        if (inp.wasPressed('Escape', 'KeyP')) {
          this.pause();
          break;
        }
        this.sim.step(dt, this.readInput());
        for (const e of this.sim.events) this.onEvent(e);
        this.sim.events.length = 0;
        this.updateEffects(dt);
        this.updateGroans(dt);
        break;
    }
  }

  private readInput(): PlayerInput {
    const inp = this.input;
    const p = this.sim.player;
    const mx = inp.mouse.x + this.camera.x;
    const my = inp.mouse.y + this.camera.y;
    return {
      moveX: (inp.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (inp.isDown('KeyA', 'ArrowLeft') ? 1 : 0),
      moveY: (inp.isDown('KeyS', 'ArrowDown') ? 1 : 0) - (inp.isDown('KeyW', 'ArrowUp') ? 1 : 0),
      aim: Math.atan2(my - p.y, mx - p.x),
      fireHeld: inp.isDown('Space') || inp.mouseDown,
      firePressed: inp.wasPressed('Space') || inp.mousePressed,
      reload: inp.wasPressed('KeyR'),
      knife: inp.wasPressed('KeyF', 'KeyV'),
      interactHeld: inp.isDown('KeyE'),
      interactPressed: inp.wasPressed('KeyE'),
      selectSlot: inp.wasPressed('Digit1') ? 0 : inp.wasPressed('Digit2') ? 1 : -1,
      swap: inp.wasPressed('KeyQ') || inp.wheel !== 0,
    };
  }

  /** Cosmetic timers: particles, camera, flashes, banners. */
  private updateEffects(dt: number): void {
    const fx = this.playerFx;
    fx.flash = Math.max(0, fx.flash - dt);
    fx.hurtFlash = Math.max(0, fx.hurtFlash - dt * 2);
    fx.knifeSwing = Math.max(0, fx.knifeSwing - dt);
    for (const z of this.sim.zombies) {
      const zf = this.fxOf(z.id);
      zf.hitFlash = Math.max(0, zf.hitFlash - dt);
      zf.wobble += dt * (z.runner ? 14 : 6);
    }
    this.particles.update(dt);
    this.camera.follow(this.sim.player.x, this.sim.player.y, dt);
    this.callout.timer = Math.max(0, this.callout.timer - dt);
    this.banner.timer = Math.max(0, this.banner.timer - dt);
    this.nowPlaying.timer = Math.max(0, this.nowPlaying.timer - dt);
    this.screenFlash = Math.max(0, this.screenFlash - dt * 1.5);
  }

  private fxOf(id: number): ZombieFx {
    let fx = this.zombieFx.get(id);
    if (!fx) {
      // Spread the arm-swing phases so a crowd doesn't move in step.
      fx = { hitFlash: 0, wobble: (id * 2.399) % TAU };
      this.zombieFx.set(id, fx);
    }
    return fx;
  }

  private updateGroans(dt: number): void {
    const zs = this.sim.zombies;
    this.groanTimer -= dt;
    if (this.groanTimer > 0 || zs.length === 0) return;
    const z = zs[Math.floor(rand(0, zs.length))];
    sound.groan(this.volumeAt(z.x, z.y));
    this.groanTimer = rand(0.8, 3) / Math.min(3, 1 + zs.length / 8);
  }

  /** 0..1 loudness for a sound at a world position, by distance from the player. */
  private volumeAt(x: number, y: number): number {
    const p = this.sim.player;
    return Math.max(0, 1 - dist(x, y, p.x, p.y) / HEARING_RANGE);
  }

  private showCallout(text: string, color: string): void {
    this.callout = { text, color, timer: 2 };
  }

  private showBanner(text: string): void {
    this.banner = { text, timer: BANNER_TIME };
  }

  /** Floating text above the player. */
  private playerText(text: string, color: string): void {
    const p = this.sim.player;
    this.particles.text(text, p.x, p.y - 20, color);
  }

  private onEvent(e: SimEvent): void {
    const pts = (points: number, x: number, y: number) => {
      if (points > 0) this.particles.text(`+${points}`, x, y);
    };
    switch (e.type) {
      case 'shot': {
        const wfx = WEAPON_FX[e.weapon];
        if (wfx.casing) this.particles.casing(e.x + Math.cos(e.aim) * 12, e.y + Math.sin(e.aim) * 12, e.aim, wfx.casing);
        this.playerFx.flash = 0.05;
        this.camera.addShake(wfx.shake);
        sound.shot(e.weapon);
        break;
      }
      case 'tracer': {
        // The sim traces from the shooter's centre; draw from the muzzle.
        const wfx = WEAPON_FX[e.weapon];
        const len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
        const dx = len > 0 ? (e.x2 - e.x1) / len : 0;
        const dy = len > 0 ? (e.y2 - e.y1) / len : 0;
        const m = Math.min(len, Player.RADIUS + wfx.barrel + 6);
        this.particles.tracer(e.x1 + dx * m, e.y1 + dy * m, e.x2, e.y2, wfx, TIER_HALO[e.tier]);
        // Back the mark off the wall face so it sits on the visible side.
        if (e.hitWall) this.particles.impact(e.x2 - dx * 1.5, e.y2 - dy * 1.5, Math.atan2(dy, dx) + Math.PI, wfx.tracer);
        break;
      }
      case 'explosion':
        this.particles.explosion(e.x, e.y, '#8ad8ff');
        this.particles.ring(e.x, e.y, e.radius, '120, 220, 255');
        this.camera.addShake(3);
        sound.explosion(0.4);
        break;
      case 'zombieHit': {
        this.fxOf(e.zombie).hitFlash = 0.08;
        this.particles.blood(e.x, e.y, e.angle, 6);
        if (e.points > 0) {
          const z = this.sim.zombies.find((z) => z.id === e.zombie);
          pts(e.points, z?.x ?? e.x, (z?.y ?? e.y) - 16);
          sound.hit();
        }
        break;
      }
      case 'zombieKilled':
        pts(e.points, e.x, e.y - 16);
        this.particles.bloodPool(e.x, e.y);
        sound.zombieDeath(this.volumeAt(e.x, e.y));
        this.zombieFx.delete(e.zombie);
        break;
      case 'knife':
        this.playerFx.knifeSwing = KNIFE.swing;
        sound.knife(e.hit);
        if (e.hit) this.camera.addShake(2);
        break;
      case 'reload':
        sound.reload();
        break;
      case 'playerHurt':
        this.playerFx.hurtFlash = 1;
        this.camera.addShake(7);
        this.particles.blood(e.x, e.y, rand(0, TAU), 8);
        sound.hurt();
        break;
      case 'secondWind':
        this.showCallout('SECOND WIND', PERK_VISUALS.secondWind.color);
        sound.revive();
        break;
      case 'gameOver':
        this.gameOver();
        break;
      case 'plankTorn':
        this.particles.debris(e.x, e.y);
        sound.plankTear(this.volumeAt(e.x, e.y));
        break;
      case 'plankPlaced':
        sound.plankPlace();
        pts(e.points, e.x, e.y - 10);
        break;
      case 'doorOpened':
        this.particles.debris(e.x, e.y);
        sound.door();
        break;
      case 'denied':
        this.playerText('Not enough points', '#d05050');
        sound.denied();
        break;
      case 'weaponGiven':
        this.playerText(weaponName(e.weapon, e.tier), WHITE);
        sound.buy();
        break;
      case 'ammoBought':
        this.playerText('Ammo', WHITE);
        sound.buy();
        break;
      case 'perkBought':
        this.playerText(PERKS[e.perk].name, PERK_VISUALS[e.perk].color);
        sound.perk();
        break;
      case 'armourBought':
        this.playerText(`Armour ${e.level}`, '#7aa8ff');
        sound.armour();
        break;
      case 'upgraded':
        this.playerText(weaponName(e.weapon, e.tier), '#c890ff');
        sound.upgrade();
        break;
      case 'powerUp':
        this.showCallout(POWERUPS[e.id].name.toUpperCase(), POWERUP_VISUALS[e.id].color);
        sound.powerUp();
        if (e.id === 'nuke') {
          this.screenFlash = 1;
          this.camera.addShake(14);
          sound.explosion();
        }
        break;
      case 'roundStart':
        this.showBanner(`ROUND ${e.round}`);
        sound.roundStart();
        break;
      case 'roundEnd':
        this.showBanner(`ROUND ${e.round} SURVIVED`);
        sound.roundEnd();
        break;
      case 'boxTick':
        sound.boxTick();
        break;
      case 'boxReveal':
        sound.boxReveal();
        break;
    }
  }

  private gameOver(): void {
    this.state = 'gameover';
    this.gameOverTimer = 0;
    sound.gameOver();
    const survived = Math.max(0, this.sim.rounds.round - 1);
    if (survived > 0 || this.sim.kills > 0) {
      void this.scores.record(this.mapDoc.id, { round: survived, kills: this.sim.kills, points: this.sim.economy.earned });
    }
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    const ctx = this.ctx;
    const sim = this.sim;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const cx = Math.round(this.camera.x + this.camera.ox);
    const cy = Math.round(this.camera.y + this.camera.oy);

    ctx.save();
    ctx.translate(-cx, -cy);
    ctx.drawImage(this.mapCanvas, 0, 0);
    this.particles.drawDecals(ctx);
    for (const it of sim.interactables) drawInteractable(ctx, it, this.time);
    for (const b of sim.barricades) drawWindow(ctx, b);
    for (const z of sim.zombies) drawZombie(ctx, z, this.fxOf(z.id), sim.rounds.round);
    drawPlayer(ctx, sim.player, this.playerFx);
    this.particles.draw(ctx);
    ctx.restore();

    this.lighting.draw(ctx, this, cx, cy);

    ctx.save();
    ctx.translate(-cx, -cy);
    this.particles.drawGlow(ctx);
    drawPowerUps(ctx, sim.powerUps.drops, this.time);
    for (const it of sim.interactables) drawInteractableOverlay(ctx, it, this.time);
    this.particles.drawTexts(ctx);
    ctx.restore();

    if (this.screenFlash > 0) {
      ctx.fillStyle = `rgba(255, 245, 220, ${this.screenFlash * 0.8})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    if (this.state !== 'menu') drawHUD(ctx, this);
    if (this.state === 'menu' || this.state === 'paused') this.menu.draw(ctx, this);
    else if (this.state === 'gameover') drawGameOver(ctx, this);
    else drawCrosshair(ctx, this.input.mouse.x, this.input.mouse.y, sim.player.weapon.def.pellets > 1 ? 10 : 5);

    const cursor = this.state === 'playing' ? 'none' : 'default';
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }
}

function weaponName(id: WeaponId, tier: number): string {
  return WEAPONS[id].name + UPGRADE.suffix[tier];
}
