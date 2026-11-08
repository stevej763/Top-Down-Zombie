package com.boardedup.score;

import com.boardedup.player.Player;
import com.boardedup.player.PlayerAuth;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.List;
import org.springframework.data.domain.Limit;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/scores")
public class ScoreController {
    static final String MAP_ID_PATTERN = "^[a-z0-9-]{1,40}$";
    private static final int MAX_LIMIT = 100;

    public record ScoreSubmission(
            @NotNull @Pattern(regexp = MAP_ID_PATTERN) String mapId,
            @Min(0) @Max(10_000) int round,
            @Min(0) @Max(10_000_000) int kills,
            @Min(0) @Max(1_000_000_000) int points) {}

    /** {@code date} is epoch ms, matching the client's ScoreEntry. */
    public record ScoreView(long id, String name, int round, int kills, int points, int partySize, long date) {
        static ScoreView of(Score s) {
            return new ScoreView(s.getId(), s.getPlayer().getName(), s.getRound(), s.getKills(), s.getPoints(),
                    s.getPartySize(), s.getCreatedAt().toEpochMilli());
        }
    }

    private final ScoreRepository scores;
    private final PlayerAuth auth;
    private final ScoreRateLimiter rateLimiter;

    public ScoreController(ScoreRepository scores, PlayerAuth auth, ScoreRateLimiter rateLimiter) {
        this.scores = scores;
        this.auth = auth;
        this.rateLimiter = rateLimiter;
    }

    @GetMapping
    public List<ScoreView> leaderboard(
            @RequestParam(defaultValue = "house") String map,
            @RequestParam(defaultValue = "10") int limit) {
        if (!map.matches(MAP_ID_PATTERN)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Bad map id");
        int n = Math.clamp(limit, 1, MAX_LIMIT);
        return scores.leaderboard(map, Limit.of(n)).stream().map(ScoreView::of).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ScoreView submit(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @Valid @RequestBody ScoreSubmission req) {
        Player p = auth.require(authorization);
        if (!rateLimiter.tryAcquire(p.getId())) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many score submissions");
        }
        return ScoreView.of(scores.save(new Score(p, req.mapId(), req.round(), req.kills(), req.points(), 1)));
    }
}
