package com.topdownsurvival.game;

import java.util.List;
import java.util.UUID;

/** Where rooms write scores at game over. */
public interface ScoreRecorder {
    record Result(UUID playerId, int kills, int points) {}

    /** Saves one row per result and returns each one's 0-based leaderboard position, in order. */
    List<Integer> record(String mapId, int round, int partySize, List<Result> results);
}
