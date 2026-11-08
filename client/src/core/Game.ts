import { sound } from '../audio/Sound';
import { Player } from '../entities/Player';
import { Zombie } from '../entities/Zombie';
import { drawCrosshair, drawPlayer, drawWindow, drawZombie, renderMap } from '../render/draw';
import { Lighting } from '../render/lighting';
import { fetchMap, type MapSummary } from '../net/api';
import { aimAssist } from '../systems/aimAssist';
import { ARMOUR_ABSORB } from '../systems/Armour';
import { Economy, POINTS } from '../systems/Economy';
import { Leaderboard } from '../systems/HighScore';
import { Particles } from '../systems/Particles';
import { FlowField } from '../systems/Pathfinding';
import { POWERUP_DURATION, POWERUPS, PowerUps, type PowerUpId } from '../systems/PowerUps';
import { RoundManager } from '../systems/RoundManager';
import { drawHUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { drawGameOver } from '../ui/Screens';
import type { Weapon } from '../weapons/Weapon';
import { KNIFE, WEAPONS } from '../weapons/WeaponDefs';
import { Barricade } from '../world/Barricade';
import {
  ArmourBench, Door, Interactable, MysteryBox, PerkMachine, UpgradeBench, WallBuy,
} from '../world/Interactables';
import { parseMap, type MapDoc, type RoomId } from '../world/MapData';
import { Tile, TileMap } from '../world/TileMap';
import { Camera } from './Camera';
import { Input } from './Input';
import { angleDiff, dist, rand, rayCircle } from './math';

export const VIEW_W = 960;
export const VIEW_H = 600;
const STEP = 1 / 60;
const HEARING_RANGE = 700;
const SECOND_WIND_INVULN = 3;

export type GameState = 'menu' | 'playing' | 'paused' | 'gameover';

export type Interaction =
  | { kind: 'rebuild'; barricade: Barricade }
  | { kind: 'use'; target: Interactable }
  | null;

export class Game {
  state: GameState = 'menu';
  readonly input: Input;
  readonly menu = new Menu();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly lighting = new Lighting(VIEW_W, VIEW_H);

  map!: TileMap;
  private mapCanvas!: HTMLCanvasElement;
  barricades: Barricade[] = [];
  interactables: Interactable[] = [];
  openRooms = new Set<RoomId>();
  player!: Player;
  zombies: Zombie[] = [];
  rounds!: RoundManager;
  flow!: FlowField;
  economy!: Economy;
  powerUps!: PowerUps;
  particles!: Particles;
  camera!: Camera;

  interaction: Interaction = null;
  mouseWorld = { x: 0, y: 0 };
  kills = 0;
  time = 0;
  gameOverTimer = 0;
  readonly scores: Leaderboard;
  /** Big centre-screen callout (power-ups, Second Wind). */
  callout = { text: '', color: '#fff', timer: 0 };
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
    const data = parseMap(this.mapDoc);
    this.map = data.map;
    this.mapCanvas = renderMap(this.map);
    this.barricades = data.windows.map((w) => new Barricade(w));
    this.interactables = [
      ...data.wallBuys.map((wb) => new WallBuy(wb, WEAPONS[wb.weapon])),
      ...data.perks.map((p) => new PerkMachine(p, p.perk)),
      new ArmourBench(data.armour),
      new UpgradeBench(data.upgrade),
      new MysteryBox(data.box.tx, data.box.ty),
      ...data.doors.map((d) => new Door(d)),
    ];
    this.openRooms = new Set([data.startRoom]);
    this.player = new Player(data.playerStart.x, data.playerStart.y);
    this.zombies = [];
    this.rounds = new RoundManager();
    this.flow = new FlowField(this.map, (t) => t === Tile.Floor);
    this.economy = new Economy();
    this.powerUps = new PowerUps();
    this.particles = new Particles(this.map.pxW, this.map.pxH);
    this.camera = new Camera(VIEW_W, VIEW_H, this.map.pxW, this.map.pxH);
    this.camera.snap(this.player.x, this.player.y);
    this.interaction = null;
    this.kills = 0;
    this.gameOverTimer = 0;
    this.scores.lastRank = -1;
    this.callout.timer = 0;
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
        this.particles.update(dt);
        this.camera.follow(this.player.x, this.player.y, dt);
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
        this.updateWorld(dt);
        break;
    }
  }

  private updateWorld(dt: number): void {
    this.mouseWorld.x = this.input.mouse.x + this.camera.x;
    this.mouseWorld.y = this.input.mouse.y + this.camera.y;
    this.economy.multiplier = this.powerUps.double > 0 ? 2 : 1;

    this.player.update(dt, this);
    this.flow.update(this.player.x, this.player.y);
    this.rounds.update(dt, this);
    for (const it of this.interactables) it.update(dt, this);
    for (const z of this.zombies) z.update(dt, this);
    this.separate();
    this.zombies = this.zombies.filter((z) => !z.dead);
    this.powerUps.update(dt, this);
    this.particles.update(dt);
    this.camera.follow(this.player.x, this.player.y, dt);
    this.callout.timer = Math.max(0, this.callout.timer - dt);
    this.nowPlaying.timer = Math.max(0, this.nowPlaying.timer - dt);
    this.screenFlash = Math.max(0, this.screenFlash - dt * 1.5);
    this.updateGroans(dt);
  }

  private updateGroans(dt: number): void {
    this.groanTimer -= dt;
    if (this.groanTimer > 0 || this.zombies.length === 0) return;
    const z = this.zombies[Math.floor(rand(0, this.zombies.length))];
    sound.groan(this.volumeAt(z.x, z.y));
    this.groanTimer = rand(0.8, 3) / Math.min(3, 1 + this.zombies.length / 8);
  }

  /** 0..1 loudness for a sound at a world position, by distance from the player. */
  volumeAt(x: number, y: number): number {
    return Math.max(0, 1 - dist(x, y, this.player.x, this.player.y) / HEARING_RANGE);
  }

  /** Push overlapping zombies apart, and the player out of zombies. */
  private separate(): void {
    const zs = this.zombies;
    const minD = Zombie.RADIUS * 2;
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i];
      if (a.state === 'climbing') continue;
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j];
        if (b.state === 'climbing' || (a.state === 'inside') !== (b.state === 'inside')) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (minD - d) / 2 / d;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
      }
    }

    const p = this.player;
    const minPD = Zombie.RADIUS + Player.RADIUS;
    for (const z of zs) {
      if (z.state !== 'inside') continue;
      const dx = p.x - z.x;
      const dy = p.y - z.y;
      const d = Math.hypot(dx, dy);
      if (d >= minPD || d === 0) continue;
      const overlap = minPD - d;
      p.x += (dx / d) * overlap * 0.7;
      p.y += (dy / d) * overlap * 0.7;
      z.x -= (dx / d) * overlap * 0.3;
      z.y -= (dy / d) * overlap * 0.3;
    }

    this.map.collideCircle(p, Player.RADIUS, (t) => t !== Tile.Floor);
    for (const z of zs) {
      if (z.state !== 'climbing') this.map.collideCircle(z, Zombie.RADIUS, z.solid);
    }
  }

  // --------------------------------------------------------------- actions

  fire(w: Weapon): void {
    const p = this.player;
    const def = w.def;
    w.mag--;
    w.cooldown = def.fireInterval * p.fireIntervalMult;

    const base = aimAssist(this, p.x, p.y, p.aim, def.range);
    const muzzleDist = Player.RADIUS + def.barrel + 6;
    const mx = p.x + Math.cos(p.aim) * muzzleDist;
    const my = p.y + Math.sin(p.aim) * muzzleDist;
    for (let i = 0; i < def.pellets; i++) {
      this.traceShot(p.x, p.y, mx, my, base + rand(-def.spread / 2, def.spread / 2), w);
    }
    if (def.fx.casing) this.particles.casing(p.x + Math.cos(p.aim) * 12, p.y + Math.sin(p.aim) * 12, p.aim, def.fx.casing);
    p.flash = 0.05;
    this.camera.addShake(def.shake);
    sound.shot(def.id);
  }

  /** Hitscan from the player's centre; the tracer is drawn from the muzzle. */
  private traceShot(ox: number, oy: number, mx: number, my: number, angle: number, w: Weapon): void {
    const def = w.def;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const wallD = this.map.rayWall(ox, oy, dx, dy, def.range);

    const hits: { z: Zombie; t: number }[] = [];
    for (const z of this.zombies) {
      if (z.dead) continue;
      const t = rayCircle(ox, oy, dx, dy, z.x, z.y, Zombie.RADIUS);
      if (t >= 0 && t <= wallD) hits.push({ z, t });
    }
    hits.sort((a, b) => a.t - b.t);

    let end = wallD;
    let pens = def.penetration;
    for (const h of hits) {
      // Headshot: the ray passes close to the centre line and the zombie is facing the shooter.
      const offset = Math.abs((h.z.x - ox) * dy - (h.z.y - oy) * dx);
      const facingShooter = Math.abs(angleDiff(h.z.facing, Math.atan2(oy - h.z.y, ox - h.z.x))) < 1.2;
      const head = offset < Zombie.RADIUS * 0.35 && facingShooter;
      this.hitZombie(h.z, w.damage, ox + dx * h.t, oy + dy * h.t, angle, head);
      if (--pens <= 0) {
        end = h.t;
        break;
      }
    }

    const ex = ox + dx * end;
    const ey = oy + dy * end;
    this.particles.tracer(mx, my, ex, ey, def.fx, w.halo);
    if (def.splash) {
      this.explode(ex, ey, def.splash.radius, def.splash.damage * (w.damage / def.damage));
    } else if (end === wallD && wallD < def.range) {
      // Back the mark off the wall face so it sits on the visible side.
      this.particles.impact(ex - dx * 1.5, ey - dy * 1.5, angle + Math.PI, def.fx.tracer);
    }
  }

  /** Slash the closest zombie inside the knife arc. */
  knife(): void {
    const p = this.player;
    const reach = Player.RADIUS + KNIFE.reach + Zombie.RADIUS;
    let target: Zombie | null = null;
    let bestD = Infinity;
    for (const z of this.zombies) {
      if (z.dead || z.state === 'climbing') continue;
      const d = dist(p.x, p.y, z.x, z.y);
      if (d > reach || d >= bestD) continue;
      if (Math.abs(angleDiff(p.aim, Math.atan2(z.y - p.y, z.x - p.x))) > KNIFE.arc / 2) continue;
      if (!this.map.hasLOS(p.x, p.y, z.x, z.y)) continue;
      target = z;
      bestD = d;
    }
    sound.knife(target !== null);
    if (!target) return;
    const angle = Math.atan2(target.y - p.y, target.x - p.x);
    this.hitZombie(target, KNIFE.damage, target.x, target.y, angle, false, POINTS.knifeKill);
    if (!target.dead && target.state === 'inside') {
      target.x += Math.cos(angle) * 8;
      target.y += Math.sin(angle) * 8;
    }
    this.camera.addShake(2);
  }

  private explode(x: number, y: number, radius: number, damage: number): void {
    for (const z of this.zombies) {
      if (z.dead) continue;
      const d = dist(x, y, z.x, z.y);
      if (d < radius + Zombie.RADIUS) {
        this.hitZombie(z, damage * (1 - 0.5 * Math.min(1, d / radius)), z.x, z.y, Math.atan2(z.y - y, z.x - x), false);
      }
    }
    this.particles.explosion(x, y, '#8ad8ff');
    this.particles.ring(x, y, radius, '120, 220, 255');
    this.camera.addShake(3);
    sound.explosion(0.4);
  }

  private hitZombie(
    z: Zombie, damage: number, hx: number, hy: number, angle: number, head: boolean,
    killPoints: number = head ? POINTS.headshotKill : POINTS.kill,
  ): void {
    if (z.dead) return;
    z.hp -= this.powerUps.instakill > 0 ? z.hp : head ? damage * 1.5 : damage;
    z.hitFlash = 0.08;
    this.particles.blood(hx, hy, angle, 6);
    if (z.state === 'inside') {
      z.x += Math.cos(angle) * 2;
      z.y += Math.sin(angle) * 2;
    }

    if (z.hp <= 0) {
      this.killZombie(z, killPoints);
    } else {
      const pts = this.economy.award(POINTS.hit);
      this.particles.text(`+${pts}`, z.x, z.y - 16);
      sound.hit();
    }
  }

  private killZombie(z: Zombie, points: number): void {
    z.dead = true;
    if (z.window.climber === z) z.window.climber = null;
    this.kills++;
    if (points > 0) {
      const pts = this.economy.award(points);
      this.particles.text(`+${pts}`, z.x, z.y - 16);
    }
    this.particles.bloodPool(z.x, z.y);
    sound.zombieDeath(this.volumeAt(z.x, z.y));
    // Only drop power-ups where the player can reach them.
    if (z.state === 'inside') this.powerUps.maybeDrop(z.x, z.y);
  }

  applyPowerUp(id: PowerUpId): void {
    const def = POWERUPS[id];
    switch (id) {
      case 'ammo':
        for (const w of this.player.weapons) w?.refill();
        break;
      case 'instakill':
        this.powerUps.instakill = POWERUP_DURATION;
        break;
      case 'double':
        this.powerUps.double = POWERUP_DURATION;
        break;
      case 'nuke':
        for (const z of this.zombies) if (!z.dead) this.killZombie(z, 0);
        this.economy.award(POINTS.nuke);
        this.screenFlash = 1;
        this.camera.addShake(14);
        sound.explosion();
        break;
    }
    this.showCallout(def.name.toUpperCase(), def.color);
    sound.powerUp();
  }

  showCallout(text: string, color: string): void {
    this.callout = { text, color, timer: 2 };
  }

  damagePlayer(amount: number): void {
    const p = this.player;
    if (p.invuln > 0) return;
    if (p.armour > 0) {
      const absorbed = Math.min(p.armour, amount * ARMOUR_ABSORB);
      p.armour -= absorbed;
      amount -= absorbed;
    }
    p.hp -= amount;
    p.sinceHit = 0;
    p.hurtFlash = 1;
    this.camera.addShake(7);
    this.particles.blood(p.x, p.y, rand(0, Math.PI * 2), 8);
    sound.hurt();
    if (p.hp > 0) return;

    if (p.perks.has('secondWind')) {
      this.secondWind();
    } else {
      p.hp = 0;
      this.gameOver();
    }
  }

  /** Get back up: lose every perk, full health, brief invulnerability, zombies shoved back. */
  private secondWind(): void {
    const p = this.player;
    p.perks.clear();
    p.hp = p.maxHp;
    p.invuln = SECOND_WIND_INVULN;
    for (const z of this.zombies) {
      if (z.state !== 'inside') continue;
      const d = dist(p.x, p.y, z.x, z.y);
      if (d < 140 && d > 0) {
        z.x += ((z.x - p.x) / d) * 60;
        z.y += ((z.y - p.y) / d) * 60;
        this.map.collideCircle(z, Zombie.RADIUS, z.solid);
      }
    }
    this.showCallout('SECOND WIND', '#3a8ad0');
    sound.revive();
  }

  private gameOver(): void {
    this.state = 'gameover';
    this.gameOverTimer = 0;
    sound.gameOver();
    const survived = Math.max(0, this.rounds.round - 1);
    if (survived > 0 || this.kills > 0) {
      void this.scores.record(this.mapDoc.id, { round: survived, kills: this.kills, points: this.economy.earned });
    }
  }

  tearPlank(b: Barricade): void {
    if (!b.tear()) return;
    this.particles.debris(b.center.x, b.center.y);
    sound.plankTear(this.volumeAt(b.center.x, b.center.y));
  }

  rebuildPlank(b: Barricade): void {
    if (!b.rebuild()) return;
    sound.plankPlace();
    if (this.economy.rebuildLeft >= POINTS.plank) {
      this.economy.rebuildLeft -= POINTS.plank;
      const pts = this.economy.award(POINTS.plank);
      this.particles.text(`+${pts}`, b.center.x, b.center.y - 10);
    }
  }

  /** Put a weapon in the empty slot, or replace the one in hand. */
  giveWeapon(w: Weapon): void {
    const p = this.player;
    const empty = p.weapons.indexOf(null);
    const slot = empty >= 0 ? empty : p.slot;
    p.weapon.cancelReload();
    p.weapons[slot] = w;
    p.slot = slot;
    this.particles.text(w.name, p.x, p.y - 20, '#ffffff');
  }

  openDoor(door: Door): void {
    door.open = true;
    for (const [tx, ty] of door.def.tiles) this.map.set(tx, ty, Tile.Floor);
    for (const r of door.def.rooms) this.openRooms.add(r);
    this.flow.invalidate();
    this.particles.debris(door.standX, door.standY);
    sound.door();
  }

  denied(): void {
    this.particles.text('Not enough points', this.player.x, this.player.y - 20, '#d05050');
    sound.denied();
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const cx = Math.round(this.camera.x + this.camera.ox);
    const cy = Math.round(this.camera.y + this.camera.oy);

    ctx.save();
    ctx.translate(-cx, -cy);
    ctx.drawImage(this.mapCanvas, 0, 0);
    this.particles.drawDecals(ctx);
    for (const it of this.interactables) it.draw(ctx, this);
    for (const b of this.barricades) drawWindow(ctx, b);
    for (const z of this.zombies) drawZombie(ctx, z, this.rounds.round);
    drawPlayer(ctx, this.player);
    this.particles.draw(ctx);
    ctx.restore();

    this.lighting.draw(ctx, this, cx, cy);

    ctx.save();
    ctx.translate(-cx, -cy);
    this.particles.drawGlow(ctx);
    this.powerUps.draw(ctx, this.time);
    for (const it of this.interactables) it.drawOverlay(ctx, this);
    this.particles.drawTexts(ctx);
    ctx.restore();

    if (this.screenFlash > 0) {
      ctx.fillStyle = `rgba(255, 245, 220, ${this.screenFlash * 0.8})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    if (this.state !== 'menu') drawHUD(ctx, this);
    if (this.state === 'menu' || this.state === 'paused') this.menu.draw(ctx, this);
    else if (this.state === 'gameover') drawGameOver(ctx, this);
    else drawCrosshair(ctx, this.input.mouse.x, this.input.mouse.y, this.player.weapon.def.pellets > 1 ? 10 : 5);

    const cursor = this.state === 'playing' ? 'none' : 'default';
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }
}
