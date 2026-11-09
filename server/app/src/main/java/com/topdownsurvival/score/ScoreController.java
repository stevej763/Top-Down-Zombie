package com.topdownsurvival.score;

import java.util.List;
import org.springframework.data.domain.Limit;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Read-only: game rooms write scores themselves at game over ({@link ScoreService}). */
@RestController
@RequestMapping("/api/scores")
public class ScoreController {
    static final String MAP_ID_PATTERN = "^[a-z0-9-]{1,40}$";
    private static final int MAX_LIMIT = 100;

    /** {@code date} is epoch ms, matching the client's ScoreEntry. */
    public record ScoreView(long id, String name, int round, int kills, int points, int partySize, long date) {
        static ScoreView of(Score s) {
            return new ScoreView(s.getId(), s.getPlayer().getName(), s.getRound(), s.getKills(), s.getPoints(),
                    s.getPartySize(), s.getCreatedAt().toEpochMilli());
        }
    }

    private final ScoreRepository scores;

    public ScoreController(ScoreRepository scores) {
        this.scores = scores;
    }

    @GetMapping
    public List<ScoreView> leaderboard(
            @RequestParam(defaultValue = "house") String map,
            @RequestParam(defaultValue = "10") int limit) {
        if (!map.matches(MAP_ID_PATTERN)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Bad map id");
        int n = Math.clamp(limit, 1, MAX_LIMIT);
        return scores.leaderboard(map, Limit.of(n)).stream().map(ScoreView::of).toList();
    }
}
