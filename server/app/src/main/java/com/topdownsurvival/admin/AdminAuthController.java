package com.topdownsurvival.admin;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Admin login, logout, password and accounts. */
@RestController
@RequestMapping("/api/admin")
public class AdminAuthController {
    public record LoginRequest(String username, String password) {}

    public record PasswordRequest(String current, String next) {}

    public record AdminView(UUID id, String username, java.time.Instant createdAt, java.time.Instant lastLoginAt) {}

    private final AdminAuth auth;
    private final JdbcClient db;

    public AdminAuthController(AdminAuth auth, JdbcClient db) {
        this.auth = auth;
        this.db = db;
    }

    @PostMapping("/login")
    public AdminAuth.Admin login(@RequestBody LoginRequest req, HttpServletRequest request, HttpServletResponse response) {
        AdminAuth.requireCsrf(request);
        AdminAuth.Session s = auth.login(req.username(), req.password(), request.getRemoteAddr());
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(s.token(), AdminAuth.LIFETIME, request).toString());
        return s.admin();
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        AdminAuth.requireCsrf(request);
        auth.logout(request);
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO, request).toString());
    }

    @GetMapping("/me")
    public AdminAuth.Admin me(HttpServletRequest request) {
        return auth.require(request);
    }

    @PostMapping("/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void password(@RequestBody PasswordRequest req, HttpServletRequest request) {
        auth.changePassword(auth.require(request), req.current(), req.next(), request);
    }

    @GetMapping("/admins")
    public List<AdminView> admins(HttpServletRequest request) {
        auth.require(request);
        return db.sql("SELECT id, username, created_at, last_login_at FROM admin_users ORDER BY username")
                .query((rs, _) -> new AdminView(rs.getObject(1, UUID.class), rs.getString(2), rs.getTimestamp(3).toInstant(),
                        rs.getTimestamp(4) == null ? null : rs.getTimestamp(4).toInstant()))
                .list();
    }

    @PostMapping("/admins")
    @ResponseStatus(HttpStatus.CREATED)
    public AdminAuth.Admin addAdmin(@RequestBody LoginRequest req, HttpServletRequest request) {
        auth.require(request);
        return auth.create(req.username(), req.password());
    }

    @DeleteMapping("/admins/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeAdmin(@PathVariable UUID id, HttpServletRequest request) {
        AdminAuth.Admin me = auth.require(request);
        if (me.id().equals(id)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "You can't remove yourself");
        if (db.sql("DELETE FROM admin_users WHERE id = ?").param(id).update() == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such admin");
        }
    }

    /** HttpOnly and SameSite=Strict; Secure whenever the portal is reached over https. */
    private static ResponseCookie cookie(String value, Duration maxAge, HttpServletRequest request) {
        return ResponseCookie.from(AdminAuth.COOKIE, value)
                .httpOnly(true)
                .secure(request.isSecure())
                .sameSite("Strict")
                .path("/")
                .maxAge(maxAge)
                .build();
    }
}
