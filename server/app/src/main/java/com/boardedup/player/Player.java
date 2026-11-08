package com.boardedup.player;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "players")
public class Player {
    @Id
    private UUID id;

    @Column(nullable = false, length = 20)
    private String name;

    /** SHA-256 of the bearer token. The token itself is never stored. */
    @Column(name = "token_hash", nullable = false, unique = true)
    private byte[] tokenHash;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected Player() {}

    public Player(String name, byte[] tokenHash) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.tokenHash = tokenHash;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}
