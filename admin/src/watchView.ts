import { TAU } from '../../client/src/core/math';
import { KNIFE, PERKS, POWERUPS, weaponName } from '../../client/src/game/defs';
import { NetGame } from '../../client/src/net/NetGame';
import type { MapDoc } from '../../client/src/game/MapData';
import { TILE } from '../../client/src/game/TileMap';
import type { NetEvent, SpectatorMessage } from '../../client/src/net/protocol';
import { renderMap } from '../../client/src/render/draw';
import { Lighting } from '../../client/src/render/lighting';
import type { PlayerFx, ZombieFx } from '../../client/src/render/visuals';
import { drawWorld } from '../../client/src/render/world';
import { buildLevel, type Level } from '../../client/src/view/Level';
import type { WorldView } from '../../client/src/view/WorldView';
import { watchSocket } from './api';
import { h } from './dom';

const FEED_MAX = 60;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

/**
 * Spectates one room over /ws/watch, drawn with the game's own renderer. Players aren't told: the
 * server keeps watchers out of everything it sends them. Shows the whole map or follows a player.
 */
export class WatchView {
  private readonly ws: WebSocket;
  private readonly canvas = h('canvas', { class: 'watch-canvas' });
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly buf = document.createElement('canvas');
  private readonly bctx = this.buf.getContext('2d')!;
  private readonly statusEl = h('span', { class: 'hint' }, 'Connecting…');
  private readonly followEl = h('select', {});
  private readonly lightEl = h('input', { type: 'checkbox', checked: true });
  private readonly playersEl = h('div', { class: 'watch-players' });
  private readonly feedEl = h('ul', { class: 'feed' });

  private doc: MapDoc | null = null;
  private level: Level | null = null;
  private mapCanvas: HTMLCanvasElement | null = null;
  private net: NetGame | null = null;
  private lighting: Lighting | null = null;
  private world: WorldView | null = null;
  private names = new Map<number, string>();
  private round = 0;
  /** A player id, or -1 for the whole map. */
  private follow = -1;
  private zoom = 1.5;
  private playerFx = new Map<number, PlayerFx>();
  private zombieFx = new Map<number, ZombieFx>();
  private raf = 0;
  private last = 0;
  private panelAt = 0;
  private closed = false;

