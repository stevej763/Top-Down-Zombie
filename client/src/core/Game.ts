import { sound } from '../audio/Sound';
import { loadIdentity, type MapSummary } from '../net/api';
import type { Link } from '../net/Connection';
import { NetGame } from '../net/NetGame';
import type { GameResult, LobbyPlayer, NetEvent, ServerMessage } from '../net/protocol';
import {
  drawCrosshair, drawInteractable, drawInteractableOverlay, drawPlayer, drawPlayerOverlay, drawPowerUps, drawWindow,
  drawZombie, renderMap,
} from '../render/draw';
import { Lighting } from '../render/lighting';
import {
  PERK_VISUALS, POWERUP_VISUALS, TIER_HALO, WEAPON_FX, type PlayerFx, type ZombieFx,
} from '../render/visuals';
import { KNIFE, PERKS, PLAYER_RADIUS, POWERUPS, WEAPONS, weaponName } from '../game/defs';
import { NO_INPUT, type PlayerInput } from '../game/input';
import type { MapDoc } from '../game/MapData';
import { Leaderboard } from '../systems/HighScore';
import { Particles } from '../systems/Particles';
import { drawHUD } from '../ui/HUD';
import { Menu } from '../ui/Menu';
import { drawGameOver } from '../ui/Screens';
import { buildLevel, restingWorld, type Level } from '../view/Level';
import { heldWeapon, type PlayerView, type WorldView } from '../view/WorldView';
import { Camera } from './Camera';
import { Input } from './Input';
import { dist, rand, TAU } from './math';

export const VIEW_W = 960;
export const VIEW_H = 600;
const STEP = 1 / 60;
const HEARING_RANGE = 700;
const BANNER_TIME = 3;
const FEED_TIME = 4;
const WHITE = '#ffffff';
const DOWN_RED = '#e05040';
/** Events this many ticks older than the newest in a batch (after a hidden tab, say) play no effects. */
const STALE_EVENT_TICKS = 30;
/** After a reconnect, the server says `welcome` if our seat is still there; past this, it's gone. */
const RESUME_TIMEOUT = 3;

export type GameState = 'menu' | 'playing' | 'paused' | 'gameover';

/** The room we're in. `solo` is what we asked for; the server's `welcome` doesn't say. */
export interface RoomInfo {
  code: string;
  mapId: string;
  solo: boolean;
  doc: MapDoc;
}

export type LobbyInfo = Extract<ServerMessage, { type: 'lobby' }>;
export type GameOverInfo = Extract<ServerMessage, { type: 'gameOver' }>;

/**
 * The browser client: owns the canvas, input, camera, particles, audio, menus and HUD. The
 * game itself runs on the server: this joins a room over `link`, sends one `PlayerInput` per
 * tick, and draws `world`, which `NetGame` builds from snapshots (interpolated, with the local
 * player predicted). Server events become sound and effects. Rendering, the HUD and prompts
 * read only `world` and `level`.
 */
export class Game {
  state: GameState = 'menu';
  readonly input: Input;
  readonly menu = new Menu();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly lighting = new Lighting(VIEW_W, VIEW_H);

  /** The static map: tiles, window and fixture positions. */
  level!: Level;
  /** What's drawn. */
  world!: WorldView;
  /** The local player's id in `world.players` (the server's id once in a room). */
  you = 0;
  /** The map New Game creates a room on. */
  mapId: string;
  room: RoomInfo | null = null;
  lobby: LobbyInfo | null = null;
  /** The finished game, for the game-over screen. */
  result: GameOverInfo | null = null;
  private net: NetGame | null = null;
  /** What the last create/join asked for, so `welcome` knows if it's solo. */
  private asked: 'solo' | 'coop' | 'join' | null = null;
  /** `link.opens` when the room last welcomed us; a higher count means we reconnected. */
  private roomOpens = 0;
  private resumeBy = 0;
  /** Solo "play again" was sent; ignore more presses until the server starts it. */
  private restarting = false;

  private mapCanvas!: HTMLCanvasElement;
  particles!: Particles;
  camera!: Camera;
  private playerFx = new Map<number, PlayerFx>();
  private zombieFx = new Map<number, ZombieFx>();

