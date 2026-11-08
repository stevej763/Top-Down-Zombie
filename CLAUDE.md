# Boarded Up — top-down zombie survival shooter

Browser game: the player defends a boarded-up house against rounds of zombies. Zombies tear planks off windows and climb in. The player earns points for hits, kills and rebuilding planks, then spends them on doors, wall weapons, perks, armour, weapon upgrades and the mystery box. Zombies get tougher every round.

**Stack:** vanilla Canvas 2D + TypeScript + Vite. No game framework and no runtime dependencies. All art is procedural (drawn in code). All sound effects are synthesized with WebAudio. The only assets are the soundtrack mp3s.

## Commands

```bash
npm run dev            # Vite dev server (hot reload)
npm run build          # tsc --noEmit + vite build → dist/  (use this as the type-check)
docker compose up -d --build   # nginx container on http://localhost:8080
```

There is no test suite or linter. `npm run build` must pass with zero type errors. `tsconfig` is strict, with `noUnusedLocals` and `noUnusedParameters`; prefix intentionally unused params with `_`.

## Architecture (src/)

| Path | Role |
|---|---|
| `main.ts` | Creates the 960×600 canvas, CSS-scales it to fit the window, starts `Game` |
| `core/Game.ts` | **Central hub.** Fixed 60 Hz update loop, state machine (`menu`/`playing`/`paused`/`gameover`), owns all world state. Holds the cross-cutting actions: `fire`, `traceShot` (hitscan), `knife`, `explode`, `hitZombie`, `killZombie`, `damagePlayer`, `secondWind`, `applyPowerUp`, `giveWeapon`, `openDoor`, `tearPlank`, `rebuildPlank`. Also the render order |
| `core/Input.ts` | Keyboard/mouse state. `wasPressed` / `mousePressed` last one update tick (`endTick()` clears them) |
| `core/Camera.ts`, `core/math.ts` | Follow camera with shake; vector, angle and ray-circle helpers |
| `world/MapData.ts` | **The single hand-authored map:** 40×30 tiles at 32px, four rooms, eight windows, four doors, plus where every wall buy, perk, bench and the box go. Edit layout here |
| `world/TileMap.ts` | Tile types (`Outside`, `Floor`, `Wall`, `Window`, `Crate`, `Door`), circle-vs-tile collision, bullet ray march, line of sight |
| `world/Barricade.ts` | A window: plank count, the outside/inside/spawn points, the zombie currently climbing |
| `world/Interactables.ts` | Abstract `Interactable` (`prompt`/`use`/`draw`/`update`/`drawOverlay`) and its subclasses `WallBuy`, `PerkMachine`, `ArmourBench`, `UpgradeBench`, `MysteryBox`, `Door`. **New buyable things go here** and get added to `Game.newGame()` |
| `entities/Player.ts` | Movement, aim (mouse), firing/reload/knife triggers, perk-derived stats (`maxHp`, `reloadMult`, `fireIntervalMult`), picking the nearest interaction |
| `entities/Zombie.ts` | State machine: `outside → breaching → climbing → inside`. Outside zombies walk to their window; inside ones use the flow field, or chase directly when they have line of sight within 180px |
| `systems/RoundManager.ts` | Round flow and difficulty curves (`zombieHealth`, `zombieCount`, `runnerChance`, ...). Spawns only at windows in **opened rooms** |
| `systems/Pathfinding.ts` | BFS flow field from the player's tile over `Floor`. Call `invalidate()` after the map changes (doors) |
| `systems/aimAssist.ts` | ±8° assist cone (`AIM_ASSIST_CONE`; 0 disables it). Leaves shots that would already hit untouched |
| `systems/Economy.ts` | Points, `award()` (applies the Double Points multiplier) vs `spend()`, the per-round cap on rebuild points, `POINTS` table |
| `systems/Perks.ts`, `Armour.ts`, `PowerUps.ts`, `HighScore.ts`, `Particles.ts` | Data tables and small systems. High score is in localStorage under `boarded-up-best` |
| `weapons/WeaponDefs.ts` | **Weapon stat table**, `BOX_POOL`, and the `KNIFE` constants. `weapons/Weapon.ts` holds per-instance ammo, reload state and upgrade tier (0–2), plus the derived stats (`damage`, `magSize`, `name`, ...) |
| `render/draw.ts` | All procedural drawing: map pre-render, zombies, player, windows, machines. `render/lighting.ts` draws the darkness overlay with punched-out lights and the coloured machine glows |
| `ui/HUD.ts`, `ui/Screens.ts`, `ui/text.ts` | HUD (round, points, ammo, perks, armour, prompts, banners, now-playing toast) and the title/pause/game-over screens |
| `audio/Sound.ts` | A singleton `sound` that synthesizes every SFX and plays the shuffled soundtrack. The AudioContext is created lazily on the first user gesture (`unlock()`). `audio/tracks.ts` lists the soundtrack files |

