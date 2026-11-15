package com.topdownsurvival.admin;

import com.topdownsurvival.auth.LoginThrottle;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Base64;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Admin logins and sessions. A session is a random cookie of which only the SHA-256 is stored (as
 * with player tokens). Sessions end after {@link #IDLE} unused or {@link #LIFETIME} at most. Every
 * request that changes something must also carry {@code X-Requested-With: admin}, which a
 * cross-site form can't send, on top of the SameSite=Strict cookie.
 */
@Component
public class AdminAuth {
    public static final String COOKIE = "tds_admin";
    public static final String CSRF_HEADER = "X-Requested-With";
    public static final String CSRF_VALUE = "admin";
    static final Duration IDLE = Duration.ofHours(12);
    static final Duration LIFETIME = Duration.ofDays(7);
    /** last_used_at is only rewritten this often, so every request doesn't write. */
    private static final Duration TOUCH_EVERY = Duration.ofMinutes(1);
    static final int MIN_PASSWORD = 10;

    /** Failures allowed per username before each further attempt waits (see {@link LoginThrottle}). */
    static final int FREE_FAILURES = LoginThrottle.FREE_FAILURES;

    public record Admin(UUID id, String username) {}

    public record Session(String token, Admin admin) {}

    private final JdbcClient db;
    private final InstantSource clock;
    private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();
    private final SecureRandom random = new SecureRandom();
    /** Checked against when the username is unknown, so a miss takes as long as a wrong password. */
    private final String dummyHash;
    private final LoginThrottle throttle = new LoginThrottle();

    public AdminAuth(JdbcClient db, InstantSource clock) {
        this.db = db;
        this.clock = clock;
        this.dummyHash = bcrypt.encode("not-a-real-password");
    }

    // ------------------------------------------------------------- sessions

    /** Checks the password and opens a session, or throws 401 (or 429 while locked out). */
    public Session login(String username, String password, String ip) {
        String user = normalize(username);
        Instant now = clock.instant();
        throttle.check(user, ip, now);
        var row = db.sql("SELECT id, username, password_hash FROM admin_users WHERE username = ?")
                .param(user)
                .query((rs, _) -> new Object[] {rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3)})
                .optional();
        boolean ok = bcrypt.matches(password == null ? "" : password, row.map(r -> (String) r[2]).orElse(dummyHash));
        if (row.isEmpty() || !ok) {
            throttle.failed(user, ip, now);
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Wrong username or password");
        }
        throttle.succeeded(user, ip);
        Admin admin = new Admin((UUID) row.get()[0], (String) row.get()[1]);
        String token = newToken();
        db.sql("INSERT INTO admin_sessions (id, token_hash, admin_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)")
                .params(UUID.randomUUID(), hash(token), admin.id(), ts(now), ts(now.plus(LIFETIME)), ts(now))
                .update();
        db.sql("UPDATE admin_users SET last_login_at = ? WHERE id = ?").params(ts(now), admin.id()).update();
        db.sql("DELETE FROM admin_sessions WHERE expires_at < ? OR last_used_at < ?")
                .params(ts(now), ts(now.minus(IDLE)))
                .update();
        return new Session(token, admin);
    }

    /** The admin a raw session token belongs to, if it's still live. Refreshes its idle timer. */
    public Optional<Admin> find(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        Instant now = clock.instant();
        record Row(UUID sessionId, Admin admin, Instant lastUsed) {}
        Optional<Row> row = db.sql("""
                SELECT s.id, u.id, u.username, s.last_used_at FROM admin_sessions s JOIN admin_users u ON u.id = s.admin_id
                WHERE s.token_hash = ? AND s.expires_at > ? AND s.last_used_at > ?""")
                .params(hash(token), ts(now), ts(now.minus(IDLE)))
                .query((rs, _) -> new Row(rs.getObject(1, UUID.class), new Admin(rs.getObject(2, UUID.class), rs.getString(3)),
                        rs.getTimestamp(4).toInstant()))
                .optional();
        row.filter(r -> r.lastUsed().plus(TOUCH_EVERY).isBefore(now))
                .ifPresent(r -> db.sql("UPDATE admin_sessions SET last_used_at = ? WHERE id = ?").params(ts(now), r.sessionId()).update());
        return row.map(Row::admin);
    }

    /** The logged-in admin for this request, or 401. Requests that change something also need the CSRF header. */
    public Admin require(HttpServletRequest request) {
        requireCsrf(request);
        return find(cookie(request)).orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not logged in"));
    }

    public static void requireCsrf(HttpServletRequest request) {
        String m = request.getMethod();
        boolean safe = m.equals("GET") || m.equals("HEAD") || m.equals("OPTIONS");
        if (!safe && !CSRF_VALUE.equals(request.getHeader(CSRF_HEADER))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Missing " + CSRF_HEADER + " header");
        }
    }

    public void logout(HttpServletRequest request) {
        String token = cookie(request);
        if (token != null) db.sql("DELETE FROM admin_sessions WHERE token_hash = ?").param(hash(token)).update();
    }

    public static String cookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) if (COOKIE.equals(c.getName())) return c.getValue();
        return null;
    }

    // ------------------------------------------------------------- accounts

    /** Creates an admin, or throws 400/409. */
    public Admin create(String username, String password) {
        String user = normalize(username);
        if (!user.matches("[a-z0-9_.-]{3,32}")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Usernames are 3–32 letters, digits, _ . or -");
        }
        checkPassword(password);
        if (db.sql("SELECT count(*) FROM admin_users WHERE username = ?").param(user).query(Long.class).single() > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That username is taken");
        }
        return insert(user, password);
    }

    /** No checks: the first admin from the environment is whatever the operator chose. */
    Admin insert(String username, String password) {
        String user = normalize(username);
        UUID id = UUID.randomUUID();
        db.sql("INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)")
                .params(id, user, bcrypt.encode(password))
                .update();
        return new Admin(id, user);
    }

    /** Changes an admin's password and ends their other sessions. */
    public void changePassword(Admin admin, String current, String next, HttpServletRequest request) {
        String hash = db.sql("SELECT password_hash FROM admin_users WHERE id = ?").param(admin.id()).query(String.class).single();
        if (current == null || !bcrypt.matches(current, hash)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Current password is wrong");
        }
        checkPassword(next);
        db.sql("UPDATE admin_users SET password_hash = ? WHERE id = ?").params(bcrypt.encode(next), admin.id()).update();
        String token = cookie(request);
        db.sql("DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash <> ?")
                .params(admin.id(), hash(token == null ? "" : token))
                .update();
    }

    public long count() {
        return db.sql("SELECT count(*) FROM admin_users").query(Long.class).single();
    }

    private static void checkPassword(String password) {
        if (password == null || password.length() < MIN_PASSWORD) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Passwords need at least " + MIN_PASSWORD + " characters");
        }
    }

    static String normalize(String username) {
        return username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
    }

    private String newToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static byte[] hash(String token) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Timestamp ts(Instant i) {
        return Timestamp.from(i);
    }
}