  time = 0;
  gameOverTimer = 0;
  readonly scores: Leaderboard;
  /** Big centre-screen callout (power-ups, Second Wind, going down). */
  callout = { text: '', color: WHITE, timer: 0 };
  /** Round start/end banner. */
  banner = { text: '', timer: 0 };
  /** Small lines about teammates ("Sam is down!"), newest last. */
  feed: { text: string; color: string; timer: number }[] = [];
  /** "Now playing" toast. */
  nowPlaying = { title: '', timer: 0 };
  /** White flash overlay (nuke). */
  screenFlash = 0;

  private groanTimer = 2;
  private last = 0;
  private acc = 0;

  /** `maps` is the server's map list; `mapDoc` is drawn behind the title menu. */
  constructor(private canvas: HTMLCanvasElement, readonly maps: MapSummary[], private mapDoc: MapDoc, readonly link: Link) {
    this.mapId = mapDoc.id;
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

  // ---------------------------------------------------------------- rooms

  /** The map New Game plays. */
  selectMap(id: string): void {
    this.mapId = id;
    this.scores.show(id);
  }

  createRoom(solo: boolean): void {
    this.asked = solo ? 'solo' : 'coop';
    this.link.connect();
    this.link.send({ type: 'create', mapId: this.mapId, solo });
  }

  joinRoom(code: string): void {
    this.asked = 'join';
    this.link.connect();
    this.link.send({ type: 'join', code });
  }

  setReady(ready: boolean): void {
    this.link.send({ type: 'ready', ready });
  }

  startGame(): void {
    this.link.send({ type: 'start' });
  }

  get isHost(): boolean {
    return this.lobby?.ownerId === this.you;
  }

  get lobbyMe(): LobbyPlayer | undefined {
    return this.lobby?.players.find((p) => p.id === this.you);
  }

  /** Leave the room (if any) and drop the socket. */
  leaveRoom(): void {
    if (this.room || this.asked) this.link.send({ type: 'leave' });
    this.link.close();
    this.room = null;
    this.lobby = null;
    this.net = null;
    this.asked = null;
    this.resumeBy = 0;
  }

  /** Back to the title menu, out of any room, with the default map resting behind it. */
  toMenu(notice = ''): void {
    this.leaveRoom();
    this.you = 0;
    this.setLevel(buildLevel(this.mapDoc));
    this.state = 'menu';
    this.menu.open('title');
    if (notice) this.menu.fail(notice);
  }

  private setLevel(level: Level): void {
    this.level = level;
    const map = level.data.map;
    this.world = restingWorld(level, this.you, loadIdentity()?.name ?? '');
    this.mapCanvas = renderMap(map);
    this.particles = new Particles(map.pxW, map.pxH);
    this.camera = new Camera(VIEW_W, VIEW_H, map.pxW, map.pxH);
    this.camera.snap(this.me.x, this.me.y);
    this.playerFx.clear();
    this.zombieFx.clear();
    this.callout.timer = 0;
    this.banner.timer = 0;
    this.feed = [];
    this.screenFlash = 0;
  }

  /** The local player. */
  get me(): PlayerView {
    return this.world.players.find((p) => p.id === this.you) ?? this.world.players[0];
  }

  /** Who the camera follows while you're dead: the first teammate still up, if any. */
  get spectating(): PlayerView | null {
    if (this.me.state !== 'dead') return null;
    return this.world.players.find((p) => p.state === 'alive' && p.id !== this.you) ?? null;
  }

  /** Where the camera and your ears are. */
  private get focus(): PlayerView {
    return this.spectating ?? this.me;
  }

  playerFxOf(id: number): PlayerFx {
    let fx = this.playerFx.get(id);
    if (!fx) {
      fx = { flash: 0, hurtFlash: 0, knifeSwing: 0 };
      this.playerFx.set(id, fx);
    }
    return fx;
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

  // ---------------------------------------------------------------- network

  /** Handle everything the server sent since the last tick. */
  private pollNet(): void {
    const msgs = this.link.drain();
    let newest = -Infinity;
    for (const m of msgs) if (m.type === 'events') newest = Math.max(newest, m.tick);
    for (const m of msgs) this.handle(m, m.type !== 'events' || m.tick >= newest - STALE_EVENT_TICKS);

    if (this.room && this.link.status === 'open' && this.link.opens > this.roomOpens && this.resumeBy === 0) {
      this.resumeBy = this.time + RESUME_TIMEOUT;
    }
    if (this.resumeBy > 0 && this.time > this.resumeBy) this.toMenu('Lost the connection to the game');
  }

  /** `fresh` is false for events too old to be worth playing. */
  private handle(m: ServerMessage, fresh: boolean): void {
    switch (m.type) {
      case 'welcome':
        this.welcome(m);
        break;
      case 'lobby':
        this.lobby = m;
        // Back in the lobby without a gameOver: the game crashed, or ended while we were away.
        if (m.state === 'lobby' && (this.state === 'playing' || this.state === 'paused')) {
          if (this.room?.solo) this.toMenu('The game ended');
          else this.toLobby();
        }
        break;
      case 'start':
        this.gameStarted(m.tick);
        break;
      case 'snapshot':
        if (this.state === 'playing' || this.state === 'paused') this.net?.snapshot(m, this.time);
        break;
      case 'events':
        if (fresh && (this.state === 'playing' || this.state === 'paused')) for (const e of m.events) this.onEvent(e);
        break;
      case 'gameOver':
        this.gameOver(m);
        break;
      case 'error':
        this.restarting = false;
        if (this.state === 'menu') this.menu.fail(m.message);
        else this.addFeed(m.message, DOWN_RED);
        // A create or join that failed leaves us in no room.
        if (!this.room) this.asked = null;
        break;
      case 'pong':
        break;
    }
  }

  private welcome(m: Extract<ServerMessage, { type: 'welcome' }>): void {
    this.roomOpens = this.link.opens;
    this.resumeBy = 0;
    this.you = m.you.playerId;
    // The same room again: a reconnect. The server follows with `start` if the game is still on.
    if (this.room?.code === m.room.code) return;
    this.room = { code: m.room.code, mapId: m.room.mapId, solo: this.asked === 'solo', doc: m.map };
    this.lobby = null;
    this.setLevel(buildLevel(m.map));
    this.scores.show(m.room.mapId);
    this.menu.done();
    if (!this.room.solo) this.toLobby();
  }

  private toLobby(): void {
    this.state = 'menu';
    this.menu.open('title');
    this.menu.showLobby();
  }

  private gameStarted(tick: number): void {
    const room = this.room;
    if (!room) return;
    const running = this.state === 'playing' || this.state === 'paused';
    if (running && this.net && tick > 0) {
      this.net.restart(true);
      return;
    }
    // A fresh level each game: the last one's doors were opened in its tile map.
    this.setLevel(buildLevel(room.doc));
    this.net = new NetGame(this.level, this.you);
    this.restarting = false;
    this.result = null;
    this.gameOverTimer = 0;
    this.state = 'playing';
    this.menu.done();
  }

  private gameOver(m: GameOverInfo): void {
    this.state = 'gameover';
    this.gameOverTimer = 0;
    this.result = m;
    sound.gameOver();
    const mine = m.players.find((p) => p.id === this.you);
    if (this.room) this.scores.show(this.room.mapId);
    this.scores.lastRank = mine?.rank ?? -1;
  }

  /** Solo: a new game in the same room. Co-op: back to the lobby to ready up again. */
  private playAgain(): void {
    if (!this.room) {
      this.toMenu();
    } else if (this.room.solo) {
      if (!this.restarting) this.startGame();
      this.restarting = true;
    } else {
      this.toLobby();
    }
  }

  get myResult(): GameResult | undefined {
    return this.result?.players.find((p) => p.id === this.you);
  }

  // ---------------------------------------------------------------- update

  /** @internal Public for the headless smoke run; the frame loop calls it. */
  update(dt: number): void {
    this.time += dt;
    const inp = this.input;
    if (inp.wasPressed('KeyM')) sound.toggleMute();
    sound.startMusic();
    // Keep the music audible on the audio page so the slider can be judged.
    sound.setMusicPaused(this.state === 'paused' && this.menu.page !== 'audio');
    this.pollNet();
    switch (this.state) {
      case 'menu':
        this.menu.update(this);
        break;
      case 'paused':
        // Online, the world keeps going behind the pause menu; you just stand still.
        this.runNet(dt, { ...NO_INPUT, aim: this.me.aim });
        if (this.state !== 'paused') break;
        if (inp.wasPressed('KeyP')) this.resume();
        else this.menu.update(this);
        break;
      case 'gameover':
        this.gameOverTimer += dt;
        this.updateEffects(dt);
        if (this.gameOverTimer > 1.5) {
          if (inp.wasPressed('Enter') || inp.mousePressed) this.playAgain();
          else if (inp.wasPressed('Escape')) this.toMenu();
        }
        break;
      case 'playing':
        if (inp.wasPressed('Escape', 'KeyP')) {
          this.pause();
          break;
        }
        this.runNet(dt, this.readInput());
        break;
    }
  }

  /** Send this tick's input (predicting it locally), then rebuild the world to draw. */
  private runNet(dt: number, input: PlayerInput): void {
    const net = this.net;
    if (!net) return;
    // While the socket is down the server isn't hearing us, so don't predict moves it won't make.
    if (this.link.status === 'open') this.link.send({ type: 'input', inputs: [net.tick(input, dt)] });
    this.world = net.view(this.time) ?? this.world;
    this.updateEffects(dt);
    this.updateGroans(dt);
  }

  private readInput(): PlayerInput {
    const inp = this.input;
    const p = this.me;
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
    for (const fx of this.playerFx.values()) {
      fx.flash = Math.max(0, fx.flash - dt);
      fx.hurtFlash = Math.max(0, fx.hurtFlash - dt * 2);
      fx.knifeSwing = Math.max(0, fx.knifeSwing - dt);
    }
    for (const z of this.world.zombies) {
      const zf = this.fxOf(z.id);
      zf.hitFlash = Math.max(0, zf.hitFlash - dt);
      zf.wobble += dt * (z.runner ? 14 : 6);
    }
    this.particles.update(dt);
    const f = this.focus;
    this.camera.follow(f.x, f.y, dt);
    this.callout.timer = Math.max(0, this.callout.timer - dt);
    this.banner.timer = Math.max(0, this.banner.timer - dt);
    for (const line of this.feed) line.timer -= dt;
    this.feed = this.feed.filter((l) => l.timer > 0);
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
    const zs = this.world.zombies;
    this.groanTimer -= dt;
    if (this.groanTimer > 0 || zs.length === 0) return;
    const z = zs[Math.floor(rand(0, zs.length))];
    sound.groan(this.volumeAt(z.x, z.y));
    this.groanTimer = rand(0.8, 3) / Math.min(3, 1 + zs.length / 8);
  }

  /** 0..1 loudness for a sound at a world position, by distance from where you're watching. */
  private volumeAt(x: number, y: number): number {
    const p = this.focus;
    return Math.max(0, 1 - dist(x, y, p.x, p.y) / HEARING_RANGE);
  }

  private playerById(id: number): PlayerView | undefined {
    return this.world.players.find((p) => p.id === id);
  }

  private nameOf(id: number): string {
    return this.playerById(id)?.name ?? this.lobby?.players.find((p) => p.id === id)?.name ?? 'Someone';
  }

  /** Loudness of a sound made by a player: full for your own, by distance for teammates'. */
  private volumeOf(id: number): number {
    if (id === this.you) return 1;
    const p = this.playerById(id);
    return p ? this.volumeAt(p.x, p.y) : 0;
  }

  private showCallout(text: string, color: string): void {
    this.callout = { text, color, timer: 2 };
  }

  private showBanner(text: string): void {
    this.banner = { text, timer: BANNER_TIME };
  }

  private addFeed(text: string, color = WHITE): void {
    this.feed.push({ text, color, timer: FEED_TIME });
    if (this.feed.length > 4) this.feed.shift();
  }

  /** Floating text above the player. */
  private playerText(text: string, color: string): void {
    const p = this.me;
    this.particles.text(text, p.x, p.y - 20, color);
  }

  /** Purchases, points and screen shake are only shown to whoever they belong to. */
  private onEvent(e: NetEvent): void {
    const mine = 'player' in e && e.player === this.you;
    const pts = (points: number, x: number, y: number) => {
      if (mine && points > 0) this.particles.text(`+${points}`, x, y);
    };
    switch (e.type) {
      case 'shot': {
        const wfx = WEAPON_FX[e.weapon];
        if (wfx.casing) this.particles.casing(e.x + Math.cos(e.aim) * 12, e.y + Math.sin(e.aim) * 12, e.aim, wfx.casing);
        this.playerFxOf(e.player).flash = 0.05;
        if (mine) this.camera.addShake(wfx.shake);
        sound.shot(e.weapon, mine ? 1 : this.volumeAt(e.x, e.y));
        break;
      }
      case 'tracer': {
        // The sim traces from the shooter's centre; draw from the muzzle.
        const wfx = WEAPON_FX[e.weapon];
        const len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
        const dx = len > 0 ? (e.x2 - e.x1) / len : 0;
        const dy = len > 0 ? (e.y2 - e.y1) / len : 0;
        const m = Math.min(len, PLAYER_RADIUS + wfx.barrel + 6);
        this.particles.tracer(e.x1 + dx * m, e.y1 + dy * m, e.x2, e.y2, wfx, TIER_HALO[e.tier]);
        // Back the mark off the wall face so it sits on the visible side.
        if (e.hitWall) this.particles.impact(e.x2 - dx * 1.5, e.y2 - dy * 1.5, Math.atan2(dy, dx) + Math.PI, wfx.tracer);
        break;
      }
      case 'explosion': {
        const vol = this.volumeAt(e.x, e.y);
        this.particles.explosion(e.x, e.y, '#8ad8ff');
        this.particles.ring(e.x, e.y, e.radius, '120, 220, 255');
        this.camera.addShake(3 * vol);
        sound.explosion(0.4 * vol);
        break;
      }
      case 'zombieHit': {
        this.fxOf(e.zombie).hitFlash = 0.08;
        this.particles.blood(e.x, e.y, e.angle, 6);
        if (mine && e.points > 0) {
          const z = this.world.zombies.find((z) => z.id === e.zombie);
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
        this.playerFxOf(e.player).knifeSwing = KNIFE.swing;
        sound.knife(e.hit, this.volumeOf(e.player));
        if (mine && e.hit) this.camera.addShake(2);
        break;
      case 'reload':
        if (mine) sound.reload();
        break;
      case 'playerHurt':
        this.playerFxOf(e.player).hurtFlash = 1;
        this.particles.blood(e.x, e.y, rand(0, TAU), 8);
        if (mine) {
          this.camera.addShake(7);
          sound.hurt();
        }
        break;
      case 'secondWind':
        if (mine) this.showCallout('SECOND WIND', PERK_VISUALS.secondWind.color);
        else this.addFeed(`${this.nameOf(e.player)} got a Second Wind`, PERK_VISUALS.secondWind.color);
        sound.revive(this.volumeOf(e.player));
        break;
      case 'playerDowned':
        if (mine) {
          this.showCallout('YOU ARE DOWN', DOWN_RED);
          this.camera.addShake(10);
          sound.hurt();
        } else {
          this.addFeed(`${this.nameOf(e.player)} is down!`, DOWN_RED);
          sound.denied();
        }
        break;
      case 'playerRevived':
        if (mine) this.showCallout('REVIVED', WHITE);
        else this.addFeed(e.by === this.you ? `You revived ${this.nameOf(e.player)}` : `${this.nameOf(e.by)} revived ${this.nameOf(e.player)}`);
        sound.revive(Math.max(this.volumeOf(e.player), this.volumeOf(e.by)));
        break;
      case 'playerDied':
        if (mine) this.showCallout('YOU BLED OUT', DOWN_RED);
        else this.addFeed(`${this.nameOf(e.player)} bled out`, DOWN_RED);
        break;
      case 'playerRespawned':
        if (mine) {
          this.camera.snap(e.x, e.y);
          this.playerText('Back in', WHITE);
        } else {
          this.addFeed(`${this.nameOf(e.player)} is back`);
        }
        break;
      case 'gameOver':
        // The room follows with a `gameOver` message carrying the results.
        break;
      case 'plankTorn':
        this.particles.debris(e.x, e.y);
        sound.plankTear(this.volumeAt(e.x, e.y));
        break;
      case 'plankPlaced':
        sound.plankPlace(mine ? 1 : this.volumeAt(e.x, e.y));
        pts(e.points, e.x, e.y - 10);
        break;
      case 'doorOpened':
        this.particles.debris(e.x, e.y);
        sound.door();
        break;
      case 'denied':
        if (!mine) break;
        this.playerText('Not enough points', '#d05050');
        sound.denied();
        break;
      case 'weaponGiven':
        if (!mine) break;
        this.playerText(weaponName(e.weapon, e.tier), WHITE);
        sound.buy();
        break;
      case 'ammoBought':
        if (!mine) break;
        this.playerText('Ammo', WHITE);
        sound.buy();
        break;
      case 'perkBought':
        if (!mine) break;
        this.playerText(PERKS[e.perk].name, PERK_VISUALS[e.perk].color);
        sound.perk();
        break;
      case 'armourBought':
        if (!mine) break;
        this.playerText(`Armour ${e.level}`, '#7aa8ff');
        sound.armour();
        break;
      case 'upgraded':
        if (!mine) break;
        this.playerText(weaponName(e.weapon, e.tier), '#c890ff');
        sound.upgrade();
        break;
      case 'powerUp':
        // Shared: everyone gets the callout.
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

  // ---------------------------------------------------------------- render

  private render(): void {
    const ctx = this.ctx;
    const { level, world } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const cx = Math.round(this.camera.x + this.camera.ox);
    const cy = Math.round(this.camera.y + this.camera.oy);

    ctx.save();
    ctx.translate(-cx, -cy);
    ctx.drawImage(this.mapCanvas, 0, 0);
    this.particles.drawDecals(ctx);
    level.fixtures.forEach((f, i) => drawInteractable(ctx, f, world.interactables[i], this.time));
    level.windows.forEach((w, i) => drawWindow(ctx, w, world.windows[i]));
    for (const z of world.zombies) drawZombie(ctx, z, this.fxOf(z.id), world.round.n);
    // The local player on top of teammates.
    const players = [...world.players].sort((a, b) => Number(a.id === this.you) - Number(b.id === this.you));
    for (const p of players) drawPlayer(ctx, p, this.playerFxOf(p.id), p.id === this.you);
    this.particles.draw(ctx);
    ctx.restore();

    this.lighting.draw(ctx, level, world, (id) => this.playerFxOf(id), cx, cy);

    ctx.save();
    ctx.translate(-cx, -cy);
    this.particles.drawGlow(ctx);
    drawPowerUps(ctx, world.powerUps.drops, this.time);
    level.fixtures.forEach((f, i) => drawInteractableOverlay(ctx, f, world.interactables[i], this.time));
    for (const p of players) drawPlayerOverlay(ctx, p, p.id === this.you, this.time);
    this.particles.drawTexts(ctx);
    ctx.restore();

    if (this.screenFlash > 0) {
      ctx.fillStyle = `rgba(255, 245, 220, ${this.screenFlash * 0.8})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    if (this.state !== 'menu') drawHUD(ctx, this);
    if (this.state === 'menu' || this.state === 'paused') this.menu.draw(ctx, this);
    else if (this.state === 'gameover') drawGameOver(ctx, this);
    else drawCrosshair(ctx, this.input.mouse.x, this.input.mouse.y, WEAPONS[heldWeapon(this.me).id].pellets > 1 ? 10 : 5);

    const cursor = this.state === 'playing' ? 'none' : 'default';
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }
}
