package com.topdownsurvival.player;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/players")
public class PlayerController {
    /** 1–20 letters, digits, spaces and a little punctuation, with no leading or trailing space. */
    static final String NAME_PATTERN = "^[\\p{L}\\p{N}_.'-]([\\p{L}\\p{N} _.'-]{0,18}[\\p{L}\\p{N}_.'-])?$";

    public record NameRequest(@NotNull @Pattern(regexp = NAME_PATTERN) String name) {}

    public record PlayerCreated(UUID playerId, String name, String token) {}

    public record PlayerView(UUID playerId, String name) {}

    private final PlayerRepository players;
    private final PlayerAuth auth;

    public PlayerController(PlayerRepository players, PlayerAuth auth) {
        this.players = players;
        this.auth = auth;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public PlayerCreated create(@Valid @RequestBody NameRequest req) {
        String token = auth.newToken();
        Player p = players.save(new Player(req.name(), auth.hash(token)));
        return new PlayerCreated(p.getId(), p.getName(), token);
    }

    @PatchMapping("/me")
    @Transactional
    public PlayerView rename(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @Valid @RequestBody NameRequest req) {
        Player p = auth.require(authorization);
        p.setName(req.name());
        players.save(p);
        return new PlayerView(p.getId(), p.getName());
    }
}
