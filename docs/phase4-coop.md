# Phase 4 plan: co-op multiplayer with an authoritative Java server

Read CLAUDE.md first, especially **Netcode**, **Server** and **Backend roadmap**. (Phase 4 is complete; this doc is now a record.) This doc is the plan for the last roadmap phase. Tick off milestones here as they land, and fold the lasting facts into CLAUDE.md at the end.

## Goal
Two to four players defend the same map together. The Java server (`server/sim` inside `server/app`) runs the only simulation. Browsers send input, render server snapshots, predict their own movement, and play effects from server events. Solo play becomes a one-player room on the server. When this phase is done, the TS gameplay sim is deleted, and the server records scores itself, so the leaderboard can't be faked.

## Where things stand (end of Phase 3)
- `client/src/sim/` (TS) and `server/sim` (Java) are identical single-player sims. `SimParityTest` replays a TS reference run (`server/sim/src/test/resources/parity.txt`, seed 42, bot from `GameSimTest.bot`) and requires matching states.
- `GameSim.step(dt, PlayerInput)` advances the world and emits `SimEvent`s. `core/Game.ts` is the browser client: it reads input, steps the TS sim, plays events, and renders by reading sim objects directly (`Player`, `Zombie`, `Barricade`, `Interactable` subclasses, `PowerUps.drops`, `RoundManager`).
- Identity: anonymous bearer tokens (`PlayerAuth`). Scores: `POST /api/scores`, client-submitted. nginx already proxies `/ws` with the Upgrade headers; Vite's dev proxy does too.
- No JDK locally. Gradle runs in Docker (command in CLAUDE.md).

## Decisions (made here; change them before starting if you disagree)
| Topic | Decision |
|---|---|
| Party size | 1–4. Solo is a 1-player room |
| Transport | Raw Spring WebSocket (`TextWebSocketHandler`) at `/ws`, JSON messages with a `type` field. No STOMP. Switch to binary only if measured bandwidth needs it |
| Rates | Sim ticks at 60 Hz. Snapshots go out at 20 Hz. Clients send one input per client tick (60 Hz) |
| Shared vs per player | **Shared:** rounds, zombies, barricades, doors, power-up timers (Instakill and Double Points apply to everyone). **Per player:** points/economy, weapons, perks, armour, kills |
| Mystery box | Whoever pays owns the roll; only they can take the weapon |
| Power-ups | Pickup by anyone. Full Ammo refills everyone. The Detonation bonus is awarded to every living player |
| Downed/revive | Co-op only. At 0 hp a player is **downed**: can't move or shoot, bleeds out in 30 s. A teammate holds E for 3 s nearby to revive at 50% hp. Second Wind still self-revives instantly. A bled-out player is **dead**: they spectate and respawn at the start of the next round with the starter loadout. **Game over when no player is alive** (all downed or dead) |
| Solo | Unchanged: at 0 hp it's Second Wind or game over, with no downed state. This keeps `SimParityTest` valid |
| Difficulty | `zombieCount(r) × (1 + 0.5 × (n − 1))`, and `MAX_ALIVE = 24 + 6 × (n − 1)`. Health unchanged. With n = 1 both are identical to today |
| Spawning players | Ring of offsets (about 28 px) around `playerStart`, then pushed out of walls by collision |
| Joining | Only in the lobby, before start. Reconnecting with the same token within 30 s resumes your player |
| Disconnect | The player idles (`PlayerInput.NONE`). After 30 s they're removed from the sim. An empty room is destroyed |
| Friendly fire | None. Shots pass through teammates |
| Scores | Written by the server at game over, one row per player: round reached − 1, that player's kills and earned points, `party_size` = n. `POST /api/scores` is removed |
| Lag compensation | Not in this phase. Aim assist covers small latency. Revisit if hits feel off |

## Milestones
Each milestone leaves the game playable and the tests green. Do them in order.

### M1: Multiplayer Java sim (solo behaviour unchanged) ✅ done
Change only `server/sim`. **`SimParityTest` must keep passing untouched**; it proves solo play didn't change.

