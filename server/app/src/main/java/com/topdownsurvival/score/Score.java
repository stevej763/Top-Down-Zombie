package com.topdownsurvival.score;

import com.topdownsurvival.player.Player;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "scores")
public class Score {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "player_id")
    private Player player;

    @Column(name = "map_id", nullable = false)
    private String mapId;

    @Column(nullable = false)
    private int round;

    @Column(nullable = false)
    private int kills;

    @Column(nullable = false)
    private int points;

    @Column(name = "party_size", nullable = false)
    private int partySize;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected Score() {}

    public Score(Player player, String mapId, int round, int kills, int points, int partySize) {
        this.player = player;
        this.mapId = mapId;
        this.round = round;
        this.kills = kills;
        this.points = points;
        this.partySize = partySize;
        this.createdAt = Instant.now();
    }

    public Long getId() { return id; }
    public Player getPlayer() { return player; }
    public String getMapId() { return mapId; }
    public int getRound() { return round; }
    public int getKills() { return kills; }
    public int getPoints() { return points; }
    public int getPartySize() { return partySize; }
    public Instant getCreatedAt() { return createdAt; }
}
