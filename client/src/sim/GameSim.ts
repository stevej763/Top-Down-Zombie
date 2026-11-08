import { angleDiff, dist, rayCircle } from '../core/math';
import { aimAssist } from './aimAssist';
import { Barricade } from './Barricade';
import { ARMOUR_ABSORB, KNIFE, PERK_EFFECTS, POINTS, POWERUP_TUNING, WEAPONS, type PowerUpId } from './defs';
import { Economy } from './Economy';
import type { SimEvent } from './events';
import type { PlayerInput } from './input';
import {
  ArmourBench, Door, MysteryBox, PerkMachine, UpgradeBench, WallBuy, type Interactable,
} from './Interactables';
import { parseMap, type MapDoc, type RoomId } from './MapData';
import { FlowField } from './Pathfinding';
import { Player } from './Player';
import { PowerUps } from './PowerUps';
import { RoundManager } from './RoundManager';
import { Rng } from './Rng';
import { Tile, TileMap } from './TileMap';
import type { Weapon } from './Weapon';
import { Zombie } from './Zombie';

export type Interaction =
  | { kind: 'rebuild'; barricade: Barricade }
  | { kind: 'use'; target: Interactable }
  | null;

/**
 * The whole game simulation: world state plus `step(dt, input)`. No DOM, canvas or audio;
 * everything the player should see or hear is pushed to `events` for the client to drain.
 * This is what gets ported to Java (server/sim) for the authoritative server.
 */
export class GameSim {
  readonly mapId: string;
  readonly map: TileMap;
  readonly barricades: Barricade[];
  readonly interactables: Interactable[];
  readonly openRooms: Set<RoomId>;
  readonly player: Player;
  zombies: Zombie[] = [];
  readonly rounds = new RoundManager();
  readonly flow: FlowField;
  readonly economy = new Economy();
  readonly powerUps = new PowerUps();
  readonly rng: Rng;
  kills = 0;
  time = 0;
  over = false;
  /** Filled during `step`; the client takes and clears it. */
  events: SimEvent[] = [];
  private lastId = 0;

