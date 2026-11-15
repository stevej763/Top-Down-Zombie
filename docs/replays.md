# Watching back a finished game: feasibility

Status: **reviewed, not built.** This page covers what it would take to let the admin portal replay a finished game, and which approach to pick.

## What already exists

- Every game has a row in `games`, with `game_players`, `seed`, `map_id` and `map_version`, written by `GameHistoryService`.
- The admin portal can watch a live room (`/ws/watch`). It receives exactly what players receive: `watch` (the map document), then `snapshot` at 20 Hz and `events`. The portal draws that stream with the game's own renderer (`admin/src/watchView.ts`, `client/src/render/world.ts`).
- So "replay" is the same viewer fed from storage instead of a socket.

## Option A: store the inputs and re-run the sim

Store the following per game:
- the seed;
- the map document (`map_version` alone isn't enough, since maps get re-saved);
- for every tick, the `Map<playerId, PlayerInput>` that `GameRoom.stepSim` actually passed to `sim.step`;
- the tick at which each player was removed.

To replay, the server builds a `GameSim` and steps it with those inputs, streaming snapshots as a room does.

**Determinism is good.**
- `GameSim` uses only its seeded mulberry32 `Rng`.
- It has a fixed `dt`, ordered lists, and no wall clock or `HashMap` iteration order that matters.
- `SimParityTest` already holds it to 6 decimals.

**The catches:**
- **Record after `GameRoom`, not from client messages.** What a tick applies depends on network timing:
  - an empty queue repeats `held(last)`;
  - more than 6 queued inputs are merged;
  - disconnects idle the player;
  - the grace period runs on the wall clock;
  - a solo pause skips steps.

  The hook is `stepSim()`: record `inputs` there, and record `removePlayer` calls with the tick they happened on.
- **Any change to gameplay breaks every old replay.** Each regeneration of `parity.txt` is exactly such a change. Keeping old replays playable would mean storing a sim version and keeping old sim jars around, or migrating recordings, which isn't realistic.
- The sim uses `Math.sin/cos/atan2`, not `StrictMath`. These may differ by an ulp between JVMs or CPUs, so replay is only bit-exact on the same JVM build. That's fine for one server, but fragile across upgrades.
- Seeking means re-simulating from tick 0, unless sim checkpoints are also stored. The sim has no serializer today.

**Size is tiny.**
- An input is 11 fields: about 10 bytes packed, or about 3 bytes if aim is quantized and the flags are bit-packed.
- Inputs repeat heavily from tick to tick, so run-length encoding plus gzip gives roughly 1–5 KB per player-minute.
- A 20-minute four-player game comes to well under 1 MB.

## Option B: store the broadcast stream

Append every `snapshot` and `events` message a room broadcasts, already serialized, to a gzip stream per game. The hook is `GameRoom.broadcast`, the same place spectators are fed.

Measured on the compose stack (solo, The House, rounds 1–2, 20 s):

| | |
|---|---|
| snapshot, no zombies, 1 player | ~700 B |
| each extra player | ~300 B |
| each zombie | ~77 B |
| stream, raw | 19.5 KB/s |
| stream, gzipped | 0.9 KB/s |

Extrapolating to a late four-player game (4 players, 24 zombies alive):
- Snapshots are about 3.5 KB, so the raw stream is about 70 KB/s.
- Gzip did 20× on the small game; this assumes 8–15× here because positions change more, giving about 5–9 KB/s.
- A 20-minute game is about 1 MB gzipped for typical solo play and 6–11 MB at worst.
- Delta-encoding snapshots, or quantizing positions to integers, would cut that further if needed.

Strengths:
- **It survives code changes.** It's data, not a re-run, so gameplay can change freely.
- **Playback is already written.** It's `WatchView` with a different message source: feed stored messages to `NetGame` by tick time. Pause, speed and scrubbing are client-side.
- Seeking is cheap. Every snapshot is a full state (no deltas today), so jumping means "find the snapshot at or before tick N". Events between snapshots are only cosmetic.
- No determinism risk, and no extra CPU on the server at playback (just streaming bytes).

Costs:
- Storage grows with play time, so it needs retention (for example, keep 30 days, or the last N games, or only flagged games).
- The write path must not block the tick. Hand the already-serialized text to a per-room writer on the background executor, as score writes are. `SocketConnection` already serializes once per connection; a shared serialization would serve both.

## Recommendation

**Option B (store the broadcast stream).**
- It's robust to the frequent gameplay tuning this project does.
- It reuses the spectator viewer almost unchanged.
- At these sizes, Postgres can hold it: a `game_replays(game_id, chunk, bytes bytea)` table written in about 1-minute gzipped chunks. Alternatively, write files on a volume with the path stored on the game row.

Option A is worth adding later only as a debugging tool: it's tiny, and replaying a crash in a test (`GameSim` + recorded inputs) would be valuable, but it isn't the viewer's data source.

## Rough plan and effort

About 2–3 days. Each step:
1. **Recording.**
   - `ReplayRecorder` on `GameRoom` gets every broadcast `Snapshot`/`Events` message (not `Lobby`/`Error`) while a game runs, as serialized JSON lines.
   - It buffers in memory and flushes gzipped chunks to `game_replays` every ~60 s and at game end, off the tick thread.
   - It reuses the room's ordered `write(...)` chain.
2. **Retention.** A scheduled job deletes chunks older than a configured number of days (`REPLAY_DAYS`). `games.has_replay` shows which games can be watched.
3. **API.** `GET /api/admin/games/{id}/replay` streams the gunzipped NDJSON, or serves chunks for seeking. Admin session only.
4. **Viewer.**
   - Generalize `WatchView`'s message source: a socket for live games, the fetched NDJSON for replays.
   - Add a timeline with play/pause, 0.5–4× speed and a scrub bar (seek = rebuild `NetGame` and feed from the nearest snapshot).
   - The map comes from a stored copy of the document (save it once per game: `games.map_doc`, or the replay's first line), since maps change.
5. **Tests.** A `GameRoomTest` that records a game and checks the stream starts with a snapshot and ends with the `gameOver` event, and an API test for the endpoint and retention.

## Privacy

Replays contain player names and positions, nothing more than live spectating shows. They're admin-only, behind the same session as the rest of the portal. If they're ever shared publicly, strip names or ask players.
