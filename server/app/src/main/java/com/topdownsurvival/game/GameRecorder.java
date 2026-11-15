package com.topdownsurvival.game;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Where rooms write game history (the admin portal's games list). A room calls these in order on
 * its background executor, never on the tick thread.
 */
public interface GameRecorder {
    record Seat(UUID playerId, int simId, String name) {}

    record GameStart(UUID gameId, String roomCode, String mapId, int mapVersion, boolean solo, long seed,
            Instant startedAt, List<Seat> seats) {}

    /** A player's standing when they left or the game ended. */
    record Standing(UUID playerId, int kills, int points) {}

    void started(GameStart game);

    /** A player left mid-game (or their grace period ran out). */
    void left(UUID gameId, Standing standing, Instant at);

    /** {@code reason} is over, abandoned, crashed or shutdown; {@code standings} are the players still in it. */
    void ended(UUID gameId, String reason, int round, Instant at, List<Standing> standings);

    GameRecorder NONE = new GameRecorder() {
        @Override
        public void started(GameStart game) {}

        @Override
        public void left(UUID gameId, Standing standing, Instant at) {}

        @Override
        public void ended(UUID gameId, String reason, int round, Instant at, List<Standing> standings) {}
    };
}