**As built** (details the plan left open):
- `new GameSim(doc, seed)` starts with **no players**; call `addPlayer(id, name)`. Tests use `GameSimTest.solo(map, seed)`. `SimParityTest` changed only in setup and in reading `players.getFirst()`; `parity.txt` is untouched and still matches. There is no `player` alias.
- `GameSimTest.bot(s, p)` takes the player (`bot(s)` is the solo shorthand, still identical to the TS bot).
- Downed: perks are kept while downed. Bleed-out **pauses while someone is reviving**, and the progress resets when they let go. Two revivers don't stack. Revived at `maxHp × 0.5`, with regen delayed as if just hit. Zombies ignore downed players and don't push them. A downed player can't move, shoot, switch or interact, but their aim still follows input.
- Death → respawn at the next `RoundStart` on the spawn ring with the starter loadout (weapons, perks and armour reset; points and kills kept).
- Detonation: the kills (not points) go to the picker, and the bonus goes to every player who isn't dead (downed players included). `GameSim.kills` is still the team total; `Player.kills` is per player.
- `removePlayer` can end the game (if everyone left is down).
- `MysteryBox.owner` is -1 when closed. Non-owners don't get the prompt (`usable(sim, p)`).
- Interactables are `usable(sim, p)` / `use(sim, p)`. Constants: `Player.BLEEDOUT`, `REVIVE_TIME`, `REVIVE_RANGE`, `REVIVE_HP_FRACTION`; `RoundManager.zombieCount(r, n)` / `maxAlive(n)`.
- Events: `player` is the **first** field where present. `Explosion`, `DoorOpened`, `BoxReveal`, `PlankTorn`, round and box events have none. Jackson adds `"type"` only when the declared type is `SimEvent` (for example a `List<SimEvent>` field in the message record), not for a bare `List.of(...)`.
- `CoopSimTest` covers the list below, plus spawn positions, Second Wind before going down, leaving ending the game, and JSON names. The 2-bot run averaged 19 rounds over seeds 1–5 against 15 for solo.

- `GameSim`:
  - `players: List<Player>`, keyed by an int `id`.
  - `addPlayer(id, name)`, used before start and for respawns; `removePlayer(id)`.
  - `step(double dt, Map<Integer, PlayerInput> inputs)`. Keep a `step(dt, PlayerInput)` overload for solo and tests that targets the only player.
  - Keep the `player` field as a deprecated alias for `players.get(0)` only if that makes the migration easier, then remove it.
- `Player` gains:
  - `id`, `name`, `kills`;
  - its own `Economy` (move `economy` off `GameSim`);
  - `state` `ALIVE | DOWNED | DEAD`, `bleedout`, `reviveProgress`.
- **Everything that reads `sim.player` takes the acting player instead.** That's interactables, `pay()`, `fire`/`traceShot`/`knife`/`hitZombie`/`killZombie` (points go to the shooter), `giveWeapon`, `rebuildPlank`, and `damagePlayer(Player, amount)`.
- `Zombie` targets the nearest living, non-downed player, both for direct chase and for the attack. If none qualify, it idles.
- `FlowField`: multi-source BFS seeded from every alive player's tile (`update(List<Point>)`), recomputed when any source tile changes.
- **Downed/revive** as in the decisions table, co-op only (`players.size() > 1`):
  - New `Interaction.Revive(Player target)`, chosen when within reach of a downed teammate. It beats rebuild and use.
  - `Second Wind` is checked before going down.
  - Dead players respawn at round start.
- `MysteryBox.owner` (player id).
- `PowerUps.update` checks every alive player for pickup.
- `RoundManager`: party-size scaling from the decisions table.
- `separate()` pushes zombies off every player; players don't collide with each other.
- **Events gain an acting `player` id** wherever it matters (`Shot`, `Tracer`, `Knife`, `Reload`, `PlayerHurt`, `Denied`, `WeaponGiven`, `AmmoBought`, `PerkBought`, `ArmourBought`, `Upgraded`, `PlankPlaced`, `ZombieHit`/`ZombieKilled` points recipient, `PowerUp` picker).
  - New: `PlayerDowned`, `PlayerRevived`, `PlayerDied`, `PlayerRespawned`, `ReviveProgress` (optional; or put progress in snapshots only).
  - Add Jackson annotations so events serialize as `{"type":"zombieHit", ...}`, with the same names as `client/src/sim/events.ts`: `@JsonTypeInfo(use = NAME, property = "type")` plus `@JsonTypeName` on each record.
