package com.topdownsurvival.player;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/players")
public class PlayerController {
    /** 1–20 letters, digits, spaces and a little punctuation, with no leading or trailing space. */
    static final String NAME_PATTERN = "^[\\p{L}\\p{N}_.'-]([\\p{L}\\p{N} _.'-]{0,18}[\\p{L}\\p{N}_.'-])?$";

    public record NameRequest(@NotNull @Pattern(regexp = NAME_PATTERN) String name) {}

    public record RegisterRequest(@NotNull String email, @NotNull @Pattern(regexp = NAME_PATTERN) String username,
            @NotNull String password) {}

    public record LoginRequest(String email, String password) {}

    public record PasswordRequest(String current, String password) {}

    public record CodeRequest(String code) {}

    /** {@code verified}: an account that has confirmed its email; until then it plays under guest rules. */
    public record PlayerCreated(UUID playerId, String name, String token, boolean account, boolean verified) {}

    public record PlayerView(UUID playerId, String name, boolean account, String email, boolean verified) {
        static PlayerView of(Player p) {
            return new PlayerView(p.getId(), p.getName(), p.isAccount(), p.getEmail(), p.isVerified());
        }
    }

    private final PlayerAuth auth;
    private final PlayerAccounts accounts;
    private final PlayerActivity activity;
    private final EmailVerification verification;

    public PlayerController(PlayerAuth auth, PlayerAccounts accounts, PlayerActivity activity, EmailVerification verification) {
        this.auth = auth;
        this.accounts = accounts;
        this.activity = activity;
        this.verification = verification;
    }

    /** A guest: just a name. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public PlayerCreated create(@Valid @RequestBody NameRequest req, HttpServletRequest request) {
        PlayerAccounts.SignedIn s = accounts.guest(req.name());
        activity.registered(s.player().getId(), request.getRemoteAddr());
        return created(s);
    }

    /** A new account, or (with a guest's token) the guest becoming one, keeping their scores. */
    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public PlayerCreated register(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @Valid @RequestBody RegisterRequest req, HttpServletRequest request) {
        String token = PlayerAuth.bearer(authorization);
        Player guest = auth.find(token).orElse(null);
        PlayerAccounts.SignedIn s = accounts.register(guest, token, req.email(), req.username(), req.password());
        if (guest == null) activity.registered(s.player().getId(), request.getRemoteAddr());
        // After register's transaction, so a signup that fails never sends a code.
        verification.send(s.player());
        return created(s);
    }

    @PostMapping("/login")
    public PlayerCreated login(@RequestBody LoginRequest req, HttpServletRequest request) {
        return created(accounts.login(req.email(), req.password(), request.getRemoteAddr()));
    }

    /** Signs this device out. */
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        auth.revoke(PlayerAuth.bearer(authorization));
    }

    @GetMapping("/me")
    public PlayerView me(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        return PlayerView.of(auth.require(authorization));
    }

    @PatchMapping("/me")
    public PlayerView rename(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @Valid @RequestBody NameRequest req) {
        Player p = auth.require(authorization);
        accounts.rename(p, req.name());
        return PlayerView.of(p);
    }

    @PatchMapping("/me/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @RequestBody PasswordRequest req) {
        accounts.changePassword(auth.require(authorization), PlayerAuth.bearer(authorization), req.current(), req.password());
    }

    /** Checks the code the account was emailed. */
    @PostMapping("/me/verify")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void verify(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @RequestBody CodeRequest req) {
        verification.verify(auth.require(authorization), req.code());
    }

    /** Emails a new code (429 if asked again within a minute, or too often in a day). */
    @PostMapping("/me/verify/resend")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resendCode(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        verification.send(auth.require(authorization));
    }

    /**
     * The app's heartbeat while it's open, so the admin portal can show who's online, from where and
     * on what. The body (the device) is optional.
     */
    @PostMapping("/me/seen")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void seen(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @RequestHeader(value = HttpHeaders.USER_AGENT, required = false) String userAgent,
            @RequestBody(required = false) PlayerActivity.DeviceReport device, HttpServletRequest request) {
        activity.seen(auth.require(authorization).getId(), request.getRemoteAddr(), userAgent, device);
    }

    /** Errors carry their reason as {@code message}, which the game shows as is. */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> refused(ResponseStatusException e) {
        String reason = e.getReason() != null ? e.getReason() : e.getStatusCode().toString();
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("status", e.getStatusCode().value(), "message", reason));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> invalid(MethodArgumentNotValidException e) {
        boolean badName = e.getFieldErrors().stream().anyMatch(f -> f.getField().equals("name") || f.getField().equals("username"));
        String message = badName ? "Names are 1–20 letters, numbers, spaces and . _ ' -" : "Fill in every field";
        return ResponseEntity.badRequest().body(Map.of("status", 400, "message", message));
    }

    /** Two signups racing for the same email or username: the unique index catches the loser. */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Map<String, Object>> conflict(DataIntegrityViolationException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("status", 409, "message", "That email or username is taken"));
    }

    private static PlayerCreated created(PlayerAccounts.SignedIn s) {
        return new PlayerCreated(s.player().getId(), s.player().getName(), s.token(), s.player().isAccount(), s.player().isVerified());
    }
}
