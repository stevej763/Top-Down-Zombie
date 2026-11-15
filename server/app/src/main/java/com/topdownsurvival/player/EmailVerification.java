package com.topdownsurvival.player;

import com.topdownsurvival.mail.Mailer;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Proves an account owns its email: a 6-digit code is mailed to it and typed into the game. Until
 * then the account plays under guest rules. Codes live in {@code email_codes}, one per player,
 * stored only as a hash.
 */
@Component
public class EmailVerification {
    private static final Logger log = LoggerFactory.getLogger(EmailVerification.class);
    static final Duration EXPIRES = Duration.ofMinutes(15);
    static final Duration RESEND_AFTER = Duration.ofSeconds(60);
    /** Wrong guesses before a code is spent; with the daily cap, guessing gets 50 tries in a million a day. */
    static final int MAX_ATTEMPTS = 5;
    static final int MAX_SENDS_PER_DAY = 10;
    private static final Duration DAY = Duration.ofDays(1);

    private final JdbcClient db;
    private final Mailer mailer;
    private final InstantSource clock;
    private final SecureRandom random = new SecureRandom();
    /** SMTP can take seconds, so the request doesn't wait for it. */
    private final ExecutorService outbox = Executors.newVirtualThreadPerTaskExecutor();

    public EmailVerification(JdbcClient db, Mailer mailer, InstantSource clock) {
        this.db = db;
        this.mailer = mailer;
        this.clock = clock;
    }

    private record Sent(Instant sentAt, int sends, Instant windowStart) {}

    /** Mails a new code to the account, replacing any earlier one. 429 if asked again too soon or too often. */
    public void send(Player p) {
        if (!p.isAccount()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Guests have no email");
        if (p.isVerified()) throw new ResponseStatusException(HttpStatus.CONFLICT, "Your email is already verified");
        Instant now = clock.instant();
        Optional<Sent> last = db.sql("SELECT sent_at, sends, window_start FROM email_codes WHERE player_id = ?")
                .param(p.getId())
                .query((rs, _) -> new Sent(rs.getTimestamp(1).toInstant(), rs.getInt(2), rs.getTimestamp(3).toInstant()))
                .optional();
        int sends = 1;
        Instant windowStart = now;
        if (last.isPresent()) {
            Instant again = last.get().sentAt().plus(RESEND_AFTER);
            if (now.isBefore(again)) {
                long wait = Duration.between(now, again).toSeconds() + 1;
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Wait " + wait + " s before asking for another code");
            }
            if (now.isBefore(last.get().windowStart().plus(DAY))) {
                if (last.get().sends() >= MAX_SENDS_PER_DAY) {
                    throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many codes today: try again tomorrow");
                }
                sends = last.get().sends() + 1;
                windowStart = last.get().windowStart();
            }
        }
        String code = "%06d".formatted(random.nextInt(1_000_000));
        db.sql("""
                INSERT INTO email_codes (player_id, email, code_hash, attempts, sent_at, expires_at, sends, window_start)
                VALUES (:player, :email, :hash, 0, :now, :expires, :sends, :window)
                ON CONFLICT (player_id) DO UPDATE SET email = :email, code_hash = :hash, attempts = 0, sent_at = :now,
                    expires_at = :expires, sends = :sends, window_start = :window
                """)
                .param("player", p.getId())
                .param("email", p.getEmail())
                .param("hash", hash(p.getId(), code))
                .param("now", Timestamp.from(now))
                .param("expires", Timestamp.from(now.plus(EXPIRES)))
                .param("sends", sends)
                .param("window", Timestamp.from(windowStart))
                .update();
        String to = p.getEmail();
        String body = "Your Top Down Survival code is " + code + ".\n\nType it into the game to verify your email. It expires in "
                + EXPIRES.toMinutes() + " minutes.\n\nIf you didn't create an account, you can ignore this email.\n";
        outbox.execute(() -> {
            try {
                mailer.send(to, "Your Top Down Survival code: " + code, body);
            } catch (RuntimeException e) {
                log.warn("Couldn't send a verification code to {}", to, e);
            }
        });
    }

    /** Marks the account verified if {@code code} is its live code; 400 with the reason otherwise. */
    public void verify(Player p, String code) {
        if (!p.isAccount()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Guests have no email");
        if (p.isVerified()) return;
        Instant now = clock.instant();
        record Live(String email, byte[] hash, Instant expires, int attempts) {}
        // Counting the try in the same statement as reading the code, so parallel guesses can't share one attempt.
        Optional<Live> live = db.sql("""
                UPDATE email_codes SET attempts = attempts + 1 WHERE player_id = ? AND attempts < ?
                RETURNING email, code_hash, expires_at, attempts
                """)
                .params(p.getId(), MAX_ATTEMPTS)
                .query((rs, _) -> new Live(rs.getString(1), rs.getBytes(2), rs.getTimestamp(3).toInstant(), rs.getInt(4)))
                .optional();
        if (live.isEmpty() || !live.get().email().equals(p.getEmail())) throw refused("Ask for a new code");
        if (!now.isBefore(live.get().expires())) throw refused("That code has expired: ask for a new one");
        String typed = code == null ? "" : code.replaceAll("\\s", "");
        if (!MessageDigest.isEqual(hash(p.getId(), typed), live.get().hash())) {
            throw refused(live.get().attempts() >= MAX_ATTEMPTS ? "Too many wrong codes: ask for a new one" : "That code is wrong");
        }
        db.sql("UPDATE players SET email_verified_at = ? WHERE id = ?").params(Timestamp.from(now), p.getId()).update();
        db.sql("DELETE FROM email_codes WHERE player_id = ?").param(p.getId()).update();
    }

    private static ResponseStatusException refused(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }

    /** Salted with the player, so one table of the million codes' hashes doesn't fit every row. */
    private static byte[] hash(UUID player, String code) {
        return PlayerAuth.hash(player + ":" + code);
    }
}