- **Tests** in `GameSimTest`, or a new `CoopSimTest`:
  - two players have separate points and weapons;
  - a zombie chases the nearer player;
  - the flow field reaches the farther player through a door;
  - down → teammate revive;
  - down → bleed out → dead → respawn next round;
  - all downed = game over;
  - only the box owner can take the weapon;
  - nuke points go to all;
  - party-size scaling of the zombie count;
  - a 2-bot co-op run survives at least as long as a solo bot.

The TS sim is not changed in M1, so the parity file stays valid.

### M2: Rooms, protocol and server-side scores ✅ done
Changes in `server/app` (new package `com.boardedup.game`):

**As built** (details the plan left open):
- Rooms see sockets through the `Connection` interface (`send(ServerMessage)`, `close()`). Tests use `FakeConnection`; `GameSocketHandler.SocketConnection` serializes with `writerFor(ServerMessage.class)` so `type` is written.
- **Locking:** every `GameRoom` membership method and `tick()` are `synchronized` on the room; only `input()` is lock-free. `LobbyService` synchronizes create/join; rooms call back through `GameRoom.Listener`, which only touches concurrent maps, so the two locks are never taken in opposite order.
- **Ticking:** `RoomTicker` (a shared `ScheduledExecutorService`, fixed rate per room) implements `LobbyService.Ticker`. Tests construct rooms directly and call `tick()`; grace periods use an injected `InstantSource`. A sim exception is logged, sends `error` "The game crashed" and returns the room to the lobby rather than killing its task.
- **Lifecycle:** after `gameOver` the room goes back to the **lobby** with everyone unready; the owner (or the solo player) sends `start` again. The owner is the first member; if they leave, the next one takes over. `start` needs every *other* member ready. Leaving mid-game removes you from the sim with no score. A second socket for the same account replaces the first (the old one is closed). Grace also applies in the lobby.
- **Input:** one per tick; when the queue holds more than 6, the oldest are dropped with their presses (`firePressed`, `reload`, `knife`, `interactPressed`, `swap`, `selectSlot`) merged into the next. An idle tick repeats the last input without its presses. Inputs are sanitized (`ClientInput.toPlayerInput`: NaN aim, out-of-range slots). More than 120 queued inputs are ignored. **Seqs restart at 1 each game** (`lastSeq` resets on start).
- Extra message fields: `lobby` has `state` (`"lobby"`/`"playing"`). Reconnecting sends `welcome`, `lobby`, then `start` if a game is running. Every tick with events sends one `events` message; snapshots go out on ticks divisible by 3 and on the game-over tick.
- `gameOver.round` is rounds survived (round reached − 1), as stored. `rank` is the **0-based** leaderboard position (`ScoreRepository.countAhead`), -1 if saving failed. `ScoreService` implements `ScoreRecorder`.
- Snapshot `powerUps.drops[].id` is the power-up kind (drops have no entity id). `interactables` are in GameSim order: wall buys, perks, armour, upgrade, box, doors.
- **Measured:** at full load (4 players, 42 zombies) a snapshot averages ~4.1 KB, max ~5 KB, so up to ~100 KB/s per client (`SnapshotBuilderTest`). `LoadTrialIT` (`LOAD_TRIAL=1`, 10 rooms × 4 bots for 20 s, 10 CPUs) kept every bot at 20.0 snapshots/s with no missed snapshots.
- Latency: `boarded-up.debug.latency-ms` (env `DEBUG_LATENCY_MS`) delays inbound and outbound messages on one thread, so order is kept.
- nginx now forwards `Host $http_host` (with the port) for `/ws` and `/api/`; without it, Spring's same-origin check saw `server:8080` and would refuse browser handshakes.
- The client isn't wired up yet: `client/src/net/protocol.ts` is the TS mirror, unused until M4. `submitScore` now gets a 405 and the leaderboard falls back to local scores, as it does when offline.

