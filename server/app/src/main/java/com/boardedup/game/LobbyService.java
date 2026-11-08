package com.boardedup.game;

import com.boardedup.game.protocol.ServerMessage;
import com.boardedup.map.MapService;
import com.boardedup.sim.map.MapDoc;
import java.security.SecureRandom;
import java.time.InstantSource;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;
import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Every live room, by code and by member. Create, join and leave are synchronized here; rooms call
 * back into {@link GameRoom.Listener} under their own lock, and those callbacks only touch the
 * concurrent maps, so the two locks are never taken in the opposite order.
 */
@Service
public class LobbyService implements GameRoom.Listener {
    /** A map ready to play. */
    public record RoomMap(MapDoc doc, int version) {}

    /** Starts a room's 60 Hz tick; the returned handle stops it. */
    public interface Ticker {
        Runnable start(Runnable tick);
    }

    /** No I, L or O, which read like 1 and 0. */
    private static final String CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
    private static final int CODE_LENGTH = 4;

    private final Function<String, Optional<RoomMap>> maps;
    private final ScoreRecorder scores;
    private final Ticker ticker;
    private final InstantSource clock;
    private final LongSupplier seeds;
    private final SecureRandom random = new SecureRandom();

    private final Map<String, GameRoom> rooms = new ConcurrentHashMap<>();
    private final Map<UUID, GameRoom> roomOf = new ConcurrentHashMap<>();
    private final Map<GameRoom, Runnable> stoppers = new ConcurrentHashMap<>();

    @Autowired
    public LobbyService(MapService maps, ScoreRecorder scores, Ticker ticker, InstantSource clock) {
        this(id -> maps.find(id).map(m -> new RoomMap(maps.parse(m.getData()), m.getVersion())), scores, ticker, clock, null);
    }

    LobbyService(Function<String, Optional<RoomMap>> maps, ScoreRecorder scores, Ticker ticker, InstantSource clock,
            LongSupplier seeds) {
        this.maps = maps;
        this.scores = scores;
        this.ticker = ticker;
        this.clock = clock;
        this.seeds = seeds != null ? seeds : random::nextLong;
    }

    /** Creates a room and joins it; a solo room starts at once. Returns an error message, or null. */
    public synchronized String create(UUID account, String name, String mapId, boolean solo, Connection conn) {
        Optional<RoomMap> map = mapId == null ? Optional.empty() : maps.apply(mapId);
        if (map.isEmpty()) return "No map " + mapId;
        leave(account);
        GameRoom room = new GameRoom(newCode(), map.get().doc(), map.get().version(), solo, scores, clock, seeds, this);
        rooms.put(room.code, room);
        stoppers.put(room, ticker.start(room::tick));
        room.join(account, name, conn);
        roomOf.put(account, room);
        if (solo) room.start(account);
        return null;
    }

    public synchronized String join(UUID account, String name, String code, Connection conn) {
        GameRoom room = code == null ? null : rooms.get(code.trim().toUpperCase(Locale.ROOT));
        if (room == null) return "No room " + code;
        if (roomOf.get(account) == room) return "Already in this room";
        // Check before leaving the current room, so a failed join doesn't cost the player their seat.
        if (room.solo) return "That's a solo game";
        if (room.state() != GameRoom.State.LOBBY) return "That game has already started";
        leave(account);
        String error = room.join(account, name, conn);
        if (error == null) roomOf.put(account, room);
        return error;
    }

    public void leave(UUID account) {
        GameRoom room = roomOf.get(account);
        if (room != null) room.leave(account);
    }

    /** A new socket for this account: resume their room, if they're in one. */
    public void connected(UUID account, Connection conn) {
        GameRoom room = roomOf.get(account);
        if (room != null) room.reconnect(account, conn);
    }

    public void disconnected(UUID account, Connection conn) {
        GameRoom room = roomOf.get(account);
        if (room != null) room.disconnected(account, conn);
    }

    /** The account's room, if any. */
    public Optional<GameRoom> roomOf(UUID account) {
        return Optional.ofNullable(roomOf.get(account));
    }

    public Optional<GameRoom> room(String code) {
        return Optional.ofNullable(rooms.get(code));
    }

    public int roomCount() {
        return rooms.size();
    }

    @Override
    public void memberRemoved(GameRoom room, UUID account) {
        roomOf.remove(account, room);
    }

    @Override
    public void closed(GameRoom room) {
        rooms.remove(room.code, room);
        Runnable stop = stoppers.remove(room);
        if (stop != null) stop.run();
    }

    /** Sends an error, if there is one. */
    static void reply(Connection conn, String error) {
        if (error != null) conn.send(new ServerMessage.Error(error));
    }

    private String newCode() {
        while (true) {
            StringBuilder sb = new StringBuilder(CODE_LENGTH);
            for (int i = 0; i < CODE_LENGTH; i++) sb.append(CODE_LETTERS.charAt(random.nextInt(CODE_LETTERS.length())));
            String code = sb.toString();
            if (!rooms.containsKey(code)) return code;
        }
    }
}
