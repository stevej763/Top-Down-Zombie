# Boarded Up — top-down zombie survival shooter

Browser game: the player defends a boarded-up house against rounds of zombies. Zombies tear planks off windows and climb in. The player earns points for hits, kills and rebuilding planks, then spends them on doors, wall weapons, perks, armour, weapon upgrades and the mystery box. Zombies get tougher every round.

**Stack:**
- **Client (`client/`):** vanilla Canvas 2D + TypeScript + Vite. No game framework and no runtime dependencies. All art is procedural (drawn in code). All sound effects are synthesized with WebAudio. The only assets are the soundtrack mp3s.
- **Server (`server/`):** Java 25 + Spring Boot 4 (Gradle Kotlin DSL) + PostgreSQL, with Flyway migrations.
- **The simulation exists twice**, as `client/src/sim/` (TypeScript, runs the game in the browser today) and `server/sim` (Java, for the authoritative server). They must behave identically: see **Two sims** below.
- **Gameplay tuning** lives in `shared/defs/*.json` and is read by both.

The roadmap for the backend (maps as data, porting the sim to Java, authoritative co-op over WebSocket) is in **Backend roadmap** below.

## Commands

```bash
cd client && npm run dev       # Vite dev server; proxies /api and /ws to localhost:8080
cd client && npm run build     # tsc --noEmit + vite build → dist/  (use this as the type-check)
cd client && npm run parity    # re-record the TS reference run that the Java SimParityTest replays
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

## Two sims (client/src/sim ↔ server/sim)
- **`client/src/sim/` is pure.** It imports only `core/math` and `shared/defs`. No DOM, canvas, audio, particles or `Math.random`. `GameSim.step(dt, PlayerInput)` advances the world and pushes `SimEvent`s (`events.ts`), which `core/Game.ts` drains into sound, particles, camera shake, callouts and banners.
- **`server/sim` (`com.boardedup.sim`) is a line-by-line Java port** with the same class and method names (`GameSim`, `Player`, `Zombie`, `Interactable`, `RoundManager`, `FlowField`, ...). It's plain Java (no Spring); it depends only on Jackson to read `shared/defs` and maps. `server/app` depends on it, and it also owns `MapDoc` and `MapValidator`.
- **Same RNG:** mulberry32 in both (`Rng.ts`, `Rng.java`); `RngTest` pins the sequence.
- **`SimParityTest` is the guard.** `npm run parity` (`client/scripts/parity.ts`) runs a bot for 2 minutes on each map with seed 42 and writes states to `server/sim/src/test/resources/parity.txt`. The Java test replays the same bot (`GameSimTest.bot`, which must match the TS bot) and requires identical states to 6 decimals. When this was set up they matched exactly. **Any gameplay change must be made in both sims**, then re-run `npm run parity` and the Java tests. A failure names the first state that drifted.
- **Cosmetic state stays in the client:** muzzle flash, hurt flash, knife swing (`PlayerFx`), and per-zombie hit flash and arm wobble (`ZombieFx`, keyed by zombie `id`), all in `core/Game.ts`. Plank tilt is a hash in `draw.ts`. Visual tables (tracer colours, barrel lengths, shake, perk and power-up colours, machine glows) are in `render/visuals.ts`. Prompt text is in `ui/prompts.ts`. None of these are in the Java sim.
- Phase 4 makes the Java sim authoritative; after that, the TS sim is deleted (the parity file then just serves as a Java regression baseline).

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
| `server/sim/src/test/` | `GameSimTest` (the feature checks: doors, perks, Tough Hide, Second Wind, armour, upgrades, box, power-ups, plasma splash, knife, rebuild cap, determinism, bot survival), `CoopSimTest` (multi-player: separate economies, targeting, multi-source flow field, downed/revive/bleed-out/respawn, box owner, shared power-ups, party scaling, event JSON), `SimParityTest`, `RngTest`, `MapValidatorTest` |

Config comes from env vars: `DB_URL`, `DB_USER`, `DB_PASSWORD`, `CORS_ORIGINS`, `ADMIN_TOKEN`, and the dev-only `DEBUG_LATENCY_MS` (delays `/ws` messages each way).

### Maps (`maps/*.json`)
- Each file is a map document named `<id>.json` (`MapDoc` in `server/sim/.../map/`, mirrored by `client/src/sim/MapData.ts`). Tile rows are strings: `.` outside, `_` floor, `#` wall, `W` window, `C` crate, `D` door. Rooms aren't painted on tiles; `MapValidator` flood-fills floor and names each area from the windows, doors and `playerStart` that touch it, so those names have to agree.
- Gradle copies `maps/` onto the classpath and `MapSeeder` upserts them at startup. **The files win**: editing a file replaces the DB copy, even one changed through `PUT`. An invalid file stops the server from starting, with the problems listed. `MapValidatorTest.repoMapsAreValid` catches that earlier.
- Maps uploaded only through `PUT` live just in the DB.
- The validator checks weapon and perk ids against `shared/defs`.
- Both compose images are built from the repo root (`server/Dockerfile`, `client/Dockerfile`, each with a `Dockerfile.dockerignore` beside it) so they can include `maps/` and `shared/`. In compose, nginx (`client/nginx.conf`) proxies `/api/` and `/ws` to `server:8080`. It resolves that name per request, so the game still loads when the server is down.

Scores are **written by the server** at game over (`GameRoom` → `ScoreService`). The browser client still runs the TS sim locally until Phase 4 M4, so for now its runs only reach the local (localStorage) leaderboard.

## Client architecture (client/src/)

| Path | Role |
|---|---|
| `main.ts` | Creates the 960×600 canvas, CSS-scales it to fit the window, fetches the map list and the default map (`house`), then starts `Game`. **The client needs the server to start**; without it, it shows an error screen |
| `core/Game.ts` | **The client.** Owns the canvas, input, camera, particles, lighting, audio, menus, HUD and a `GameSim`. Fixed 60 Hz loop and state machine (`menu`/`playing`/`paused`/`gameover`). Each tick: `readInput()` → `sim.step()` → `onEvent()` for every `SimEvent` → cosmetic timers. Also `maps`, `mapDoc`, `loadMap(id)`, groans, and the render order |
| `core/Input.ts` | Keyboard/mouse state. `wasPressed` / `mousePressed` last one update tick (`endTick()` clears them). `typed` collects characters for text fields |
| `core/Camera.ts`, `core/math.ts` | Follow camera with shake; vector, angle and ray-circle helpers (`math.ts` is shared with the sim) |
| `sim/GameSim.ts` | **The simulation hub.** World state and `step()`, plus the cross-cutting actions: `fire`, `traceShot` (hitscan), `knife`, `explode`, `hitZombie`, `killZombie`, `damagePlayer`, `secondWind`, `applyPowerUp`, `giveWeapon`, `openDoor`, `tearPlank`, `rebuildPlank`. `emit()` for events, `nextId()` for entity ids, `rng` |
| `sim/input.ts`, `sim/events.ts`, `sim/Rng.ts` | `PlayerInput` (one tick of intent), `SimEvent` union, seeded mulberry32 |
| `sim/defs.ts` | Typed views of `shared/defs/*.json`: `WEAPONS`, `BOX_POOL`, `KNIFE`, `UPGRADE`, `PERKS`, `PERK_EFFECTS`, `POINTS`, `ARMOUR_LEVELS`, `POWERUPS`, ... |
| `sim/MapData.ts` | `MapDoc` (the JSON from `GET /api/maps/{id}`) and `parseMap()` → `MapData`. Maps are authored in `maps/*.json` |
| `sim/TileMap.ts` | Tile types (`Outside`, `Floor`, `Wall`, `Window`, `Crate`, `Door`), circle-vs-tile collision, bullet ray march, line of sight |
| `sim/Barricade.ts` | A window: plank count, the outside/inside/spawn points, the zombie currently climbing |
| `sim/Interactables.ts` | Abstract `Interactable` (`kind`, `usable`, `use`, `update`) and its subclasses `WallBuy`, `PerkMachine`, `ArmourBench`, `UpgradeBench`, `MysteryBox`, `Door`. **New buyable things go here** (and in the Java port, `ui/prompts.ts`, `render/draw.ts` `drawInteractable`, and `render/visuals.ts` `glowOf`) and get added in the `GameSim` constructor |
| `sim/Player.ts` | Movement, aim, firing/reload/knife triggers from `PlayerInput`, perk-derived stats (`maxHp`, `reloadMult`, `fireIntervalMult`), the current `interaction` |
| `sim/Zombie.ts` | State machine: `outside → breaching → climbing → inside`. Outside zombies walk to their window; inside ones use the flow field, or chase directly when they have line of sight within 180px |
| `sim/RoundManager.ts` | Round flow and difficulty curves (`zombieHealth`, `zombieCount`, `runnerChance`, ...). Spawns only at windows in **opened rooms** |
| `sim/Pathfinding.ts` | BFS flow field from the player's tile over `Floor`. Call `invalidate()` after the map changes (doors) |
| `sim/aimAssist.ts` | ±8° assist cone (`AIM_ASSIST_CONE`; 0 disables it). Leaves shots that would already hit untouched |
| `sim/Economy.ts`, `sim/PowerUps.ts`, `sim/Weapon.ts` | Points (`award()` applies Double Points, vs `spend()`, the per-round rebuild cap); power-up drops and timers; per-instance ammo, reload and upgrade tier |
| `systems/Particles.ts` | Client-only particles, tracers, decals and floating text |
| `systems/HighScore.ts` | `Leaderboard` (`game.scores`): one map's table at a time (`show(mapId)`). It's the server's table when reachable, otherwise this browser's top 10 for that map in localStorage (`boarded-up-scores` for house, `boarded-up-scores:<id>` for others), which is always updated too |
| `net/protocol.ts` | Types for the `/ws` messages, mirroring `server/app/.../game/protocol` and the Java `SimEvent`. Not used until Phase 4 M4 |
| `net/api.ts` | REST client. The identity `{name, playerId?, token?}` is kept under `boarded-up-identity`. The name is saved locally first and registered when the server answers; registration is retried on score submit |
| `weapons/WeaponDefs.ts` | **Weapon stat table**, `BOX_POOL`, and the `KNIFE` constants. `weapons/Weapon.ts` holds per-instance ammo, reload state and upgrade tier (0–2), plus the derived stats (`damage`, `magSize`, `name`, ...) |
| `render/draw.ts` | All procedural drawing: map pre-render, zombies, player, windows, interactables (`drawInteractable`, `drawInteractableOverlay`), power-ups. `render/lighting.ts` draws the darkness overlay with punched-out lights and the coloured machine glows. `render/visuals.ts` holds the visual-only tables and the `PlayerFx`/`ZombieFx` types |
| `ui/Menu.ts` | Title and pause menus: pages (main / high scores / audio / controls / name / maps) of buttons, sliders, toggles and a text field, keyboard and mouse driven. Item rects come from one `rects()` used by both update and draw. New Game asks for a name the first time, then shows map select when there's more than one map. High Scores flips maps with ←/→ |
| `ui/HUD.ts`, `ui/Screens.ts`, `ui/prompts.ts`, `ui/text.ts` | HUD (round, points, ammo, perks, armour, prompts, banners, now-playing toast), the game-over screen, and interaction prompt text |
| `audio/Sound.ts` | A singleton `sound` that synthesizes every SFX and plays the shuffled soundtrack. The AudioContext is created lazily on the first user gesture (`unlock()`). Master/music/effects volumes and mute persist under `boarded-up-audio`; SFX go through their own gain bus. `audio/tracks.ts` lists the soundtrack files |

### Conventions and patterns
- **Data-driven tuning:** weapon, perk, economy, armour and power-up numbers are in `shared/defs/*.json` (both sims read them). Door costs are in the map files. Constants still in code (RoundManager curves, player speed, zombie timings, box timings) must be changed in **both** sims. Never inline numbers.
- **Entities call back into `GameSim`** for gameplay side effects and `emit()` an event for anything the player should see or hear. Sim files import `GameSim` as a **type only**, to avoid circular imports.
- **Render order:** world layer → lighting overlay → after-lighting world layer (power-ups, box label, floating text) → HUD → screens/crosshair.
- **Tile constants** are a plain `as const` object, not a `const enum`, because `isolatedModules` is on.
- **Damage and points:** use `hitZombie(...)` → `killZombie(...)` so Instakill, Double Points, power-up drops and kill counting all keep working. Use `economy.award()` for earned points; it applies the multiplier.
- **Comments:** keep them sparse and explain *why*, matching the existing code.

## Controls
WASD/arrows move · mouse aims · Space or left click fires · R reload · E interact (hold E to rebuild) · F/V knife (automatic when the gun is completely out of ammo) · 1/2/Q/wheel switch weapon · M mute · Esc/P pause.

## Assets
- Soundtrack: `client/public/audio/tracks/NN-slug.mp3` (20 tracks). These were split from one long mix with ffmpeg stream copy (`-c copy`, ID3 title tags). They shuffle without repeats; `tracks.ts` is the playlist. Paths use `import.meta.env.BASE_URL`.
- Both Dockerfiles use BuildKit cache mounts (`boarded-up-gradle` for the Gradle home, with `--build-cache`; `boarded-up-npm` for npm). These survive source changes, so `docker compose up --build` doesn't download Gradle or dependencies again. `docker builder prune` clears them.
- Vite copies everything in `public/` into the build and the Docker image, so keep large unused files out of it.

## Testing without a browser
No browser automation was available while this was built. Gameplay is covered by the Java tests (`GameSimTest`, `SimParityTest`), which by parity cover the TS sim too. The TS sim needs no stubs: construct `new GameSim(mapDoc, seed)` and call `step()`. The client (`core/Game.ts`, rendering, HUD) was smoke-tested with throwaway headless scripts that stub `document`, `window` and the canvas context with a no-op Proxy, then drive `game.update(1/60)` / `game.render()` while every `SimEvent` type fires. Gotchas if you recreate them:
- Run them with `npx vite-node`, not `tsx`, because `import.meta.env` is only defined under Vite.
- Import project modules by **absolute** path. A mixed relative/absolute import loads a second copy of each module and breaks `instanceof`.
- The bot is weak: on the original code it averaged about round 3 on the house map. Use survival only as a smoke test, not a balance measure.
- Game randomness makes naive assertions flaky, so pass a fixed seed to `GameSim`. Examples: the box can roll a weapon you already own; kills can drop real power-ups; round-1 zombies can break in during long setup phases. Control for these rather than "fixing" the game.

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
10. **Backend phase 3 (sim split + Java port):** gameplay moved into a pure `client/src/sim/` (`GameSim`, events, `PlayerInput`, seeded RNG), with tuning in `shared/defs`. `core/Game.ts` became the client. It was checked against the original code with the same bot (same survival averages) and by headless runs of the full client. `server/sim` is the Java port, and it matches the TS sim state-for-state (`SimParityTest`).

Names (perks, power-ups, "Boarded Up") are deliberately original; keep it that way rather than copying names from existing games.

## Backend roadmap
The user chose an **authoritative Java server**: eventually the server runs the simulation and browsers only send input and render. Client-side breakage is acceptable while the backend comes up.
1. ~~Foundation + online high scores~~ (done)
2. ~~Maps as data~~ (done). A map editor is still out of scope.
3. ~~Sim split + port~~ (done)
4. **Co-op over WebSocket (`/ws`). Detailed plan with milestones M1–M5: `docs/phase4-coop.md`.** `GameRoom` ticking at 60 Hz with 20 Hz snapshots, lobbies by room code (max 4), input with seq numbers, client prediction for the local player and interpolation for everything else, per-player economy/perks, downed/revive, and the server writes scores itself. Then the TS sim is retired.

## Possible next steps (not started)
Gamepad support · zombie variety (dogs/bosses) · a teddy-bear style box relocation · an aim-assist toggle in the menu · persistent stats · mobile/touch controls.