- **`WebSocketConfig`** registers the handler at `/ws`. A handshake interceptor reads `?token=` and resolves the player via `PlayerAuth`; unknown tokens are rejected. The configured CORS origins apply.
- **`GameSocketHandler`**:
  - Parses client messages and routes them to `LobbyService` / `GameRoom`.
  - Wraps each session in `ConcurrentWebSocketSessionDecorator` (send time and buffer limits), so a slow client can't block a room.
- **`LobbyService`**:
  - Holds a map of rooms by 4-letter code (no ambiguous letters).
  - `create(mapId, owner)`, `join(code, player)` (max 4, lobby only), `leave`.
  - Solo: create and start immediately.
- **`GameRoom`**:
  - Holds the `GameSim` (map from `MapService`, random seed), the members (player id ↔ session, name, ready), and a lobby/playing/over state.
  - Ticks at 60 Hz on a shared `ScheduledExecutorService` with a fixed-rate task per room, so each room is single-threaded and the sim needs no locks.
  - **Input:** a per-player `ConcurrentLinkedQueue<ClientInput>`. Each tick takes one input per player. If the queue is empty, it reuses the last input with the pressed flags cleared. If the queue backs up past about 6 inputs, it drops the oldest and **merges their pressed flags** so presses aren't lost. It records `lastProcessedSeq` per player.
  - **Output:** every tick with events, send `events` (batched; one message per tick at most). Every 3rd tick, send a `snapshot`. On game over, send `gameOver` and write scores (below).
  - **Lifecycle:** a disconnect starts the 30 s grace period; reconnecting with the same token rebinds the session; an empty room stops its task and is removed.
  - `Clock` injection, so tests can step rooms manually instead of waiting on real time.
- **Protocol records** in `com.boardedup.game.protocol`. TypeScript mirrors go in `client/src/net/protocol.ts`; keep the two in sync and the field names identical.
  - **Client → server:**
    - `{type:"create", mapId, solo}`
    - `{type:"join", code}`
    - `{type:"ready", ready}`
    - `{type:"start"}` (owner only)
    - `{type:"input", inputs:[{seq, ...PlayerInput}]}` (usually one input; allow batches)
    - `{type:"leave"}`
    - `{type:"ping", t}`
  - **Server → client:**
    - `{type:"welcome", you:{playerId(sim id), name}, room:{code, mapId, mapVersion}, map:<MapDoc>}`
    - `{type:"lobby", code, ownerId, players:[{id, name, ready, connected}]}`
    - `{type:"start", tick}`
    - `{type:"snapshot", ...}` (fields below)
    - `{type:"events", tick, events:[...]}`
    - `{type:"gameOver", round, players:[{id, name, kills, points, rank}]}`, where `rank` is the leaderboard position, or -1
    - `{type:"pong", t}`
    - `{type:"error", message}`
  - **Snapshot fields** (built by `SnapshotBuilder` from `GameSim`; round floats to 2 decimals to keep it small):
    - `tick`, `acks:{playerId: lastSeq}`
    - `round:{n, active, remaining, intermission}`
    - `powerUps:{instakill, double, drops:[{id, x, y, life}]}`
    - `players:[{id, name, x, y, aim, hp, maxHp, state, bleedout, reviveProgress, armour, armourLevel, points, kills, slot, weapons:[{id, tier, mag, reserve, reloadProgress} | null], perks:[...], invuln, interaction}]`
      - `interaction` is `{kind:"rebuild", window} | {kind:"use", target} | {kind:"revive", player} | null`, where `window` and `target` are indexes into the map's windows and interactables.
    - `zombies:[{id, x, y, facing, state, runner}]`
    - `windows:[planks]` (array of plank counts, in map order)
    - `interactables:[{open?}|{state, shown, timer, owner}|{}]` (in map order: doors carry `open`, the box carries its state, others are empty)
  - Expect roughly 2–4 KB per snapshot at full load, so about 80 KB/s per client at 20 Hz. Fine for now. Measure it in a test and log it.
