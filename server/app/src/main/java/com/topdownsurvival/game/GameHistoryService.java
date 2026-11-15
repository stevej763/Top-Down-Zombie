package com.topdownsurvival.game;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Writes the games and game_players tables that the admin portal reads. */
@Service
public class GameHistoryService implements GameRecorder {
    private static final Logger log = LoggerFactory.getLogger(GameHistoryService.class);

    private final JdbcClient db;

    public GameHistoryService(JdbcClient db) {
        this.db = db;
    }

    @Override
    @Transactional
    public void started(GameStart game) {
        db.sql("""
                INSERT INTO games (id, room_code, map_id, map_version, solo, seed, party_size, started_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""")
                .params(game.gameId(), game.roomCode(), game.mapId(), game.mapVersion(), game.solo(), game.seed(),
                        game.seats().size(), ts(game.startedAt()))
                .update();
        for (Seat s : game.seats()) {
            db.sql("INSERT INTO game_players (game_id, player_id, sim_id, name) VALUES (?, ?, ?, ?)")
                    .params(game.gameId(), s.playerId(), s.simId(), s.name())
                    .update();
        }
    }

    @Override
    public void left(UUID gameId, Standing standing, Instant at) {
        db.sql("UPDATE game_players SET kills = ?, points = ?, left_at = ? WHERE game_id = ? AND player_id = ?")
                .params(standing.kills(), standing.points(), ts(at), gameId, standing.playerId())
                .update();
    }

    @Override
    @Transactional
    public void ended(UUID gameId, String reason, int round, Instant at, List<Standing> standings) {
        for (Standing s : standings) {
            db.sql("UPDATE game_players SET kills = ?, points = ? WHERE game_id = ? AND player_id = ?")
                    .params(s.kills(), s.points(), gameId, s.playerId())
                    .update();
        }
        db.sql("UPDATE games SET ended_at = ?, end_reason = ?, round = ? WHERE id = ?")
                .params(ts(at), reason, round, gameId)
                .update();
    }

    /** A server that was killed outright never recorded its games' ends; close them off now. */
    @EventListener(ApplicationReadyEvent.class)
    public void closeOrphans() {
        int n = db.sql("UPDATE games SET ended_at = now(), end_reason = 'shutdown' WHERE ended_at IS NULL").update();
        if (n > 0) log.info("Marked {} games left running by the last server as shut down", n);
    }

    private static Timestamp ts(Instant i) {
        return Timestamp.from(i);
    }
}
