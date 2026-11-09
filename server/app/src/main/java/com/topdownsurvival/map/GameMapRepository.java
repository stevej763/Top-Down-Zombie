package com.topdownsurvival.map;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GameMapRepository extends JpaRepository<GameMap, String> {
    List<GameMap> findByPublishedTrueOrderByName();
}