- **Scores:** on game over the room writes `scores` rows via `ScoreRepository` (`party_size` = number of players who started). Then remove `POST /api/scores`, `ScoreRateLimiter` and their tests. Keep the `GET` endpoints.
- **Dev-only latency:** a `boarded-up.debug.latency-ms` setting (default 0) delays outbound messages, and inbound ones by the same amount, for testing prediction.
- **Tests:**
  - `GameRoomTest` with a manual clock: input queueing, merged presses, ack tracking, snapshot cadence, grace and reconnect, empty-room cleanup, scores written at game over.
  - `LobbyServiceTest`: codes, full room, join after start rejected, owner-only start.
  - `GameSocketIT`: Spring Boot plus Testcontainers. Two `StandardWebSocketClient` sessions create and join a room, start it, send inputs, receive snapshots and events, then one disconnects.
  - A simple **Java bot client** (test helper) that plays from snapshots, used for the IT and for load-trying 10 rooms × 4 bots.

### M3: Client reads a world view instead of sim objects ✅ done
Change only the client, so rendering stops depending on sim classes. The TS sim stays as the data source for now, and the game must play exactly as before.

**As built** (details the plan left open):
- `view/WorldView.ts` is the snapshot's world, field for field, and `net/protocol.ts` `Snapshot` is now `WorldView` plus `type`, `tick` and `acks`, so M4 can render a snapshot (or an interpolated copy) directly. `WindowView` is just the plank count.
- The static half is `view/Level.ts`: `buildLevel(doc)` → `{ data: MapData, windows: WindowFixture[], fixtures: Fixture[] }`. A `Fixture` is a discriminated union by `kind` with its stand point (`x`, `y`, equal to the sims' `standX`/`standY`; the smoke run checks this). `WorldView.windows`/`interactables` index `level.windows`/`level.fixtures`.
- `Game` holds `level`, `world` (rebuilt by `localView(sim, name)` after each `step`, before events are played), `you` (`LOCAL_PLAYER_ID` = 1), `me` (getter) and `result` (`{round, kills, points}` for the game-over screen). Only `Game` and `localView` import sim classes now.
- Weapon formulas moved to `defs.ts` (`weaponName`, `magSize`, `reserveSize`, `ammoCost`; the TS `Weapon` uses them), along with `PLAYER_RADIUS`, `ZOMBIE_RADIUS`, `BLEEDOUT`, `REVIVE_TIME` (mirrors of the Java constants). `parity.txt` re-records byte-identical.
- Drawing: `drawPlayer(ctx, p, fx, local)` skips dead players and draws downed ones lying down. `drawPlayerOverlay` runs after lighting: teammates' name tags and the bleed-out ring, with revive progress inside it. Teammates' colours are `TEAM_BODIES[id % 3]` (`render/visuals.ts`), and the local player is drawn last. Lighting gives every alive player a glow, a cone and a muzzle light; downed players get a dimmer glow and no cone.
- `PlayerFx` is `Map<playerId, PlayerFx>` (`game.playerFxOf(id)`). The TS events have no `player` field yet, so `onEvent` applies them to `you`; M4 switches on `e.player`.
- Prompts already handle `revive` ("Hold E to revive <name>") and hide the box's take prompt from non-owners.
- Verified with `npm run build`, `npm run parity` (no diff), and a headless smoke run of both maps: a bot aiming at zombies (view checked against the sim every tick), every event type, every prompt, and a fake co-op world with teammates alive, downed (being revived) and dead, a box owned by someone else, and the local player downed. Not yet checked in a real browser.

- **Define `client/src/view/WorldView.ts`:** plain interfaces shaped like the snapshot (`PlayerView`, `ZombieView`, `WindowView`, `InteractableView`, `DropView`, `RoundView`), plus static map data (`MapData` from `sim/MapData.ts`: windows, wall spots, doors, box, tiles).
- **Point the readers at the views:** `render/draw.ts`, `render/lighting.ts`, `ui/HUD.ts`, `ui/prompts.ts` and `ui/Screens.ts` take views instead of `GameSim`/`Player`/`Zombie`/`Interactable`.
  - The prompt and interactable drawing switch on view kinds plus the static map defs.
  - Weapon names come from `defs.ts` (`WEAPONS[id].name + UPGRADE.suffix[tier]`); `magSize` is computed from defs too.
- **`view/localView.ts`** builds a `WorldView` from the TS `GameSim` each frame. That's the temporary adapter, deleted in M5.
- **Draw every player:** each player gets their own flashlight cone and glow (`lighting.ts`). Remote players use a different body colour, a name tag, and a downed pose (lying, red ring with the bleed-out arc). `PlayerFx` becomes per-player (`Map<playerId, PlayerFx>`).
- **Verify:** `npm run build`, the headless client smoke run (see CLAUDE.md), and a manual play-through. Gameplay is untouched, so the parity test still passes.

### M4: Networked client ✅ done
**As built** (details the plan left open):
- Every game goes through the server, solo included (a solo room starts on `create`). `core/Game.ts` no longer imports the TS sim; `localView` is unused and goes in M5. Behind the menus, and until the first snapshot, the world is `restingWorld(level)` (one player on the start tile, full planks, doors shut).
- `Link` (interface) / `Connection`: messages go to an inbox that `Game.pollNet()` drains at the start of each tick. Lobby commands sent while connecting are queued; inputs and pings aren't. A handshake that never opens makes the next attempt re-check the token (`ensureRegistered(true)`; `setName` re-registers on a 401). A generation counter stops a late attempt from opening a second socket after `close()`. Leaving a room closes the socket.
- Inputs are only sent (and predicted) while the socket is open. Seqs restart on `start` with tick 0; a `start` with tick > 0 while already playing is a resume (pending inputs and the snapshot buffer are dropped, seqs carry on).
- Interpolation runs on the server's tick clock: `offset ≈ tick/60 − localTime`, smoothed (5% per snapshot), reset when a sample is 0.5 s off. Remote players and zombies come from the later of the two bracketing snapshots, position and angle lerped from the earlier; round, power-ups, windows, interactables and the local player's stats come from the newest.
- After a reconnect, if no `welcome` arrives within 3 s the seat is gone (grace expired) and the client returns to the title. A `lobby` with `state: "lobby"` while still playing (the game crashed, or ended while we were away) goes back to the lobby page, or the title for solo. Events more than 30 ticks older than the newest in a drained batch (a hidden tab) play no effects.
- Effects: purchases, "Not enough points", points text, hit sounds, hurt shake and reload sound are only for `e.player === you`. Muzzle flash and knife swing play for whoever acted; their shots, knife, plank and revive sounds fade with distance (`volumeAt`, from the spectated player when dead). Power-ups are a callout for everyone. Teammate events (`playerDowned`/`Revived`/`Died`/`Respawned`, Second Wind, server errors mid-game) go to a small `feed` under the power-up timers. The muzzle flash still waits for the server's `shot`.
- HUD: room code under the round status (co-op), teammates panel top right (body colour, name, points, hp bar or DOWN/DEAD, AWAY from the lobby's `connected`), REVIVING bar (in the reload bar's place), "YOU ARE DOWN" with the bleed-out (or being-revived) bar, "SPECTATING <name>" while dead (the camera follows the first teammate still up), blinking "RECONNECTING…".
- Game over: "YOU DIED" (solo) or "OVERRUN" (co-op), rounds survived, everyone's kills and points, your rank (NEW RECORD / #n). Enter: solo sends `start` in the same room; co-op returns to the lobby page. Esc leaves.
- `Leaderboard` only shows server tables (no localStorage scores; `record` and `submitScore` are gone). The table marks co-op rows `(nP)`.
- `PLAYER_SPEED`, `BASE_HP` and `MAX_PLANKS` joined the Java-constant mirrors in `defs.ts`. `sound.shot/knife/plankPlace/revive` take a volume.
- **Verified:** `npm run build`. Headless runs of the real client (`Game` + `Connection` + `NetGame`, canvas stubbed, bot input) against `docker compose up`: solo to game over (≈20 snapshots/s, max correction 7 px, the score saved and ranked); a two-process co-op game (separate points, one shared world) where the guest dropped its socket mid-game and resumed (second `welcome`, `start` at tick 1336); solo with `DEBUG_LATENCY_MS=100` (RTT ≈ 205 ms, max correction 1.2 px, prediction ~25 px ahead of the server). A fake-`Link` run covered the guest lobby page, prediction, downed (server position, callout), teammate death feed, spectating, the lost-seat timeout and solo game over → play again. **Not yet checked in a real browser** (no browser tools in that session): the two-tab test, Chrome throttling and how prediction feels by hand are still to do.

- **`net/Connection.ts`:**
  - WebSocket to `${location.origin.replace('http', 'ws')}/ws?token=…`. Use `BASE_URL`, and register first via `net/api.ts` if there's no token.
  - JSON parse, typed message dispatch, ping every 2 s, RTT smoothing, reconnect with backoff (resumes within the 30 s grace).
- **`net/NetGame.ts`** (the network counterpart of the local adapter):
  - **Snapshot buffer.** Render remote players and zombies **interpolated 100 ms behind** the newest snapshot, by id: lerp positions and lerp angles by shortest arc. Entities that appear or disappear pop in and out (spawn and death have effects anyway).
  - **Local player prediction.** Each tick, build the `PlayerInput` (existing `Game.readInput`), give it a `seq`, send it, apply movement locally with `net/PlayerMotion.ts`, and keep it in a pending list.
    - `PlayerMotion.ts` is the movement half of `sim/Player.ts`: speed, normalisation, `TileMap.collideCircle` with floor-only solids. Keep `TileMap.ts`, `math.ts`, `MapData.ts` and `defs.ts`.
    - On each snapshot, drop the inputs with `seq <= ack`, reset to the server position, and replay the remaining inputs.
    - Smooth any visible correction over about 100 ms instead of snapping. Snap if the error is over 64 px.
    - Doors opening must update the local `TileMap` (`interactables[i].open`).
    - Aim is always local (instant).
  - **Events → effects** with the existing `Game.onEvent`. Only the local player gets the "Not enough points" text, purchase texts, hurt flash and screen shake. Other players' shots and sounds are positional via `volumeAt`.
    - Phase-1 simplicity: muzzle flash and shot sound wait for the server `shot` event (one RTT late). If that feels laggy, predict the flash and sound locally and skip the server's echo for your own `player` id.
  - **Fetching the map:** use the `welcome` map doc, so no separate fetch is needed.
- **Menus** (`ui/Menu.ts`):
  - **New Game** → map select → **Play Solo** / **Host Co-op**.
  - A **Join Game** page with a 4-letter code text field (reuse the name page's text field).
  - A **Lobby** page: room code shown big, player list with ready ticks, Ready toggle, Start (host only, enabled when everyone's ready), Leave.
  - Pause in online play is just a menu overlay; the world keeps running. Show "Reconnecting…" while the socket is down.
- **HUD:**
  - teammates panel (name, hp bar, downed/dead, points);
  - revive prompt and progress bar;
  - "You are down" bleed-out timer;
  - spectating label when dead;
  - room code in a corner.
- **Game over** comes from the `gameOver` message: a per-player table, your rank from the server, then Enter to return to the lobby (co-op) or play again (solo). `Leaderboard.record` and `submitScore` go away; `Leaderboard` just shows server tables.
- **Verify:**
  - headless client smoke run with a fake `Connection` that feeds recorded snapshots and events;
  - two browser tabs against `docker compose up` (shared zombies, separate points, revive, close one tab mid-round);
  - Chrome network throttling plus `debug.latency-ms=100`;
  - solo still plays like before.

### M5: Retire the TS sim and finish ✅ done
**As built:**
- Deleted the TS gameplay sim (`GameSim`, `Player`, `Zombie`, `RoundManager`, `Pathfinding`, `aimAssist`, `Economy`, `PowerUps`, `Interactables`, `Weapon`, `Barricade`, `Rng`, `events`), `view/localView.ts`, `client/scripts/parity.ts`, the `parity` npm script and the `vite-node` dev dependency. `sim/Player.ts` went too: `net/PlayerMotion.ts` already covers prediction.
- What remained moved from `client/src/sim/` to `client/src/game/` (`defs.ts`, `input.ts`, `MapData.ts`, `TileMap.ts`). `defs.ts` lost the exports only the sim used (`BOX_POOL`, `PERK_EFFECTS`, `STARTING_POINTS`, `REBUILD_CAP`, `POINTS`, `ARMOUR_ABSORB`, `POWERUP_IDS`, `POWERUP_TUNING`).
- `parity.txt` is frozen (header now says it was recorded from the TS sim). `SimParityTest` regenerates it from Java when `REGENERATE_PARITY` is set; checked that this reproduces the current file exactly. Java comments that said "port of client/src/sim/…" now describe the class or point at `client/src/game/`.
- `POST /api/scores` was already gone (M2).
- CLAUDE.md: **Two sims** replaced by **Netcode**; architecture tables, conventions, testing notes, history (11) and roadmap updated.
- **Verified:** `npm run build`; all Java tests (`./gradlew test`, including `SimParityTest`); `docker compose up -d --build`, then a two-client co-op game (Node WebSockets) through nginx on `:8551`: lobby, join, ready, start, 20 snapshots/s to each client, overrun, and both scores in `GET /api/scores?map=house` with `partySize: 2`. **Still not checked in a real browser:** the two-tab game.

- **Delete the TS gameplay sim:**
  - `client/src/sim/GameSim.ts`, `Zombie.ts`, `RoundManager.ts`, `Pathfinding.ts`, `aimAssist.ts`, `Economy.ts`, `PowerUps.ts`, `Interactables.ts`, `Weapon.ts` (if the HUD no longer needs it), `Barricade.ts`, `Rng.ts`, `events.ts` (replaced by `net/protocol.ts`);
  - the `localView` adapter;
  - `client/scripts/parity.ts`, the `parity` npm script, and the `vite-node` dev dependency if nothing else uses it.
- **Keep:** `TileMap.ts`, `MapData.ts`, `defs.ts`, `input.ts`, `core/math.ts`. Rename `sim/` to `shared/` or `game/` if what remains reads better there.
- **Freeze `parity.txt`** as a Java-only regression baseline. Update the `SimParityTest` javadoc: it no longer compares against TS; regenerate it from Java deliberately when gameplay changes on purpose.
- **Remove `POST /api/scores`** if M2 didn't already.
- **CLAUDE.md:**
  - Replace **Two sims** with a **Netcode** section: protocol, rates, prediction and interpolation, where gameplay changes go (Java only now).
  - Update the architecture tables, testing notes and history (11. Phase 4), and mark roadmap item 4 done.
- **Check the full stack:** `docker compose up -d --build`, a two-tab co-op game through nginx on `:8551` (WebSocket through the `/ws` proxy), and scores appearing on the High Scores page with `party_size`.

## Risks and how to handle them
- **Refactoring the sim to N players breaks solo.** `SimParityTest` must pass at every M1 step. Commit in small steps.
- **Prediction mismatch.** The server also pushes the player out of zombies (`separate()`), which the client doesn't predict. Expect small corrections when touching zombies, hidden by the 100 ms smoothing. If it jitters, predict only walls and accept server pushes.
- **Event/snapshot ordering.** Events for tick T can arrive before the snapshot containing T. Effects use event positions, so this is fine, but don't look up entities from a stale snapshot for anything except cosmetics (hit flash by zombie id is fine).
- **Slow clients.** The session decorator limits stop one socket from stalling a room. On overflow, close that session (the player goes into grace).
- **Thread safety.** Only the room's tick thread touches its `GameSim`. Socket threads only enqueue inputs and lobby commands (lobby changes also go through the room's queue or a lock).
- **The scope is large.** M3 can ship on its own. M4 is the biggest; get solo-over-network working end to end before adding the lobby and revive UI.
