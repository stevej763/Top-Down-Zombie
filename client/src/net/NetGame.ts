import { angleDiff, lerp, type Vec2 } from '../core/math';
import type { PlayerInput } from '../game/input';
import { Tile } from '../game/TileMap';
import type { Level } from '../view/Level';
import type { PlayerView, WorldView, ZombieView } from '../view/WorldView';
import { movePlayer } from './PlayerMotion';
import type { ClientInput, Snapshot } from './protocol';

/** The server's sim rate; snapshot ticks count at this rate. */
const TICK_HZ = 60;
const DT = 1 / TICK_HZ;
/** Remote players and zombies are drawn this far behind the newest snapshot, between two real ones. */
const INTERP_DELAY = 0.1;
/** Snapshots older than this (behind the newest) are dropped. */
const BUFFER_TICKS = TICK_HZ;
/** A correction bigger than this is snapped rather than smoothed. */
const SNAP_DISTANCE = 64;
/** Per second; a correction is mostly gone in about 100 ms. */
const SMOOTH_RATE = 25;
/** Unacknowledged inputs kept for replay; past this the server is so far behind that replay is pointless. */
const MAX_PENDING = 180;
/** A clock sample this far off the smoothed one (a stall or a hidden tab) resets it. */
const CLOCK_RESET = 0.5;

/**
 * The network counterpart of the old local sim adapter: turns server snapshots into the
 * `WorldView` that's drawn. Everyone else is interpolated `INTERP_DELAY` behind the newest
 * snapshot; the local player is predicted from their own unacknowledged inputs, reconciled
 * against each snapshot, and corrections are smoothed. Aim is always local.
 */
export class NetGame {
  private pending: ClientInput[] = [];
  private snapshots: Snapshot[] = [];
  /** Server time minus local time, in seconds, smoothed. */
  private clockOffset = 0;
  private clockSet = false;
  /** Where the local player is after replaying unacknowledged inputs; null when not alive. */
  private predicted: Vec2 | null = null;
  /** Drawn offset from `predicted`; it decays to zero so corrections glide instead of snapping. */
  private correction = { x: 0, y: 0 };
  private aim = 0;

  /** `seq` is the last input the server applied for us (from `start`); ours carry on after it. */
  constructor(private readonly level: Level, readonly you: number, private seq: number) {}

  /** The newest snapshot, or null before the first. */
  get latest(): Snapshot | null {
    return this.snapshots[this.snapshots.length - 1] ?? null;
  }

  /**
   * The same game after a reconnect. Seqs never go below what the server has applied, or its acks
   * would cover every new input and reconciliation would drop them all.
   */
  resume(serverSeq: number): void {
    this.seq = Math.max(this.seq, serverSeq);
    this.pending = [];
    this.snapshots = [];
    this.clockSet = false;
    this.predicted = null;
    this.correction = { x: 0, y: 0 };
  }

  snapshot(s: Snapshot, now: number): void {
    const last = this.latest;
    if (last && s.tick <= last.tick) return;
    this.snapshots.push(s);
    while (this.snapshots.length > 2 && this.snapshots[1].tick <= s.tick - BUFFER_TICKS) this.snapshots.shift();

    const sample = s.tick / TICK_HZ - now;
    if (!this.clockSet || Math.abs(sample - this.clockOffset) > CLOCK_RESET) {
      this.clockOffset = sample;
      this.clockSet = true;
    } else {
      this.clockOffset += (sample - this.clockOffset) * 0.05;
    }

    this.openDoors(s);
    this.reconcile(s);
  }

  /** One client tick of local input: numbers it, predicts its movement, and returns it to send. */
  tick(input: PlayerInput, dt: number): ClientInput {
    const ci: ClientInput = { ...input, seq: ++this.seq };
    this.pending.push(ci);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    this.aim = input.aim;
    if (this.predicted) movePlayer(this.level.data.map, this.predicted, input, dt);
    const k = Math.exp(-dt * SMOOTH_RATE);
    this.correction.x *= k;
    this.correction.y *= k;
    return ci;
  }

  /** The world to draw at local time `now`, or null before the first snapshot. */
  view(now: number): WorldView | null {
    const latest = this.latest;
    if (!latest) return null;
    const [from, to, t] = this.bracket((now + this.clockOffset - INTERP_DELAY) * TICK_HZ);

    const fromPlayers = new Map(from.players.map((p) => [p.id, p]));
    const players = to.players
      .filter((p) => p.id !== this.you)
      .map((p) => {
        const f = fromPlayers.get(p.id);
        return f ? { ...p, x: lerp(f.x, p.x, t), y: lerp(f.y, p.y, t), aim: lerpAngle(f.aim, p.aim, t) } : p;
      });
    const me = latest.players.find((p) => p.id === this.you);
    if (me) players.push(this.local(me));

    const fromZombies = new Map(from.zombies.map((z) => [z.id, z]));
    const zombies = to.zombies.map((z): ZombieView => {
      const f = fromZombies.get(z.id);
      return f ? { ...z, x: lerp(f.x, z.x, t), y: lerp(f.y, z.y, t), facing: lerpAngle(f.facing, z.facing, t) } : z;
    });

    return {
      round: latest.round,
      power: latest.power,
      powerUps: latest.powerUps,
      players,
      zombies,
      windows: latest.windows,
      interactables: latest.interactables,
    };
  }

  private local(me: PlayerView): PlayerView {
    if (!this.predicted) return me.state === 'alive' ? { ...me, aim: this.aim } : me;
    return { ...me, x: this.predicted.x + this.correction.x, y: this.predicted.y + this.correction.y, aim: this.aim };
  }

  /** The two snapshots around `tick` and how far between them it is; clamped to the buffer's ends. */
  private bracket(tick: number): [Snapshot, Snapshot, number] {
    const ss = this.snapshots;
    const last = ss[ss.length - 1];
    if (tick >= last.tick) return [last, last, 0];
    if (tick <= ss[0].tick) return [ss[0], ss[0], 0];
    let i = ss.length - 2;
    while (i > 0 && ss[i].tick > tick) i--;
    const a = ss[i];
    const b = ss[i + 1];
    return [a, b, (tick - a.tick) / (b.tick - a.tick)];
  }

  /** Opened doors become floor, so prediction walks through them like the server does. */
  private openDoors(s: Snapshot): void {
    const map = this.level.data.map;
    this.level.fixtures.forEach((f, i) => {
      if (f.kind === 'door' && s.interactables[i]?.open) for (const [tx, ty] of f.def.tiles) map.set(tx, ty, Tile.Floor);
    });
  }

  /** Drop acknowledged inputs, restart from the server's position and replay the rest. */
  private reconcile(s: Snapshot): void {
    const me = s.players.find((p) => p.id === this.you);
    const ack = s.acks[String(this.you)] ?? 0;
    this.pending = this.pending.filter((i) => i.seq > ack);
    if (!me || me.state !== 'alive') {
      this.predicted = null;
      this.correction = { x: 0, y: 0 };
      return;
    }
    const p = { x: me.x, y: me.y };
    for (const inp of this.pending) movePlayer(this.level.data.map, p, inp, DT);
    if (this.predicted) {
      // Keep the drawn position where it was; the correction then decays.
      const cx = this.predicted.x + this.correction.x - p.x;
      const cy = this.predicted.y + this.correction.y - p.y;
      this.correction = Math.hypot(cx, cy) > SNAP_DISTANCE ? { x: 0, y: 0 } : { x: cx, y: cy };
    }
    this.predicted = p;
  }
}

/** By the shorter way round. */
function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(a, b) * t;
}
