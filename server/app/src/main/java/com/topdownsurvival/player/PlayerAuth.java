package com.topdownsurvival.player;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Issues bearer tokens and resolves them back to players. Only each token's SHA-256 is stored, one
 * row per signed-in device in {@code player_tokens}, so signing out one device leaves the others.
 */
@Component
public class PlayerAuth {
    private static final String BEARER = "Bearer ";
    /** last_used_at is only rewritten this often, so every request doesn't write. */
    private static final Duration TOUCH_EVERY = Duration.ofMinutes(1);

    private final SecureRandom random = new SecureRandom();
    private final PlayerRepository players;
    private final JdbcClient db;
    private final InstantSource clock;

    public PlayerAuth(PlayerRepository players, JdbcClient db, InstantSource clock) {
        this.players = players;
        this.db = db;
        this.clock = clock;
    }

    /** A new token for this player (a new device signing in). */
    public String issue(UUID player) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Timestamp now = Timestamp.from(clock.instant());
        db.sql("INSERT INTO player_tokens (token_hash, player_id, created_at, last_used_at) VALUES (?, ?, ?, ?)")
                .params(hash(token), player, now, now)
                .update();
        return token;
    }

    /** The player a raw token belongs to, if any. */
    public Optional<Player> find(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        byte[] hash = hash(token.trim());
        record Row(UUID player, Instant lastUsed) {}
        Optional<Row> row = db.sql("SELECT player_id, last_used_at FROM player_tokens WHERE token_hash = ?")
                .param(hash)
                .query((rs, _) -> new Row(rs.getObject(1, UUID.class), rs.getTimestamp(2).toInstant()))
                .optional();
        if (row.isEmpty()) return Optional.empty();
        Instant now = clock.instant();
        if (row.get().lastUsed().plus(TOUCH_EVERY).isBefore(now)) {
            db.sql("UPDATE player_tokens SET last_used_at = ? WHERE token_hash = ?").params(Timestamp.from(now), hash).update();
        }
        return players.findById(row.get().player());
    }

    /** The player for an {@code Authorization: Bearer ...} header, or 401. */
    public Player require(String authorization) {
        String token = bearer(authorization);
        if (token == null) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing bearer token");
        return find(token).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unknown token"));
    }

    /** Signs this token's device out. */
    public void revoke(String token) {
        if (token != null && !token.isBlank()) db.sql("DELETE FROM player_tokens WHERE token_hash = ?").param(hash(token.trim())).update();
    }

    /** Signs out every device of this player but the one holding {@code keep}. */
    public void revokeOthers(UUID player, String keep) {
        db.sql("DELETE FROM player_tokens WHERE player_id = ? AND token_hash <> ?")
                .params(player, hash(keep == null ? "" : keep.trim()))
                .update();
    }

    /** The raw token from an {@code Authorization: Bearer ...} header, or null. */
    public static String bearer(String authorization) {
        return authorization != null && authorization.startsWith(BEARER) ? authorization.substring(BEARER.length()) : null;
    }

    static byte[] hash(String token) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