  constructor(parent: HTMLElement, code: string, onBack: () => void) {
    this.followEl.addEventListener('change', () => (this.follow = Number(this.followEl.value)));
    this.canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      if (this.follow < 0) return;
      this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * Math.exp(-ev.deltaY * 0.0015)));
    }, { passive: false });
    parent.replaceChildren(
      h('div', { class: 'watch' },
        h('div', { class: 'watch-bar' },
          h('button', { onclick: onBack }, '← Rooms'),
          h('span', { class: 'code' }, code),
          this.statusEl,
          h('span', { class: 'spacer' }),
          h('label', {}, 'Camera ', this.followEl),
          h('label', {}, this.lightEl, ' Darkness')),
        h('div', { class: 'watch-body' },
          h('div', { class: 'watch-stage' }, this.canvas),
          h('aside', { class: 'watch-side' }, h('h3', {}, 'Players'), this.playersEl, h('h3', {}, 'Feed'), this.feedEl))));
    this.updateFollow();

    this.ws = watchSocket(code);
    this.ws.onmessage = (ev) => this.handle(JSON.parse(ev.data as string) as SpectatorMessage);
    this.ws.onclose = () => {
      if (!this.closed) this.status('Disconnected: the room closed or the connection dropped', true);
    };
    this.raf = requestAnimationFrame(this.frame);
  }

  close(): void {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.ws.close();
  }

  private status(text: string, bad = false): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('bad', bad);
  }

  private now(): number {
    return performance.now() / 1000;
  }

  private handle(m: SpectatorMessage): void {
    switch (m.type) {
      case 'watch':
        this.doc = m.map;
        this.reset();
        for (const p of m.lobby.players) this.names.set(p.id, p.name);
        this.status(`${m.room.mapId} · ${m.room.solo ? 'solo' : 'co-op'} · ${m.lobby.state}`);
        this.updateFollow();
        break;
      case 'lobby':
        for (const p of m.players) this.names.set(p.id, p.name);
        this.status(`${m.state === 'playing' ? 'Playing' : 'In the lobby'} · ${m.players.length} player(s)`);
        this.updateFollow();
        break;
      case 'start':
        // A new game in the same room: start from a clean map (NetGame opens doors in the level's tiles).
        this.reset();
        this.feed('A new game started');
        break;
      case 'snapshot':
        this.net?.snapshot(m, this.now());
        break;
      case 'events':
        for (const e of m.events) this.onEvent(e);
        break;
      case 'gameOver':
        this.feed(`Game over after ${m.round} round(s): ${m.players.map((p) => `${p.name} ${p.kills} kills`).join(', ')}`);
        break;
      case 'error':
        this.status(m.message, true);
        break;
      case 'welcome':
      case 'pong':
        break;
    }
  }

  private reset(): void {
    if (!this.doc) return;
    this.level = buildLevel(this.doc);
    this.mapCanvas = renderMap(this.level.data);
    this.net = new NetGame(this.level, -1, 0);
    this.lighting = null;
    this.round = 0;
  }

  private name(id: number): string {
    return this.names.get(id) ?? `#${id}`;
  }

  private onEvent(e: NetEvent): void {
    switch (e.type) {
      case 'shot':
        this.pfx(e.player).flash = 0.05;
        break;
      case 'zombieHit':
        this.zfx(e.zombie).hitFlash = 0.08;
        break;
      case 'knife':
        this.pfx(e.player).knifeSwing = KNIFE.swing;
        break;
      case 'playerHurt':
        this.pfx(e.player).hurtFlash = 1;
        break;
      case 'roundStart':
        this.round = e.round;
        this.feed(`Round ${e.round}`);
        break;
      case 'playerDowned':
        this.feed(`${this.name(e.player)} is down`);
        break;
      case 'playerRevived':
        this.feed(`${this.name(e.by)} revived ${this.name(e.player)}`);
        break;
      case 'playerDied':
        this.feed(`${this.name(e.player)} died`);
        break;
      case 'playerRespawned':
        this.feed(`${this.name(e.player)} is back`);
        break;
      case 'powerOn':
        this.feed(`${this.name(e.player)} turned the power on`);
        break;
      case 'perkBought':
        this.feed(`${this.name(e.player)} bought ${PERKS[e.perk]?.name ?? e.perk}`);
        break;
      case 'weaponGiven':
        this.feed(`${this.name(e.player)} got the ${weaponName(e.weapon, e.tier)}`);
        break;
      case 'upgraded':
        this.feed(`${this.name(e.player)} upgraded to the ${weaponName(e.weapon, e.tier)}`);
        break;
      case 'armourBought':
        this.feed(`${this.name(e.player)} bought armour ${e.level}`);
        break;
      case 'powerUp':
        this.feed(`${this.name(e.player)} picked up ${POWERUPS[e.id]?.name ?? e.id}`);
        break;
      case 'doorOpened':
        this.feed('A door opened');
        break;
      default:
        break;
    }
  }

  private feed(text: string): void {
    const time = new Date().toLocaleTimeString();
    this.feedEl.prepend(h('li', {}, h('span', { class: 'hint' }, time), ' ', text));
    while (this.feedEl.children.length > FEED_MAX) this.feedEl.lastElementChild!.remove();
  }

  private pfx(id: number): PlayerFx {
    let fx = this.playerFx.get(id);
    if (!fx) this.playerFx.set(id, (fx = { flash: 0, hurtFlash: 0, knifeSwing: 0, hand: 1 }));
    return fx;
  }

  private zfx(id: number): ZombieFx {
    let fx = this.zombieFx.get(id);
    if (!fx) this.zombieFx.set(id, (fx = { hitFlash: 0, wobble: (id * 2.399) % TAU }));
    return fx;
  }

  private updateFollow(): void {
    const value = String(this.follow);
    const opts = [h('option', { value: '-1' }, 'Whole map'),
      ...[...this.names].map(([id, name]) => h('option', { value: String(id) }, `Follow ${name}`))];
    this.followEl.replaceChildren(...opts);
    this.followEl.value = [...this.followEl.options].some((o) => o.value === value) ? value : '-1';
    this.follow = Number(this.followEl.value);
  }

  private frame = (t: number): void => {
    if (this.closed) return;
    const dt = Math.min((t - (this.last || t)) / 1000, 0.25);
    this.last = t;
    this.world = this.net?.view(this.now()) ?? null;
    if (this.world) {
      for (const fx of this.playerFx.values()) {
        fx.flash = Math.max(0, fx.flash - dt);
        fx.hurtFlash = Math.max(0, fx.hurtFlash - dt * 2);
        fx.knifeSwing = Math.max(0, fx.knifeSwing - dt);
      }
      for (const z of this.world.zombies) {
        const zf = this.zfx(z.id);
        zf.hitFlash = Math.max(0, zf.hitFlash - dt);
        zf.wobble += dt * (z.runner ? 14 : 6);
      }
      if (t - this.panelAt > 250) {
        this.panelAt = t;
        this.renderPlayers(this.world);
      }
    }
    this.render(t / 1000);
    this.raf = requestAnimationFrame(this.frame);
  };

  private render(time: number): void {
    const stage = this.canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(stage.clientWidth * dpr));
    const ch = Math.max(1, Math.round(stage.clientHeight * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    const level = this.level;
    const world = this.world;
    if (!level || !this.mapCanvas) return;

    const mw = level.data.map.w * TILE;
    const mh = level.data.map.h * TILE;
    const target = world?.players.find((p) => p.id === this.follow && p.state !== 'dead');
    // Screen pixels per world pixel.
    const scale = target ? this.zoom * dpr : Math.min(cw / mw, ch / mh) * 0.96;
    // The world is drawn 1:1 into a buffer the size of the view, so the lighting mask lines up, then scaled.
    const bw = Math.ceil(cw / scale);
    const bh = Math.ceil(ch / scale);
    if (this.buf.width !== bw || this.buf.height !== bh) {
      this.buf.width = bw;
      this.buf.height = bh;
      this.lighting = null;
    }
    const cx = Math.round(target ? target.x - bw / 2 : (mw - bw) / 2);
    const cy = Math.round(target ? target.y - bh / 2 : (mh - bh) / 2);
    const b = this.bctx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.fillStyle = '#000';
    b.fillRect(0, 0, bw, bh);
    if (world) {
      const dark = this.lightEl.checked;
      if (dark && !this.lighting) this.lighting = new Lighting(bw, bh);
      drawWorld(b, level, world, this.mapCanvas, cx, cy, {
        time,
        you: -1,
        light: world.power && level.lights.length ? 1 : 0,
        playerFx: (id) => this.pfx(id),
        zombieFx: (id) => this.zfx(id),
        doorSwing: () => undefined,
        lighting: dark ? this.lighting : null,
      });
    } else {
      b.drawImage(this.mapCanvas, -cx, -cy);
    }
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(this.buf, 0, 0, bw * scale, bh * scale);
    if (!world) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, ch / 2 - 30 * dpr, cw, 60 * dpr);
      ctx.fillStyle = '#d9d6cc';
      ctx.font = `${16 * dpr}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('No game running in this room yet', cw / 2, ch / 2 + 6 * dpr);
    }
  }

  private renderPlayers(world: WorldView): void {
    const rows = world.players.map((p) => {
      const w = p.weapons[p.slot];
      return h('div', { class: `wp ${p.state}`, onclick: () => { this.follow = p.id; this.followEl.value = String(p.id); } },
        h('div', { class: 'wp-head' }, h('b', {}, p.name), h('span', { class: 'hint' }, p.state === 'alive' ? `${Math.ceil(p.hp)} hp` : p.state)),
        h('div', { class: 'wp-line' }, `${p.points.toLocaleString()} pts · ${p.kills} kills`),
        h('div', { class: 'wp-line hint' }, w ? `${weaponName(w.id, w.tier)} ${w.mag}/${w.reserve}` : '—',
          p.perks.length ? ` · ${p.perks.map((k) => PERKS[k]?.name ?? k).join(', ')}` : ''));
    });
    this.playersEl.replaceChildren(
      h('div', { class: 'hint' }, `Round ${world.round.n || this.round} · ${world.zombies.length} zombies · power ${world.power ? 'on' : 'off'}`),
      ...rows);
  }
}
