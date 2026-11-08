# Boarded Up — top-down zombie survival shooter

Browser game: the player defends a boarded-up house against rounds of zombies. Zombies tear planks off windows and climb in. The player earns points for hits, kills and rebuilding planks, then spends them on doors, wall weapons, perks, armour, weapon upgrades and the mystery box. Zombies get tougher every round. Two maps: **The House** (four rooms, everything powered from the start) and **The Farmstead** (a farmhouse and a barn joined by a covered walkway; the box, perks and upgrade bench are dead and the buildings dark until someone throws the power switch in the barn's generator room).

**Stack:**
- **Client (`client/`):** vanilla Canvas 2D + TypeScript + Vite. No game framework and no runtime dependencies. All art is procedural (drawn in code). All sound effects are synthesized with WebAudio. The only assets are the soundtrack mp3s.
- **Server (`server/`):** Java 25 + Spring Boot 4 (Gradle Kotlin DSL) + PostgreSQL, with Flyway migrations.
- **The server is authoritative.** The game simulation is `server/sim` (Java). Every game, solo included, runs in a server room; browsers send input over `/ws` and render snapshots. See **Netcode** below.
- **Gameplay tuning** lives in `shared/defs/*.json`. The Java sim plays by it; the client reads it for names, prices, ammo counts and drawing.

The backend roadmap (all four phases done) is in **Backend roadmap** below.

## Commands

```bash
cd client && npm run dev       # Vite dev server; proxies /api and /ws to localhost:8080
cd client && npm run build     # tsc --noEmit + vite build → dist/  (use this as the type-check)
docker compose up -d --build   # db + server + web (nginx) on http://localhost:8551 (Gradle/npm caches persist; see Assets)
```

No JDK is installed on the dev machine, so Gradle runs in Docker (the `gradle-cache` volume keeps dependencies between runs; the socket mount is for Testcontainers):
```bash
# from the repo root: the server build reads ../maps and ../shared, so mount the whole repo
docker run --rm -v "$PWD":/w -w /w/server -v gradle-cache:/home/gradle/.gradle \
  -v /var/run/docker.sock:/var/run/docker.sock -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  gradle:9-jdk25 ./gradlew test --no-daemon
```
With a local JDK 25: `./gradlew test`, and `./gradlew :app:bootRun` (needs Postgres on localhost:5432, db/user/password `boardedup`; for example `docker compose up -d db` with a port mapping added).

The client has no test suite or linter. `npm run build` must pass with zero type errors. `tsconfig` is strict, with `noUnusedLocals` and `noUnusedParameters`; prefix intentionally unused params with `_`.

## Netcode
- **Gameplay changes go in Java only** (`server/sim`, package `com.boardedup.sim`): `GameSim`, `Player`, `Zombie`, `Interactable`, `RoundManager`, `FlowField`, ... It's plain Java (no Spring) and depends only on Jackson to read `shared/defs` and maps. `server/app` depends on it; it also owns `MapDoc` and `MapValidator`. One room's tick thread is the only thing that touches its `GameSim`.
- **Protocol:** JSON over `/ws?token=…`. Records in `server/app/.../game/protocol` (`ClientMessage`, `ServerMessage`), mirrored by `client/src/net/protocol.ts`; keep field names identical. Client → server: `create`/`join`/`ready`/`start`/`leave` (lobby), `input` (a batch of `PlayerInput`s with seqs), `pause` (solo only: the room stops stepping the sim), `ping`. Server → client: `welcome` (your id, the room and the map document), `lobby`, `start {tick, seq}` (`seq` = last input applied for you, so a resumed client numbers on from it), `snapshot` (includes `power`), `events` (includes `powerOn`), `gameOver`, `pong`, `error`. The sim's `SimEvent`s go out as JSON (`NetEvent` in `protocol.ts`), each carrying the acting `player`.
- **Rates:** `GameRoom` steps at 60 Hz (`TICK_HZ`) and sends a snapshot every 3rd tick (20 Hz, `SNAPSHOT_EVERY`), plus an `events` message on any tick that emitted some. A dropped socket keeps its seat for 30 s (`GRACE`). Sockets never block the tick: each connection queues its messages and sends them from its own virtual thread (dropped past 512 KB queued or a send stuck 5 s). At game over, scores are saved off the tick thread; the sim freezes until they're saved (at most `SCORE_WAIT`, 3 s, after which ranks show as -1).
- **Snapshots** are `WorldView` (`client/src/view/WorldView.ts`) plus `type`/`tick`/`acks` (last input seq applied per player). `SnapshotBuilder` writes them; `SnapshotBuilderTest` pins the shape.
- **Client prediction:** the local player moves at once with `net/PlayerMotion.ts`, a copy of the movement half of Java `Player.update` (speed, normalisation, collision against non-floor tiles). On each snapshot `NetGame` drops acked inputs, resets to the server position and replays the rest; the correction decays over ~100 ms (snap past 64 px). Aim is local. Server-only effects (pushes from zombies) come back as small corrections. **If you change player movement in Java, change `PlayerMotion.ts` and the mirrored constants in `game/defs.ts` (`PLAYER_SPEED`, `PLAYER_RADIUS`) too.**
- **Interpolation:** remote players and zombies are drawn 100 ms behind (`INTERP_DELAY`) on the server's tick clock (smoothed offset); entities pop in and out.
- **Client-side game data** (`client/src/game/`): `defs.ts` (typed `shared/defs` plus mirrors of Java code constants: `PLAYER_RADIUS`, `PLAYER_SPEED`, `BASE_HP`, `MAX_PLANKS`, `ZOMBIE_RADIUS`, `BLEEDOUT`, `REVIVE_TIME`), `input.ts` (`PlayerInput`), `MapData.ts`, `TileMap.ts`. Keep those mirrors in step with Java.
- **`SimParityTest` is a frozen Java regression baseline.** `server/sim/src/test/resources/parity.txt` was recorded from the old TS sim (which the Java sim matched exactly); the house lines are still that recording, the farmstead lines were generated from Java when the map was added. The test replays `GameSimTest.bot` for 2 minutes per map with seed 42 and requires identical states to 6 decimals, naming the first state that drifted. When gameplay changes on purpose, regenerate it from Java with `REGENERATE_PARITY=1` (add `-e REGENERATE_PARITY=1` to the Docker command, `--tests '*SimParityTest'`) and review the diff. `RngTest` pins the mulberry32 sequence.
- **Power:** `GameSim.power` starts on unless the map has a `power` switch (`Interactable.PowerSwitch`, free, any player, stays on). `Interactable.needsPower()` (box, perk machines, upgrade bench) makes `Player` ignore E on them while it's off; they still prompt ("needs power"). The client draws unpowered machines dim and without glow. The room lights are client-only: `buildLevel` flood-fills the pristine map into `Level.lights` (rooms plus their walls, lamps on a ~6-tile grid), `Lighting` draws them once per level into a mask cut out of the darkness, and `Game.roomLight()` flickers them on after a `powerOn` event. Maps without a switch have no lights.
- **Cosmetic state stays in the client:** muzzle flash, hurt flash, knife swing (`PlayerFx`, per player id), and per-zombie hit flash and arm wobble (`ZombieFx`, keyed by zombie `id`), all in `core/Game.ts`. Plank tilt is a hash in `draw.ts`. Visual tables (tracer colours, barrel lengths, shake, perk and power-up colours, machine glows) are in `render/visuals.ts`. Prompt text is in `ui/prompts.ts`. None of these are in the Java sim.

## Server (server/app, package `com.boardedup`)

| Path | Role |
|---|---|
| `player/` | `Player` entity, `PlayerAuth` (issues 32-byte anonymous bearer tokens, stores only their SHA-256, resolves `Authorization: Bearer`), `PlayerController`: `POST /api/players {name}`, `PATCH /api/players/me` |
| `score/` | `Score` entity, `ScoreController`: `GET /api/scores?map=&limit=` (ordered by round, kills, points). `ScoreService` (a `game.ScoreRecorder`) is the only writer: rooms record one row per player at game over. There is no `POST` |
| `game/` | Co-op over `/ws` (Phase 4 M2). `WebSocketConfig` + `TokenHandshakeInterceptor` (`?token=`, 401 if unknown), `GameSocketHandler` (parses `protocol.ClientMessage`, wraps sessions in `ConcurrentWebSocketSessionDecorator`, optional debug latency), `LobbyService` (rooms by 4-letter code, account → room), `GameRoom` (members, lobby/playing, the `GameSim`, 60 Hz `tick()`, input queues, 30 s grace), `RoomTicker`, `SnapshotBuilder`. Protocol records are in `game/protocol`, mirrored by `client/src/net/protocol.ts` |
| `map/` | `MapService`, `MapSeeder`, `MapController`: `GET /api/maps`, `GET /api/maps/{id}` (the document), `PUT /api/maps/{id}` (needs `X-Admin-Token` = `ADMIN_TOKEN`; disabled when unset). Saves only bump `version` when the document actually changes |
| `web/WebConfig.java` | CORS for the dev origin (`CORS_ORIGINS`) |
| `resources/db/migration/` | Flyway SQL. Hibernate runs with `ddl-auto: validate`, so schema changes need a new `V<n>__*.sql` |
| `src/test/` | `ApiIntegrationTest`, `MapApiTest`, `GameSocketIT` (real sockets with `BotClient`): Spring Boot + Testcontainers Postgres. `GameRoomTest`, `LobbyServiceTest`, `SnapshotBuilderTest`: plain unit tests with `FakeConnection` and a manual clock. `LoadTrialIT` runs only with `LOAD_TRIAL=1` |
| `server/sim/src/test/` | `GameSimTest` (the feature checks: doors, perks, Tough Hide, Second Wind, armour, upgrades, box, power switch, power-ups, plasma splash, knife, rebuild cap, determinism, bot survival), `CoopSimTest` (multi-player: separate economies, targeting, multi-source flow field, downed/revive/bleed-out/respawn, box owner, shared power-ups, party scaling, event JSON), `SimParityTest`, `RngTest`, `MapValidatorTest` |

Config comes from env vars: `DB_URL`, `DB_USER`, `DB_PASSWORD`, `CORS_ORIGINS`, `ADMIN_TOKEN`, and the dev-only `DEBUG_LATENCY_MS` (delays `/ws` messages each way).

### Maps (`maps/*.json`)
- Each file is a map document named `<id>.json` (`MapDoc` in `server/sim/.../map/`, mirrored by `client/src/game/MapData.ts`). Tile rows are strings: `.` outside, `_` floor, `#` wall, `W` window, `C` crate, `D` door. `power` (a wall spot, like `armour`) is optional; with it the map plays with the power mechanic. Players only walk on floor, so separate buildings must be joined by a walled, floored corridor (the farmstead's walkway, which has its own windows and room). Rooms aren't painted on tiles; `MapValidator` flood-fills floor and names each area from the windows, doors and `playerStart` that touch it, so those names have to agree.
- Gradle copies `maps/` onto the classpath and `MapSeeder` upserts them at startup. **The files win**: editing a file replaces the DB copy, even one changed through `PUT`. An invalid file stops the server from starting, with the problems listed. `MapValidatorTest.repoMapsAreValid` catches that earlier.
- Maps uploaded only through `PUT` live just in the DB. Deleting a file doesn't delete the seeded row: add a migration for that (`V3__drop_cabin_map.sql` removed the old cabin map).
- `maps/farmstead.json` was generated by a throwaway script; edit the JSON directly now.
- The validator checks weapon and perk ids against `shared/defs`.
- Both compose images are built from the repo root (`server/Dockerfile`, `client/Dockerfile`, each with a `Dockerfile.dockerignore` beside it) so they can include `maps/` and `shared/`. In compose, nginx (`client/nginx.conf`) proxies `/api/` and `/ws` to `server:8080`. It resolves that name per request, so the game still loads when the server is down.

Scores are **written by the server** at game over (`GameRoom` → `ScoreService`). Every game, solo included, is played in a server room, so every finished run reaches the online leaderboard (rounds survived ≥ 0, one row per player).

## Client architecture (client/src/)

| Path | Role |
|---|---|
| `main.ts` | Creates the 960×600 canvas, CSS-scales it to fit the window, fetches the map list and the default map (`house`), then starts `Game` with a `Connection`. **The client needs the server to start**; without it, it shows an error screen |
| `core/Game.ts` | **The client.** Owns the canvas, input, camera, particles, lighting, audio, menus, HUD, the `Link` (socket) and a `NetGame`. Fixed 60 Hz loop and state machine (`menu`/`playing`/`paused`/`gameover`; the lobby is a menu page). Each tick: `pollNet()` drains server messages (`handle()`: welcome/lobby/start/snapshot/events/gameOver/error) → `readInput()` → `net.tick()` (seq + prediction) sent as `input` → `world = net.view(time)` → cosmetic timers. `onEvent(NetEvent)` shows points, purchases, hurt flash and shake only for `e.player === you`; other players' sounds are positional. Holds `level`, `world`, `you`/`me`, `spectating` (camera target while dead), `room`, `lobby`, `result` (the `gameOver` message), `feed` (teammate lines), per-player `PlayerFx`. Room actions: `selectMap`, `createRoom(solo)`, `joinRoom`, `setReady`, `startGame`, `leaveRoom`, `toMenu`. Pause is an overlay: in co-op you idle while the world runs; solo sends `pause` and the server stops the sim (it also waits while a solo player is disconnected). After a reconnect, no `welcome` within 3 s means the seat is gone (back to the title) |
| `net/Connection.ts` | `Link` interface + the real `/ws` socket: registers first if there's no token (re-registers if the handshake fails, in case the token is stale), JSON in/out, an inbox drained per tick, ping every 2 s (smoothed `rtt`), reconnect with backoff (`opens` counts successful opens). Lobby commands sent while connecting are queued; inputs aren't |
| `net/NetGame.ts`, `net/PlayerMotion.ts` | Snapshot buffer → `WorldView`. Remote players and zombies are interpolated 100 ms behind (server tick clock with a smoothed offset; shortest-arc angles; entities pop in/out). The local player is predicted with `movePlayer` (the movement half of the Java `Player.update`), reconciled on each snapshot (drop acked seqs, replay the rest from the server position), and corrections decay over ~100 ms (snap past 64 px). Aim is local. Opened doors are written into the level's `TileMap`. Not alive → server position |
| `view/WorldView.ts`, `view/Level.ts` | **What rendering reads** (Phase 4 M3). `restingWorld(level, id, name)` is the world behind the menus and before the first snapshot. `WorldView` is the snapshot's world (players, zombies, plank counts, interactable states, round, power-ups), so `protocol.ts` `Snapshot` extends it. `Level` is the static half: `MapData` plus `WindowFixture`s and `Fixture`s (kind + stand point), in the order the views index. Render, lighting, HUD, prompts and screens read only these |
| `core/Input.ts` | Keyboard/mouse state. `wasPressed` / `mousePressed` last one update tick (`endTick()` clears them). `typed` collects characters for text fields |
| `core/Camera.ts`, `core/math.ts` | Follow camera with shake; vector, angle and ray-circle helpers (`math.ts` is shared with the sim) |
| `game/defs.ts` | Typed views of `shared/defs/*.json`: `WEAPONS`, `KNIFE`, `UPGRADE`, `PERKS`, `ARMOUR_LEVELS`, `POWERUPS`, `BOX_COST`, ... Also the weapon formulas (`weaponName`, `magSize`, `reserveSize`, `ammoCost`, `repairCost`) and the mirrors of Java code constants (see **Netcode**) |
| `game/input.ts` | `PlayerInput` (one tick of intent, what `input` messages carry) and `NO_INPUT` |
| `game/MapData.ts` | `MapDoc` (the JSON in `welcome` and from `GET /api/maps/{id}`) and `parseMap()` → `MapData`. Maps are authored in `maps/*.json` |
| `game/TileMap.ts` | Tile types (`Outside`, `Floor`, `Wall`, `Window`, `Crate`, `Door`), circle-vs-tile collision (used by prediction), ray march, line of sight |
| `systems/Particles.ts` | Client-only particles, tracers, decals and floating text |
| `systems/HighScore.ts` | `Leaderboard` (`game.scores`): one map's server table at a time (`show(mapId)`), `lastRank` from your `gameOver` result. No local scores any more (the old localStorage keys are just ignored) |
| `net/protocol.ts` | Types for the `/ws` messages, mirroring `server/app/.../game/protocol` and the Java `SimEvent`. `Snapshot` is `WorldView` + `type`/`tick`/`acks` |
| `net/api.ts` | REST client. The identity `{name, playerId?, token?}` is kept under `boarded-up-identity`. The name is saved locally first and registered when the server answers; `ensureRegistered()` retries it when connecting. A 401 on rename means the server forgot the token, so it registers afresh |
| `render/draw.ts` | All procedural drawing from views: map pre-render, zombies, players (`drawPlayer`: local blue, teammates by id, downed lying down, dead not drawn; `drawPlayerOverlay` after lighting: name tags, bleed-out ring), windows, interactables (`drawInteractable`, `drawInteractableOverlay`, switching on `Fixture.kind`), power-ups. `render/lighting.ts` draws the darkness overlay with punched-out lights (a glow and flashlight cone per player) and the coloured machine glows. `render/visuals.ts` holds the visual-only tables and the `PlayerFx`/`ZombieFx` types |
| `ui/Menu.ts` | Title and pause menus: pages (main / high scores / audio / controls / name / maps / mode / join / lobby) of buttons, sliders, toggles and text fields, keyboard and mouse driven. Item rects come from one `rects()` used by both update and draw. New Game asks for a name the first time, then map select (if more than one map), then Play Solo / Host Co-op. Join Game takes a 4-letter code. The lobby shows the code, the seats (host / ready / away), Start for the host and a Ready toggle for others; Esc leaves the room. `fail(msg)` / `done()` end the wait for the server. High Scores flips maps with ←/→ |
| `ui/HUD.ts`, `ui/Screens.ts`, `ui/prompts.ts`, `ui/text.ts` | HUD (round, points, ammo, perks, armour, prompts, banners, now-playing toast), the game-over screen, and interaction prompt text |
| `audio/Sound.ts` | A singleton `sound` that synthesizes every SFX and plays the shuffled soundtrack. The AudioContext is created lazily on the first user gesture (`unlock()`). Master/music/effects volumes and mute persist under `boarded-up-audio`; SFX go through their own gain bus. `audio/tracks.ts` lists the soundtrack files |

### Conventions and patterns
- **Data-driven tuning:** weapon, perk, economy, armour and power-up numbers are in `shared/defs/*.json`. Door costs are in the map files. Constants still in code (RoundManager curves, player speed, zombie timings, box timings) live in the Java sim; the few the client needs are mirrored in `game/defs.ts`. Never inline numbers.
- **Entities call back into `GameSim`** for gameplay side effects and `emit()` an event for anything players should see or hear.
- **New buyable things** go in `Interactable.java` (added in the `GameSim` constructor in the same order as `buildLevel`: wall buys, perks, armour, upgrade, box, doors, power switch), then `SnapshotBuilder`, `view/Level.ts` `Fixture`/`buildLevel`, `ui/prompts.ts`, `render/draw.ts` `drawInteractable` and `render/visuals.ts` `glowOf`.
- **Render order:** world layer → lighting overlay → after-lighting world layer (power-ups, box label, floating text) → HUD → screens/crosshair.
- **Tile constants** are a plain `as const` object, not a `const enum`, because `isolatedModules` is on.
- **Damage and points** (Java): use `hitZombie(...)` → `killZombie(...)` so Instakill, Double Points, power-up drops and kill counting all keep working. Use `economy.award()` for earned points; it applies the multiplier.
- **Comments:** keep them sparse and explain *why*, matching the existing code.

## Controls
WASD/arrows move · mouse aims · Space or left click fires · R reload · E interact (hold E to rebuild) · F/V knife (automatic when the gun is completely out of ammo) · 1/2/Q/wheel switch weapon · M mute · Esc/P pause.

## Assets
- Soundtrack: `client/public/audio/tracks/NN-slug.mp3` (20 tracks). These were split from one long mix with ffmpeg stream copy (`-c copy`, ID3 title tags). They shuffle without repeats; `tracks.ts` is the playlist. Paths use `import.meta.env.BASE_URL`.
- Both Dockerfiles use BuildKit cache mounts (`boarded-up-gradle` for the Gradle home, with `--build-cache`; `boarded-up-npm` for npm). These survive source changes, so `docker compose up --build` doesn't download Gradle or dependencies again. `docker builder prune` clears them.
- Vite copies everything in `public/` into the build and the Docker image, so keep large unused files out of it.

## Testing without a browser
No browser automation was available while this was built. Gameplay is covered by the Java tests (`GameSimTest`, `CoopSimTest`, `SimParityTest`; construct a `GameSim` with a map and seed and call `step()`), the room and socket layer by `GameRoomTest` and `GameSocketIT`. The client (`core/Game.ts`, rendering, HUD) was smoke-tested with throwaway headless scripts that stub `document`, `window` and the canvas context with a no-op Proxy, then drive `game.update(1/60)` / `game.render()` while every event type fires. Gotchas if you recreate them:
- Two ways to drive the client headlessly: pass `new Game(canvas, maps, doc, link)` a fake `Link` whose `drain()` returns scripted messages (welcome/lobby/start/snapshots/events/gameOver), or use the real `Connection` against `docker compose up` by also stubbing `localStorage`, `location.origin` (`http://localhost:8551`) and `fetch` (prefix relative URLs with the origin); Node's global `WebSocket` does the rest. Override `game.readInput` with a bot. Two processes (host and guest, sharing the room code through a file) give a real co-op game, since `localStorage` (the identity) is per process. For latency, add `DEBUG_LATENCY_MS: "100"` to the server's environment with a compose override file.
- Run them with `npx vite-node` (no longer a dev dependency; npx fetches it), not `tsx`, because `import.meta.env` is only defined under Vite.
- Import project modules by **absolute** path. A mixed relative/absolute import loads a second copy of each module and breaks `instanceof`.
- The bot is weak: on the original code it averaged about round 3 on the house map. Use survival only as a smoke test, not a balance measure.
- Game randomness makes naive assertions flaky, so pass a fixed seed to the Java `GameSim` in tests. Examples: the box can roll a weapon you already own; kills can drop real power-ups; round-1 zombies can break in during long setup phases. Control for these rather than "fixing" the game.

Visuals, lighting and audio have **not** been checked in a real browser by an agent. If you have browser tools, smoke-test there.

## History
1. **Core loop:** rounds, hitscan shooting with aim assist, points (hit +10, kill +60, headshot kill +100), barricades zombies break and the player rebuilds, three wall weapons, flow-field AI, lighting, particles, HUD and screens.
2. **Controls change:** the user asked for mouse aim, with Space *or* click to fire.
3. **Second pass:** purchasable doors that gate rooms and spawn windows, four perks (Tough Hide, Quick Hands, Rapid Fire, Second Wind), three armour levels, a two-tier weapon upgrade bench, the mystery box (with box-only LMG, Hand Cannon and Plasma Caster), power-ups (Full Ammo, Instakill, Double Points, Detonation), procedural SFX, and the saved best score.
4. **Soundtrack:** split into 20 tracks, played shuffled, with a now-playing toast.
5. **Docker:** multi-stage build to an nginx image (`nginx.conf` sets caching and gzip) and a compose file. **Knife** melee added.
6. **Main menu:** real title menu (New Game, High Scores, Audio, Controls), pause menu (Resume, Audio, Controls, Quit), top-10 leaderboard, persisted volume sliders.
7. **Effects pass:** per-weapon `fx` in `WeaponDefs` (tracer colour/width, muzzle flash colour, casing type), tracers drawn additively after lighting so they glow, violet tracer halos on upgraded guns, shell casings and bullet holes that fade after 18 s (`Particles` timed decals, capped at 300), plasma shockwave ring, reload progress bar.

8. **Backend phase 1:** the repo became a monorepo (`client/`, `server/`). Added the Spring Boot + Postgres server, anonymous name-based identity, an online leaderboard with a localStorage fallback, and a three-service compose stack.
9. **Backend phase 2 (maps as data):** the house map moved to `maps/house.json` (verified tile-for-tile against the old `buildMap()`), and a second map, `maps/cabin.json`, was added. Added the server map API, validator and seeder, client map select, and per-map leaderboards. Verified headlessly: zombies spawn, breach and get inside on both maps.
10. **Backend phase 3 (sim split + Java port):** gameplay moved into a pure `client/src/sim/` (`GameSim`, events, `PlayerInput`, seeded RNG), with tuning in `shared/defs`. `core/Game.ts` became the client. It was checked against the original code with the same bot (same survival averages) and by headless runs of the full client. `server/sim` is the Java port, and it matched the TS sim state-for-state (`SimParityTest`).
11. **Backend phase 4 (co-op over WebSocket):** the Java sim went N-player (per-player economy and perks, downed/revive/bleed-out, party scaling), `GameRoom`s with lobbies by room code, 60 Hz ticks and 20 Hz snapshots, the client rebuilt on `WorldView`/`Level`, then networked (`Connection`, `NetGame` prediction and interpolation, lobby menus, co-op HUD). The server writes scores. Finally the TS sim was deleted: what's left of it is `client/src/game/` (defs, input, map, tiles), and `parity.txt` is a frozen Java baseline.

12. **Power + The Farmstead:** the two-room cabin map was replaced by a 64×40 farmstead (farmhouse: kitchen, bedroom, parlour; covered walkway; barn and generator room; 15 windows, 6 doors). Its power switch turns on room lighting and wakes the box, perks and upgrade bench. The house map is unchanged (its parity lines are identical). The client renders were checked headlessly with `@napi-rs/canvas` (power off/on, flicker, prompts), not in a real browser.

Names (perks, power-ups, "Boarded Up") are deliberately original; keep it that way rather than copying names from existing games.

## Backend roadmap
The user chose an **authoritative Java server**: the server runs the simulation and browsers only send input and render.
1. ~~Foundation + online high scores~~ (done)
2. ~~Maps as data~~ (done). A map editor is still out of scope.
3. ~~Sim split + port~~ (done)
4. ~~Co-op over WebSocket~~ (done; the plan and as-built notes for M1–M5 are in `docs/phase4-coop.md`). Lobbies by room code (max 4), solo through the same rooms.

## Possible next steps (not started)
Gamepad support · zombie variety (dogs/bosses) · a teddy-bear style box relocation · an aim-assist toggle in the menu · persistent stats · mobile/touch controls.