### Conventions and patterns
- **Data-driven tuning:** gameplay numbers live in tables and constants at the top of files (`WEAPONS`, `KNIFE`, `PERKS`, `ARMOUR_LEVELS`, `POINTS`, the RoundManager curves, and the prices in `MapData`/`Interactables`). Change numbers there, not inline.
- **Entities call back into `Game`** for side effects (damage, points, particles, sound). Entities and systems import `Game` as a **type only**, to avoid circular imports.
- **Render order:** world layer → lighting overlay → after-lighting world layer (power-ups, box label, floating text) → HUD → screens/crosshair.
- **Tile constants** are a plain `as const` object, not a `const enum`, because `isolatedModules` is on.
- **Damage and points:** use `hitZombie(...)` → `killZombie(...)` so Instakill, Double Points, power-up drops and kill counting all keep working. Use `economy.award()` for earned points; it applies the multiplier.
- **Comments:** keep them sparse and explain *why*, matching the existing code.

## Controls
WASD/arrows move · mouse aims · Space or left click fires · R reload · E interact (hold E to rebuild) · F/V knife (automatic when the gun is completely out of ammo) · 1/2/Q/wheel switch weapon · M mute · Esc/P pause.

## Assets
- Soundtrack: `public/audio/tracks/NN-slug.mp3` (20 tracks). These were split from one long mix with ffmpeg stream copy (`-c copy`, ID3 title tags). They shuffle without repeats; `tracks.ts` is the playlist. Paths use `import.meta.env.BASE_URL`.
- Vite copies everything in `public/` into the build and the Docker image, so keep large unused files out of it.

## Testing without a browser
No browser automation was available while this was built. Verification so far: `npm run build`, plus throwaway headless scripts that stub `document`, `window` and the canvas context with a no-op Proxy, then drive `game.update(1/60)` / `input.endTick()` directly. A bot shoots and rebuilds, and feature checks cover doors, perks, armour, upgrades, the box, power-ups, Second Wind, plasma splash and the knife. Gotchas if you recreate them:
- Run them with `npx vite-node`, not `tsx`, because `import.meta.env` is only defined under Vite.
- Import project modules by **absolute** path. A mixed relative/absolute import loads a second copy of each module and breaks `instanceof`.
- Game randomness makes naive assertions flaky. Examples: the box can roll a weapon you already own; kills can drop real power-ups; round-1 zombies can break in during long setup phases. Control for these rather than "fixing" the game.

Visuals, lighting and audio have **not** been checked in a real browser by an agent. If you have browser tools, smoke-test there.

## History
1. **Core loop:** rounds, hitscan shooting with aim assist, points (hit +10, kill +60, headshot kill +100), barricades zombies break and the player rebuilds, three wall weapons, flow-field AI, lighting, particles, HUD and screens.
2. **Controls change:** the user asked for mouse aim, with Space *or* click to fire.
3. **Second pass:** purchasable doors that gate rooms and spawn windows, four perks (Tough Hide, Quick Hands, Rapid Fire, Second Wind), three armour levels, a two-tier weapon upgrade bench, the mystery box (with box-only LMG, Hand Cannon and Plasma Caster), power-ups (Full Ammo, Instakill, Double Points, Detonation), procedural SFX, and the saved best score.
4. **Soundtrack:** split into 20 tracks, played shuffled, with a now-playing toast.
5. **Docker:** multi-stage build to an nginx image (`nginx.conf` sets caching and gzip) and a compose file. **Knife** melee added.

Names (perks, power-ups, "Boarded Up") are deliberately original; keep it that way rather than copying names from existing games.

## Possible next steps (not started)
Gamepad support · more maps / map selection · zombie variety (dogs/bosses) · a teddy-bear style box relocation · co-op · a settings menu (volume sliders, aim-assist toggle) · persistent stats · mobile/touch controls.
