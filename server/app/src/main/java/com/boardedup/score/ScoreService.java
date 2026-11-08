package com.boardedup.score;

import com.boardedup.game.ScoreRecorder;
import com.boardedup.player.PlayerRepository;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Writes the scores of a finished game, one row per player. */
@Service
public class ScoreService implements ScoreRecorder {
    private final ScoreRepository scores;
    private final PlayerRepository players;

    public ScoreService(ScoreRepository scores, PlayerRepository players) {
        this.scores = scores;
        this.players = players;
    }

    @Override
    @Transactional
    public List<Integer> record(String mapId, int round, int partySize, List<Result> results) {
        List<Score> saved = new ArrayList<>();
        for (Result r : results) {
            saved.add(scores.save(new Score(players.getReferenceById(r.playerId()), mapId, round, r.kills(), r.points(), partySize)));
        }
        scores.flush();
        return saved.stream().map(s -> (int) scores.countAhead(mapId, s.getRound(), s.getKills(), s.getPoints(), s.getId())).toList();
    }
}
