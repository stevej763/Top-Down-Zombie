package com.topdownsurvival.score;

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

    /** How many scores rank above this one in {@link #leaderboard}, i.e. its 0-based position. */
    @Query("""
            select count(s) from Score s
            where s.mapId = :mapId and (s.round > :round
                or (s.round = :round and (s.kills > :kills
                or (s.kills = :kills and (s.points > :points
                or (s.points = :points and s.id < :id))))))
            """)
    long countAhead(String mapId, int round, int kills, int points, long id);
}
