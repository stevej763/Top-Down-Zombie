import type { PerkId, PowerUpId, WeaponId } from '../sim/defs';
import type { PlayerInput } from '../sim/input';
import type { MapDoc } from '../sim/MapData';

/**
 * The /ws protocol: JSON messages with a `type` field. Mirrors the Java records in
 * server/app/.../game/protocol (ClientMessage, ClientInput, ServerMessage, Snapshot) and
 * server/sim SimEvent; keep the field names identical. Player ids are sim ids (small ints,
 * unique within a room), not account UUIDs. Not used by the client yet (Phase 4 M4).
 */

// ----------------------------------------------------------------- client → server

/** One client tick of input. Seqs start at 1 for each game; snapshots ack the last one applied. */
export interface ClientInput extends PlayerInput {
  seq: number;
}

export type ClientMessage =
  /** A solo room starts straight away and nobody else can join it. */
  | { type: 'create'; mapId: string; solo: boolean }
  | { type: 'join'; code: string }
  | { type: 'ready'; ready: boolean }
  /** Owner only, in the lobby, once everyone else is ready. */
  | { type: 'start' }
  /** Usually one input; send several to catch up after a stall. */
  | { type: 'input'; inputs: ClientInput[] }
  | { type: 'leave' }
  | { type: 'ping'; t: number };

// ----------------------------------------------------------------- server → client

export interface LobbyPlayer {
  id: number;
  name: string;
  ready: boolean;
  connected: boolean;
}

export interface GameResult {
  id: number;
  name: string;
  kills: number;
  points: number;
  /** 0-based position on the map's leaderboard, or -1 if the score wasn't saved. */
  rank: number;
}

export type ServerMessage =
  /** On joining a room, and on reconnecting to one. */
  | { type: 'welcome'; you: { playerId: number; name: string }; room: { code: string; mapId: string; mapVersion: number }; map: MapDoc }
  /** The room's members, whenever they change. */
  | { type: 'lobby'; code: string; state: 'lobby' | 'playing'; ownerId: number; players: LobbyPlayer[] }
  | { type: 'start'; tick: number }
  | Snapshot
  /** Everything the sim emitted during one tick. */
  | { type: 'events'; tick: number; events: NetEvent[] }
  /** `round` is rounds survived, as stored on the leaderboard. The room then goes back to the lobby. */
  | { type: 'gameOver'; round: number; players: GameResult[] }
  | { type: 'pong'; t: number }
  | { type: 'error'; message: string };

// ----------------------------------------------------------------- snapshot (20 Hz)

export type PlayerState = 'alive' | 'downed' | 'dead';
export type ZombieStateName = 'outside' | 'breaching' | 'climbing' | 'inside';
export type BoxState = 'closed' | 'rolling' | 'ready';

export interface WeaponSnap {
  id: WeaponId;
  tier: number;
  mag: number;
  reserve: number;
  /** 0..1, 0 when not reloading. */
  reloadProgress: number;
}

/** `window` and `target` index the snapshot's `windows` and `interactables`. */
export type InteractionSnap =
  | { kind: 'rebuild'; window: number }
  | { kind: 'use'; target: number }
  | { kind: 'revive'; player: number };

export interface PlayerSnap {
  id: number;
  name: string;
  x: number;
  y: number;
  aim: number;
  hp: number;
  maxHp: number;
  state: PlayerState;
  /** Seconds left before a downed player dies. */
  bleedout: number;
  /** Seconds of reviving so far (3 to finish). */
  reviveProgress: number;
  armour: number;
  armourLevel: number;
  points: number;
  kills: number;
  slot: number;
  /** Always two entries; an empty slot is null. */
  weapons: [WeaponSnap | null, WeaponSnap | null];
  perks: PerkId[];
  invuln: number;
  interaction: InteractionSnap | null;
}

export interface ZombieSnap {
  id: number;
  x: number;
  y: number;
  facing: number;
  state: ZombieStateName;
  runner: boolean;
}

/** Doors carry `open`; the box carries its state; everything else is `{}`. */
export interface InteractableSnap {
  open?: boolean;
  state?: BoxState;
  shown?: WeaponId;
  timer?: number;
  /** Player id who paid for the roll, or -1. */
  owner?: number;
}

/** Floats are rounded to 2 decimals. */
export interface Snapshot {
  type: 'snapshot';
  tick: number;
  /** Player id (as a string key) → last input seq applied. */
  acks: Record<string, number>;
  round: { n: number; active: boolean; remaining: number; intermission: number };
  powerUps: { instakill: number; double: number; drops: { id: PowerUpId; x: number; y: number; life: number }[] };
  players: PlayerSnap[];
  zombies: ZombieSnap[];
  /** Plank counts, in map order. */
  windows: number[];
  /** In GameSim order: wall buys, perks, armour, upgrade, box, doors. */
  interactables: InteractableSnap[];
}

// ----------------------------------------------------------------- events

/**
 * The Java SimEvent: sim/events.ts plus the acting `player` id, and the co-op events.
 * For hits and kills, `player` is whoever got the points.
 */
export type NetEvent =
  | { type: 'shot'; player: number; weapon: WeaponId; tier: number; x: number; y: number; aim: number }
  | { type: 'tracer'; player: number; weapon: WeaponId; tier: number; x1: number; y1: number; x2: number; y2: number; hitWall: boolean }
  | { type: 'explosion'; x: number; y: number; radius: number }
  | { type: 'zombieHit'; player: number; zombie: number; x: number; y: number; angle: number; points: number }
  | { type: 'zombieKilled'; player: number; zombie: number; x: number; y: number; points: number }
  | { type: 'knife'; player: number; hit: boolean }
  | { type: 'reload'; player: number }
  | { type: 'playerHurt'; player: number; x: number; y: number }
  | { type: 'secondWind'; player: number }
  | { type: 'playerDowned'; player: number; x: number; y: number }
  | { type: 'playerRevived'; player: number; by: number }
  /** Bled out; respawns at the next round start. */
  | { type: 'playerDied'; player: number }
  | { type: 'playerRespawned'; player: number; x: number; y: number }
  | { type: 'gameOver' }
  | { type: 'plankTorn'; x: number; y: number }
  | { type: 'plankPlaced'; player: number; x: number; y: number; points: number }
  | { type: 'doorOpened'; x: number; y: number }
  | { type: 'denied'; player: number }
  | { type: 'weaponGiven'; player: number; weapon: WeaponId; tier: number }
  | { type: 'ammoBought'; player: number }
  | { type: 'perkBought'; player: number; perk: PerkId }
  | { type: 'armourBought'; player: number; level: number }
  | { type: 'upgraded'; player: number; weapon: WeaponId; tier: number }
  | { type: 'powerUp'; player: number; id: PowerUpId }
  | { type: 'roundStart'; round: number }
  | { type: 'roundEnd'; round: number }
  | { type: 'boxTick' }
  | { type: 'boxReveal'; weapon: WeaponId };
