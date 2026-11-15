package com.topdownsurvival.player;

import com.topdownsurvival.auth.LoginThrottle;
import java.nio.charset.StandardCharsets;
import java.time.InstantSource;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Accounts: a guest becoming one (or a new one), signing in with email and password, and the rules
 * on names. Account names are unique among accounts, and guests can't take one.
 */
@Component
public class PlayerAccounts {
    static final int MIN_PASSWORD = 8;
    /** BCrypt only reads the first 72 bytes, and Spring's encoder refuses longer. */
    static final int MAX_PASSWORD_BYTES = 72;
    static final int MAX_EMAIL = 254;
    /** Deliberately loose: the address isn't verified yet, so this only catches typos like a missing @. */
    private static final String EMAIL_PATTERN = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$";

    public record SignedIn(Player player, String token) {}

    private final PlayerRepository players;
    private final PlayerAuth auth;
    private final InstantSource clock;
    private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();
    private final LoginThrottle throttle = new LoginThrottle();
    /** Checked against when the email is unknown, so a miss takes as long as a wrong password. */
    private final String dummyHash;

    public PlayerAccounts(PlayerRepository players, PlayerAuth auth, InstantSource clock) {
        this.players = players;
        this.auth = auth;
        this.clock = clock;
        this.dummyHash = bcrypt.encode("not-a-real-password");
    }

    /** A new guest, or 409 if the name belongs to an account. */
    @Transactional
    public SignedIn guest(String name) {
        Player p = new Player(name);
        checkName(p, name);
        // Flushed now: the token row refers to it.
        players.saveAndFlush(p);
        return new SignedIn(p, auth.issue(p.getId()));
    }

    /**
     * Makes {@code guest} an account, keeping its id, scores and token, or creates a new account
     * (with a new token) when there's no guest.
     */
    @Transactional
    public SignedIn register(Player guest, String token, String email, String name, String password) {
        if (guest != null && guest.isAccount()) throw new ResponseStatusException(HttpStatus.CONFLICT, "Already signed in to an account");
        String mail = normalizeEmail(email);
        if (mail.length() > MAX_EMAIL || !mail.matches(EMAIL_PATTERN)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "That doesn't look like an email address");
        }
        checkPassword(password);
        if (players.findByEmail(mail).isPresent()) throw new ResponseStatusException(HttpStatus.CONFLICT, "That email already has an account");
        Player p = guest != null ? guest : new Player(name);
        if (players.accountNameTaken(name, p.getId())) throw new ResponseStatusException(HttpStatus.CONFLICT, "That username is taken");
        p.becomeAccount(mail, name, bcrypt.encode(password), clock.instant());
        players.saveAndFlush(p);
        return new SignedIn(p, guest != null ? token : auth.issue(p.getId()));
    }

    /** A new token for the account, or 401 (429 while locked out). */
    @Transactional
    public SignedIn login(String email, String password, String ip) {
        String mail = normalizeEmail(email);
        throttle.check(mail, ip, clock.instant());
        var player = players.findByEmail(mail);
        boolean ok = bcrypt.matches(password == null ? "" : password, player.map(Player::getPasswordHash).orElse(dummyHash));
        if (player.isEmpty() || !ok) {
            throttle.failed(mail, ip, clock.instant());
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Wrong email or password");
        }
        throttle.succeeded(mail, ip);
        return new SignedIn(player.get(), auth.issue(player.get().getId()));
    }

    @Transactional
    public void rename(Player p, String name) {
        checkName(p, name);
        p.setName(name);
        players.saveAndFlush(p);
    }

    /** Changes an account's password and signs out its other devices. */
    @Transactional
    public void changePassword(Player p, String token, String current, String next) {
        if (!p.isAccount()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Guests have no password");
        if (current == null || !bcrypt.matches(current, p.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Current password is wrong");
        }
        checkPassword(next);
        p.setPasswordHash(bcrypt.encode(next));
        players.save(p);
        auth.revokeOthers(p.getId(), token);
    }

    private void checkName(Player p, String name) {
        if (!players.accountNameTaken(name, p.getId())) return;
        throw new ResponseStatusException(HttpStatus.CONFLICT, p.isAccount() ? "That username is taken" : "That name belongs to an account");
    }

    private static void checkPassword(String password) {
        if (password == null || password.length() < MIN_PASSWORD) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Passwords need at least " + MIN_PASSWORD + " characters");
        }
        if (password.getBytes(StandardCharsets.UTF_8).length > MAX_PASSWORD_BYTES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "That password is too long");
        }
    }

    static String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }
}
