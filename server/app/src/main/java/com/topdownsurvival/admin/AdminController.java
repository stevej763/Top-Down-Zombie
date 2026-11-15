package com.topdownsurvival.admin;

import com.topdownsurvival.game.GameRoom;
import com.topdownsurvival.game.GameSocketHandler;
import com.topdownsurvival.game.LobbyService;
import jakarta.servlet.http.HttpServletRequest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** What the admin portal's Live, Games and Players pages read. Everything needs an admin session. */
@RestController
@RequestMapping("/api/admin")
public class AdminController {
    /** Seen this recently (heartbeat or socket) counts as online. */
    static final Duration ONLINE = Duration.ofSeconds(60);
    private static final int MAX_LIMIT = 200;

    public record Overview(int sockets, long online, int inRooms, int lobbies, int playing, int spectators,
            long players, long newPlayersToday, long games, long gamesToday) {}

    public record GameRow(UUID id, String roomCode, String mapId, int mapVersion, boolean solo, int partySize,
            Instant startedAt, Instant endedAt, String endReason, Integer round, String players, int kills, int points) {}

    public record GamePlayerRow(UUID playerId, int simId, String name, int kills, int points, Instant leftAt, Integer rank) {}

    public record GameDetail(GameRow game, long seed, List<GamePlayerRow> players) {}

    public record PlayerRow(UUID id, String name, Instant createdAt, Instant lastSeenAt, boolean online, String room,
            long games, int bestRound, long kills) {}

    public record PlayerPage(long total, List<PlayerRow> players) {}

    public record PlayerGame(UUID gameId, String mapId, boolean solo, int partySize, Instant startedAt, Instant endedAt,
            String endReason, Integer round, int kills, int points, Instant leftAt) {}

    public record PlayerDetail(PlayerRow player, List<PlayerGame> games) {}

    private final AdminAuth auth;
    private final JdbcClient db;
    private final LobbyService lobby;
    private final GameSocketHandler sockets;
    private final InstantSource clock;

    public AdminController(AdminAuth auth, JdbcClient db, LobbyService lobby, GameSocketHandler sockets, InstantSource clock) {
        this.auth = auth;
        this.db = db;
        this.lobby = lobby;
        this.sockets = sockets;
        this.clock = clock;
    }

    @GetMapping("/overview")
    public Overview overview(HttpServletRequest request) {
        auth.require(request);
        List<GameRoom.LiveRoom> rooms = live();
        Map<UUID, String> inRooms = roomByPlayer(rooms);
        Instant now = clock.instant();
        Timestamp today = Timestamp.from(now.atZone(ZoneOffset.UTC).truncatedTo(ChronoUnit.DAYS).toInstant());
        List<UUID> seen = db.sql("SELECT id FROM players WHERE last_seen_at > ?")
                .param(Timestamp.from(now.minus(ONLINE)))
                .query(UUID.class)
                .list();
        var online = new java.util.HashSet<>(seen);
        online.addAll(inRooms.keySet());
        return new Overview(sockets.connectionCount(), online.size(), inRooms.size(),
                (int) rooms.stream().filter(r -> r.state().equals("lobby")).count(),
                (int) rooms.stream().filter(r -> r.state().equals("playing")).count(),
                rooms.stream().mapToInt(GameRoom.LiveRoom::spectators).sum(),
                count("SELECT count(*) FROM players", null), count("SELECT count(*) FROM players WHERE created_at >= ?", today),
                count("SELECT count(*) FROM games", null), count("SELECT count(*) FROM games WHERE started_at >= ?", today));
    }

    @GetMapping("/live")
    public List<GameRoom.LiveRoom> live(HttpServletRequest request) {
        auth.require(request);
        return live();
    }

    private List<GameRoom.LiveRoom> live() {
        return lobby.rooms().stream().map(GameRoom::summary)
                .sorted(Comparator.comparing(GameRoom.LiveRoom::state).reversed().thenComparing(GameRoom.LiveRoom::code))
                .toList();
    }

    private static Map<UUID, String> roomByPlayer(List<GameRoom.LiveRoom> rooms) {
        Map<UUID, String> out = new HashMap<>();
        for (var r : rooms) for (var m : r.members()) out.put(m.playerId(), r.code());
        return out;
    }