  constructor(doc: MapDoc, seed: number) {
    const data = parseMap(doc);
    this.mapId = data.id;
    this.map = data.map;
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
    this.flow = new FlowField(this.map, (t) => t === Tile.Floor);
    this.rng = new Rng(seed);
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  nextId(): number {
    return ++this.lastId;
  }

  step(dt: number, input: PlayerInput): void {
    if (this.over) return;
    this.time += dt;
    this.economy.multiplier = this.powerUps.double > 0 ? 2 : 1;

    this.player.update(dt, input, this);
    this.flow.update(this.player.x, this.player.y);
    this.rounds.update(dt, this);
    for (const it of this.interactables) it.update(dt, this);
    for (const z of this.zombies) z.update(dt, this);
    this.separate();
    this.zombies = this.zombies.filter((z) => !z.dead);
    this.powerUps.update(dt, this);
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
    for (let i = 0; i < def.pellets; i++) {
      this.traceShot(p.x, p.y, base + this.rng.range(-def.spread / 2, def.spread / 2), w);
    }
    this.emit({ type: 'shot', weapon: def.id, tier: w.tier, x: p.x, y: p.y, aim: p.aim });
  }

  /** Hitscan from the player's centre. */
  private traceShot(ox: number, oy: number, angle: number, w: Weapon): void {
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
    const hitWall = !def.splash && end === wallD && wallD < def.range;
    this.emit({ type: 'tracer', weapon: def.id, tier: w.tier, x1: ox, y1: oy, x2: ex, y2: ey, hitWall });
    if (def.splash) this.explode(ex, ey, def.splash.radius, def.splash.damage * (w.damage / def.damage));
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
    this.emit({ type: 'knife', hit: target !== null });
    if (!target) return;
    const angle = Math.atan2(target.y - p.y, target.x - p.x);
    this.hitZombie(target, KNIFE.damage, target.x, target.y, angle, false, POINTS.knifeKill);
    if (!target.dead && target.state === 'inside') {
      target.x += Math.cos(angle) * 8;
      target.y += Math.sin(angle) * 8;
    }
  }

  private explode(x: number, y: number, radius: number, damage: number): void {
    for (const z of this.zombies) {
      if (z.dead) continue;
      const d = dist(x, y, z.x, z.y);
      if (d < radius + Zombie.RADIUS) {
        this.hitZombie(z, damage * (1 - 0.5 * Math.min(1, d / radius)), z.x, z.y, Math.atan2(z.y - y, z.x - x), false);
      }
    }
    this.emit({ type: 'explosion', x, y, radius });
  }

  private hitZombie(
    z: Zombie, damage: number, hx: number, hy: number, angle: number, head: boolean,
    killPoints: number = head ? POINTS.headshotKill : POINTS.kill,
  ): void {
    if (z.dead) return;
    z.hp -= this.powerUps.instakill > 0 ? z.hp : head ? damage * 1.5 : damage;
    if (z.state === 'inside') {
      z.x += Math.cos(angle) * 2;
      z.y += Math.sin(angle) * 2;
    }
    const points = z.hp <= 0 ? 0 : this.economy.award(POINTS.hit);
    this.emit({ type: 'zombieHit', zombie: z.id, x: hx, y: hy, angle, points });
    if (z.hp <= 0) this.killZombie(z, killPoints);
  }

  private killZombie(z: Zombie, points: number): void {
    z.dead = true;
    if (z.window.climber === z) z.window.climber = null;
    this.kills++;
    const awarded = points > 0 ? this.economy.award(points) : 0;
    this.emit({ type: 'zombieKilled', zombie: z.id, x: z.x, y: z.y, points: awarded });
    // Only drop power-ups where the player can reach them.
    if (z.state === 'inside') this.powerUps.maybeDrop(this, z.x, z.y);
  }

  applyPowerUp(id: PowerUpId): void {
    switch (id) {
      case 'ammo':
        for (const w of this.player.weapons) w?.refill();
        break;
      case 'instakill':
        this.powerUps.instakill = POWERUP_TUNING.duration;
        break;
      case 'double':
        this.powerUps.double = POWERUP_TUNING.duration;
        break;
      case 'nuke':
        for (const z of this.zombies) if (!z.dead) this.killZombie(z, 0);
        this.economy.award(POINTS.nuke);
        break;
    }
    this.emit({ type: 'powerUp', id });
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
    this.emit({ type: 'playerHurt', x: p.x, y: p.y });
    if (p.hp > 0) return;

    if (p.perks.has('secondWind')) {
      this.secondWind();
    } else {
      p.hp = 0;
      this.over = true;
      this.emit({ type: 'gameOver' });
    }
  }

  /** Get back up: lose every perk, full health, brief invulnerability, zombies shoved back. */
  private secondWind(): void {
    const p = this.player;
    p.perks.clear();
    p.hp = p.maxHp;
    p.invuln = PERK_EFFECTS.secondWindInvuln;
    for (const z of this.zombies) {
      if (z.state !== 'inside') continue;
      const d = dist(p.x, p.y, z.x, z.y);
      if (d < 140 && d > 0) {
        z.x += ((z.x - p.x) / d) * 60;
        z.y += ((z.y - p.y) / d) * 60;
        this.map.collideCircle(z, Zombie.RADIUS, z.solid);
      }
    }
    this.emit({ type: 'secondWind' });
  }

  tearPlank(b: Barricade): void {
    if (!b.tear()) return;
    this.emit({ type: 'plankTorn', x: b.center.x, y: b.center.y });
  }

  rebuildPlank(b: Barricade): void {
    if (!b.rebuild()) return;
    let points = 0;
    if (this.economy.rebuildLeft >= POINTS.plank) {
      this.economy.rebuildLeft -= POINTS.plank;
      points = this.economy.award(POINTS.plank);
    }
    this.emit({ type: 'plankPlaced', x: b.center.x, y: b.center.y, points });
  }

  /** Put a weapon in the empty slot, or replace the one in hand. */
  giveWeapon(w: Weapon): void {
    const p = this.player;
    const empty = p.weapons.indexOf(null);
    const slot = empty >= 0 ? empty : p.slot;
    p.weapon.cancelReload();
    p.weapons[slot] = w;
    p.slot = slot;
    this.emit({ type: 'weaponGiven', weapon: w.def.id, tier: w.tier });
  }

  openDoor(door: Door): void {
    door.open = true;
    for (const [tx, ty] of door.def.tiles) this.map.set(tx, ty, Tile.Floor);
    for (const r of door.def.rooms) this.openRooms.add(r);
    this.flow.invalidate();
    this.emit({ type: 'doorOpened', x: door.standX, y: door.standY });
  }
}
