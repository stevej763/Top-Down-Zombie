package com.topdownsurvival.player;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PlayerRepository extends JpaRepository<Player, UUID> {
    Optional<Player> findByTokenHash(byte[] tokenHash);
}
