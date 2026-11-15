package com.topdownsurvival.player;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Someone who plays. A guest has only a name; an account also has an email and password, and its
 * name is unique among accounts. Bearer tokens are in {@code player_tokens} ({@link PlayerAuth}).
 */
@Entity
@Table(name = "players")
public class Player {
    @Id
    private UUID id;

    @Column(nullable = false, length = 20)
    private String name;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** Null for guests. Not verified yet: for now it's only what an account signs in with. */
    @Column(length = 254)
    private String email;

    @Column(name = "password_hash")
    private String passwordHash;

    /** When the guest became an account (or the account was created). */
    @Column(name = "account_at")
    private Instant accountAt;

    protected Player() {}

    public Player(String name) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getEmail() { return email; }
    String getPasswordHash() { return passwordHash; }
    void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }

    public boolean isAccount() { return email != null; }

    /** Makes this player an account; the caller has checked the email and name are free. */
    void becomeAccount(String email, String name, String passwordHash, Instant now) {
        this.email = email;
        this.name = name;
        this.passwordHash = passwordHash;
        this.accountAt = now;
    }
}
