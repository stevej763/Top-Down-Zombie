package com.topdownsurvival.player;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface PlayerRepository extends JpaRepository<Player, UUID> {
    @Query("SELECT p FROM Player p WHERE lower(p.email) = lower(?1)")
    Optional<Player> findByEmail(String email);

    /** Whether an account other than {@code except} already has this name, ignoring case. */
    @Query("SELECT count(p) > 0 FROM Player p WHERE p.email IS NOT NULL AND lower(p.name) = lower(?1) AND p.id <> ?2")
    boolean accountNameTaken(String name, UUID except);
}
