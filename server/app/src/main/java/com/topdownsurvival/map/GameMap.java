package com.topdownsurvival.map;

import com.topdownsurvival.sim.map.MapDoc;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "maps")
public class GameMap {
    @Id
    private String id;

    @Column(nullable = false)
    private String name;

    /** Bumped on every change, so clients and rooms can tell maps apart. */
    @Column(nullable = false)
    private int version;

    /** The {@link MapDoc} as JSON. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String data;

    @Column(nullable = false)
    private boolean published = true;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected GameMap() {}

    public GameMap(String id) {
        this.id = id;
        this.createdAt = Instant.now();
    }

    public void update(String name, String data) {
        this.name = name;
        this.data = data;
        this.version++;
        this.updatedAt = Instant.now();
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public int getVersion() { return version; }
    public String getData() { return data; }
    public boolean isPublished() { return published; }
}
