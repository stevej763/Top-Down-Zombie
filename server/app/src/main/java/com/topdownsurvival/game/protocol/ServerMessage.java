package com.topdownsurvival.game.protocol;

import com.topdownsurvival.sim.SimEvent;
import com.topdownsurvival.sim.map.MapDoc;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.annotation.JsonTypeName;
import java.util.List;

/**
 * Server → browser over {@code /ws}. Mirrored by client/src/net/protocol.ts; keep the field names
 * identical. Serialize through {@code writerFor(ServerMessage.class)} so the {@code type} is written.
 * Player ids are sim ids (small ints, unique within a room), not the account UUIDs.
 */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
public interface ServerMessage {
    record You(int playerId, String name) {}

    record RoomInfo(String code, String mapId, int mapVersion, boolean solo) {}

    /** Sent on joining a room and on reconnecting to one. */
    @JsonTypeName("welcome")
    record Welcome(You you, RoomInfo room, MapDoc map) implements ServerMessage {}

    record LobbyPlayer(int id, String name, boolean ready, boolean connected) {}

    /** The room's members, sent whenever they change. {@code state} is "lobby" or "playing". */
    @JsonTypeName("lobby")
    record Lobby(String code, String state, int ownerId, List<LobbyPlayer> players) implements ServerMessage {}

    /** {@code seq} is the last input seq applied for you: 0 for a new game, more when resuming one. */
    @JsonTypeName("start")
    record Start(long tick, int seq) implements ServerMessage {}

    /** Everything the sim emitted during one tick. */
    @JsonTypeName("events")
    record Events(long tick, List<SimEvent> events) implements ServerMessage {}

    /** {@code rank} is the 0-based position on the map's leaderboard, or -1 if the score wasn't saved. */
    record Result(int id, String name, int kills, int points, int rank) {}

    /** {@code round} is rounds survived, as stored in the scores table. */
    @JsonTypeName("gameOver")
    record GameOver(int round, List<Result> players) implements ServerMessage {}

    @JsonTypeName("pong")
    record Pong(double t) implements ServerMessage {}

    @JsonTypeName("error")
    record Error(String message) implements ServerMessage {}
}