    // ------------------------------------------------------------- games

    private static final String GAME_COLUMNS = """
            g.id, g.room_code, g.map_id, g.map_version, g.solo, g.party_size, g.started_at, g.ended_at, g.end_reason, g.round,
            (SELECT string_agg(gp.name, ', ' ORDER BY gp.sim_id) FROM game_players gp WHERE gp.game_id = g.id),
            (SELECT coalesce(sum(gp.kills), 0) FROM game_players gp WHERE gp.game_id = g.id),
            (SELECT coalesce(sum(gp.points), 0) FROM game_players gp WHERE gp.game_id = g.id)""";

    /** Newest first. {@code before} pages on started_at; {@code reason} "running" means not ended yet. */
    @GetMapping("/games")
    public List<GameRow> games(HttpServletRequest request, @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Instant before, @RequestParam(required = false) String map,
            @RequestParam(required = false) String reason, @RequestParam(required = false) UUID player) {
        auth.require(request);
        StringBuilder sql = new StringBuilder("SELECT " + GAME_COLUMNS + " FROM games g WHERE true");
        List<Object> params = new ArrayList<>();
        if (before != null) {
            sql.append(" AND g.started_at < ?");
            params.add(Timestamp.from(before));
        }
        if (map != null && !map.isBlank()) {
            sql.append(" AND g.map_id = ?");
            params.add(map);
        }
        if ("running".equals(reason)) {
            sql.append(" AND g.ended_at IS NULL");
        } else if (reason != null && !reason.isBlank()) {
            sql.append(" AND g.end_reason = ?");
            params.add(reason);
        }
        if (player != null) {
            sql.append(" AND EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id AND gp.player_id = ?)");
            params.add(player);
        }
        sql.append(" ORDER BY g.started_at DESC LIMIT ?");
        params.add(clampLimit(limit, 50));
        return db.sql(sql.toString()).params(params).query(AdminController::gameRow).list();
    }

    @GetMapping("/games/{id}")
    public GameDetail game(HttpServletRequest request, @PathVariable UUID id) {
        auth.require(request);
        GameRow game = db.sql("SELECT " + GAME_COLUMNS + " FROM games g WHERE g.id = ?").param(id).query(AdminController::gameRow)
                .optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No such game"));
        long seed = db.sql("SELECT seed FROM games WHERE id = ?").param(id).query(Long.class).single();
        List<GamePlayerRow> players = db.sql("""
                SELECT gp.player_id, gp.sim_id, gp.name, gp.kills, gp.points, gp.left_at,
                       (SELECT count(*) FROM scores b WHERE b.map_id = s.map_id AND (b.round > s.round
                           OR (b.round = s.round AND (b.kills > s.kills OR (b.kills = s.kills AND (b.points > s.points
                           OR (b.points = s.points AND b.id < s.id))))))) AS rank, s.id
                FROM game_players gp LEFT JOIN scores s ON s.game_id = gp.game_id AND s.player_id = gp.player_id
                WHERE gp.game_id = ? ORDER BY gp.sim_id""")
                .param(id)
                .query((rs, _) -> new GamePlayerRow(rs.getObject(1, UUID.class), rs.getInt(2), rs.getString(3), rs.getInt(4),
                        rs.getInt(5), instant(rs, 6), rs.getObject(8) == null ? null : rs.getInt(7)))
                .list();
        return new GameDetail(game, seed, players);
    }

    private static GameRow gameRow(ResultSet rs, int _row) throws SQLException {
        return new GameRow(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getInt(4), rs.getBoolean(5),
                rs.getInt(6), instant(rs, 7), instant(rs, 8), rs.getString(9), (Integer) rs.getObject(10), rs.getString(11),
                rs.getInt(12), rs.getInt(13));
    }

    // ------------------------------------------------------------- players

    private static final Map<String, String> PLAYER_SORTS = Map.of(
            "seen", "p.last_seen_at DESC NULLS LAST",
            "created", "p.created_at DESC",
            "name", "lower(p.name), p.created_at",
            "games", "games DESC, p.last_seen_at DESC NULLS LAST",
            "best", "best DESC, p.last_seen_at DESC NULLS LAST",
            "kills", "kills DESC, p.last_seen_at DESC NULLS LAST");

