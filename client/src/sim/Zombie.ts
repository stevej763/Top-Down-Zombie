import { dist, lerp, turnToward } from '../core/math';
import type { Barricade } from './Barricade';
import { ZOMBIE_RADIUS } from './defs';
import type { GameSim } from './GameSim';
import { Player } from './Player';
import { Tile, type TileType } from './TileMap';

export type ZombieState = 'outside' | 'breaching' | 'climbing' | 'inside';

const BREACH_RANGE = 26;
const ATTACK_WINDUP = 0.45;
const ATTACK_COOLDOWN = 0.8;
/** Close enough with a clear line to walk straight at the player instead of following the flow field. */
const DIRECT_CHASE_RANGE = 180;

const outsideSolid = (t: TileType) => t !== Tile.Outside;
const insideSolid = (t: TileType) => t !== Tile.Floor;

export class Zombie {
  static readonly RADIUS = ZOMBIE_RADIUS;

  state: ZombieState = 'outside';
  facing: number;
  hp: number;
  readonly maxHp: number;
  attackTimer = 0;
  tearTimer = 0;
  dead = false;
  private climbT = 0;
  private climbFromX = 0;
  private climbFromY = 0;

  constructor(
    /** Unique within a sim, for events and (later) network snapshots. */
    readonly id: number,
    readonly window: Barricade,
    public x: number,
    public y: number,
    hp: number,
    readonly speed: number,
    readonly damage: number,
    readonly runner: boolean,
    private tearInterval: number,
  ) {
    this.hp = this.maxHp = hp;
    this.facing = Math.atan2(window.center.y - y, window.center.x - x);
  }

  get solid(): (t: TileType) => boolean {
    return this.state === 'inside' ? insideSolid : outsideSolid;
  }

  update(dt: number, game: GameSim): void {
    const b = this.window;

    switch (this.state) {
      case 'outside': {
        this.moveToward(b.outsidePoint.x, b.outsidePoint.y, this.speed, dt);
        game.map.collideCircle(this, Zombie.RADIUS, outsideSolid);
        if (dist(this.x, this.y, b.outsidePoint.x, b.outsidePoint.y) < BREACH_RANGE) {
          this.state = 'breaching';
          this.tearTimer = this.tearInterval * 0.6;
        }
        break;
      }

      case 'breaching': {
        const d = dist(this.x, this.y, b.outsidePoint.x, b.outsidePoint.y);
        if (d > 3) this.moveToward(b.outsidePoint.x, b.outsidePoint.y, this.speed * 0.5, dt);
        this.facing = turnToward(this.facing, Math.atan2(b.center.y - this.y, b.center.x - this.x), dt * 8);
        game.map.collideCircle(this, Zombie.RADIUS, outsideSolid);
        if (d > BREACH_RANGE + 10) {
          this.state = 'outside';
        } else if (b.planks > 0) {
          this.tearTimer -= dt;
          if (this.tearTimer <= 0) {
            game.tearPlank(b);
            this.tearTimer = this.tearInterval;
          }
        } else if (!b.climber && d < 10) {
          b.climber = this;
          this.state = 'climbing';
          this.climbT = 0;
          this.climbFromX = this.x;
          this.climbFromY = this.y;
        }
        break;
      }

      case 'climbing': {
        this.climbT += dt / (this.runner ? 0.55 : 0.9);
        const t = Math.min(1, this.climbT);
        this.x = lerp(this.climbFromX, b.insidePoint.x, t);
        this.y = lerp(this.climbFromY, b.insidePoint.y, t);
        this.facing = Math.atan2(b.insidePoint.y - b.center.y, b.insidePoint.x - b.center.x);
        if (t >= 1) {
          this.state = 'inside';
          b.climber = null;
        }
        break;
      }

      case 'inside': {
        const p = game.player;
        const dp = dist(this.x, this.y, p.x, p.y);
        const reach = Zombie.RADIUS + Player.RADIUS + 6;

        if (dp < reach) {
          this.attackTimer += dt;
          if (this.attackTimer >= ATTACK_WINDUP) {
            game.damagePlayer(this.damage);
            this.attackTimer = -ATTACK_COOLDOWN;
          }
        } else {
          this.attackTimer = this.attackTimer > 0 ? 0 : Math.min(0, this.attackTimer + dt);
        }

        if (dp > reach - 4) {
          let tx = p.x;
          let ty = p.y;
          if (!(dp < DIRECT_CHASE_RANGE && game.map.hasLOS(this.x, this.y, p.x, p.y))) {
            const next = game.flow.nextTarget(this.x, this.y);
            if (next) {
              tx = next.x;
              ty = next.y;
            }
          }
          this.moveToward(tx, ty, this.speed, dt);
        }
        if (dp < 80) this.facing = turnToward(this.facing, Math.atan2(p.y - this.y, p.x - this.x), dt * 10);
        game.map.collideCircle(this, Zombie.RADIUS, insideSolid);
        break;
      }
    }
  }

  private moveToward(tx: number, ty: number, speed: number, dt: number): void {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.001) return;
    const step = Math.min(d, speed * dt);
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    this.facing = turnToward(this.facing, Math.atan2(dy, dx), dt * 10);
  }
}
