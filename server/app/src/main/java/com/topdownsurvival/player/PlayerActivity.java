package com.topdownsurvival.player;

import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/**
 * Keeps {@code players.last_seen_at} current: the app's heartbeat and every socket opening or
 * closing. Writes at most once per {@link #THROTTLE_SECONDS} per player, and never on the caller's
 * thread for socket events.
 */
@Component
public class PlayerActivity implements DisposableBean {
    private static final Logger log = LoggerFactory.getLogger(PlayerActivity.class);
    static final int THROTTLE_SECONDS = 20;

    private final JdbcClient db;
    private final ExecutorService background = Executors.newVirtualThreadPerTaskExecutor();

    public PlayerActivity(JdbcClient db) {
        this.db = db;
    }

    public void seen(UUID player) {
        db.sql("""
                UPDATE players SET last_seen_at = now()
                WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < now() - make_interval(secs => ?))""")
                .params(player, THROTTLE_SECONDS)
                .update();
    }

    /** {@link #seen}, off the caller's thread; failures are only logged. */
    public void seenLater(UUID player) {
        try {
            background.execute(() -> {
                try {
                    seen(player);
                } catch (RuntimeException e) {
                    log.debug("Couldn't record activity for {}: {}", player, e.toString());
                }
            });
        } catch (RejectedExecutionException e) {
            // Shutting down.
        }
    }

    @Override
    public void destroy() {
        background.shutdown();
    }
}
