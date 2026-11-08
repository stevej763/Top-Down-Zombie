package com.boardedup.player;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Issues anonymous bearer tokens and resolves them back to players. */
@Component
public class PlayerAuth {
    private static final String BEARER = "Bearer ";

    private final SecureRandom random = new SecureRandom();
    private final PlayerRepository players;

    public PlayerAuth(PlayerRepository players) {
        this.players = players;
    }

    public String newToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public byte[] hash(String token) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The player for an {@code Authorization: Bearer ...} header, or 401. */
    public Player require(String authorization) {
        if (authorization == null || !authorization.startsWith(BEARER)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Missing bearer token");
        }
        return players.findByTokenHash(hash(authorization.substring(BEARER.length()).trim()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unknown token"));
    }
}