    private static final String PLAYER_SELECT = """
            SELECT p.id, p.name, p.created_at, p.last_seen_at, count(gp.game_id) AS games,
                   coalesce(max(g.round), 0) AS best, coalesce(sum(gp.kills), 0) AS kills
            FROM players p LEFT JOIN game_players gp ON gp.player_id = p.id LEFT JOIN games g ON g.id = gp.game_id
            """;

    @GetMapping("/players")
    public PlayerPage players(HttpServletRequest request, @RequestParam(required = false) String q,
            @RequestParam(required = false) String sort, @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset) {
        auth.require(request);
        String pattern = q == null || q.isBlank() ? null : "%" + q.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
        String where = pattern == null ? "" : " WHERE p.name ILIKE ?";
        Map<UUID, String> rooms = roomByPlayer(live());
        Instant cutoff = clock.instant().minus(ONLINE);
        String order = PLAYER_SORTS.getOrDefault(sort == null ? "seen" : sort, PLAYER_SORTS.get("seen"));
        List<Object> params = new ArrayList<>();
        if (pattern != null) params.add(pattern);
        params.add(clampLimit(limit, 50));
        params.add(Math.max(0, offset == null ? 0 : offset));
        List<PlayerRow> rows = db.sql(PLAYER_SELECT + where + " GROUP BY p.id ORDER BY " + order + " LIMIT ? OFFSET ?")
                .params(params)
                .query((rs, _) -> playerRow(rs, rooms, cutoff))
                .list();
        long total = pattern == null ? count("SELECT count(*) FROM players", null)
                : count("SELECT count(*) FROM players p" + where, pattern);
        return new PlayerPage(total, rows);
    }

    @GetMapping("/players/{id}")
    public PlayerDetail player(HttpServletRequest request, @PathVariable UUID id) {
        auth.require(request);
        Map<UUID, String> rooms = roomByPlayer(live());
        Instant cutoff = clock.instant().minus(ONLINE);
        PlayerRow row = db.sql(PLAYER_SELECT + " WHERE p.id = ? GROUP BY p.id").param(id)
                .query((rs, _) -> playerRow(rs, rooms, cutoff))
                .optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No such player"));
        List<PlayerGame> games = db.sql("""
                SELECT g.id, g.map_id, g.solo, g.party_size, g.started_at, g.ended_at, g.end_reason, g.round,
                       gp.kills, gp.points, gp.left_at
                FROM game_players gp JOIN games g ON g.id = gp.game_id
                WHERE gp.player_id = ? ORDER BY g.started_at DESC LIMIT 100""")
                .param(id)
                .query((rs, _) -> new PlayerGame(rs.getObject(1, UUID.class), rs.getString(2), rs.getBoolean(3), rs.getInt(4),
                        instant(rs, 5), instant(rs, 6), rs.getString(7), (Integer) rs.getObject(8), rs.getInt(9), rs.getInt(10),
                        instant(rs, 11)))
                .list();
        return new PlayerDetail(row, games);
    }

    private static PlayerRow playerRow(ResultSet rs, Map<UUID, String> rooms, Instant cutoff) throws SQLException {
        UUID id = rs.getObject(1, UUID.class);
        Instant seen = instant(rs, 4);
        String room = rooms.get(id);
        return new PlayerRow(id, rs.getString(2), instant(rs, 3), seen, room != null || (seen != null && seen.isAfter(cutoff)),
                room, rs.getLong(5), rs.getInt(6), rs.getLong(7));
    }

    // ------------------------------------------------------------- helpers

    private long count(String sql, Object param) {
        var spec = db.sql(sql);
        if (param != null) spec = spec.param(param);
        return spec.query(Long.class).single();
    }

    private static int clampLimit(Integer limit, int fallback) {
        return Math.clamp(limit == null ? fallback : limit, 1, MAX_LIMIT);
    }

    private static Instant instant(ResultSet rs, int col) throws SQLException {
        Timestamp t = rs.getTimestamp(col);
        return t == null ? null : t.toInstant();
    }
}
