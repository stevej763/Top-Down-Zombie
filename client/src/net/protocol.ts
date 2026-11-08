import type { PerkId, PowerUpId, WeaponId } from '../game/defs';
import type { PlayerInput } from '../game/input';
import type { MapDoc } from '../game/MapData';
import type { WorldView } from '../view/WorldView';

/**
 * The /ws protocol: JSON messages with a `type` field. Mirrors the Java records in
 * server/app/.../game/protocol (ClientMessage, ClientInput, ServerMessage, Snapshot) and
 * server/sim SimEvent; keep the field names identical. Player ids are sim ids (small ints,
 * unique within a room), not account UUIDs.
 */

// ----------------------------------------------------------------- client → server

/** One client tick of input. Seqs carry on from `start.seq`; snapshots ack the last one applied. */
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
  /** Solo only: the server stops the game while paused. Co-op rooms ignore it. */
  | { type: 'pause'; paused: boolean }
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
  | { type: 'welcome'; you: { playerId: number; name: string }; room: { code: string; mapId: string; mapVersion: number; solo: boolean }; map: MapDoc }
  /** The room's members, whenever they change. */
  | { type: 'lobby'; code: string; state: 'lobby' | 'playing'; ownerId: number; players: LobbyPlayer[] }
  /** `seq` is the last input seq the server applied for you: 0 for a new game, more when resuming one. */
  | { type: 'start'; tick: number; seq: number }
  | Snapshot
  /** Everything the sim emitted during one tick. */
  | { type: 'events'; tick: number; events: NetEvent[] }
  /** `round` is rounds survived, as stored on the leaderboard. The room then goes back to the lobby. */
  | { type: 'gameOver'; round: number; players: GameResult[] }
  | { type: 'pong'; t: number }
  | { type: 'error'; message: string };

// ----------------------------------------------------------------- snapshot (20 Hz)

/** The world fields are `WorldView` (view/WorldView.ts), so a snapshot can be rendered as is. Floats are rounded to 2 decimals. */
export interface Snapshot extends WorldView {
  type: 'snapshot';
  tick: number;
  /** Player id (as a string key) → last input seq applied. */
  acks: Record<string, number>;
}

// ----------------------------------------------------------------- events

/**
 * The Java SimEvent (server/sim SimEvent.java), as JSON. `player` is the acting player.
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
