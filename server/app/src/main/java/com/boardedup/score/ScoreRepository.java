package com.boardedup.score;

import java.util.List;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface ScoreRepository extends JpaRepository<Score, Long> {
    /** Same ordering as the client's leaderboard: round, then kills, then points. */
    @Query("""
            select s from Score s join fetch s.player
            where s.mapId = :mapId
            order by s.round desc, s.kills desc, s.points desc, s.createdAt asc
            """)
    List<Score> leaderboard(String mapId, Limit limit);
}
