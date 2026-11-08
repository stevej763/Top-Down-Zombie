package com.boardedup.game;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Component;

/**
 * Runs every room's tick on one shared pool. A fixed-rate task never overlaps itself, so each room
 * stays single-threaded.
 */
@Component
public class RoomTicker implements LobbyService.Ticker, DisposableBean {
    private static final Logger log = LoggerFactory.getLogger(RoomTicker.class);
    private static final long PERIOD_NANOS = 1_000_000_000L / GameRoom.TICK_HZ;

    private final ScheduledExecutorService pool = Executors.newScheduledThreadPool(
            Math.max(2, Runtime.getRuntime().availableProcessors()), Thread.ofPlatform().name("room-tick-", 0).daemon().factory());

    @Override
    public Runnable start(Runnable tick) {
        ScheduledFuture<?> f = pool.scheduleAtFixedRate(() -> guarded(tick), PERIOD_NANOS, PERIOD_NANOS, TimeUnit.NANOSECONDS);
        return () -> f.cancel(false);
    }

    /** A fixed-rate task that throws is never run again, which would freeze its room for good, so nothing escapes. */
    static void guarded(Runnable tick) {
        try {
            tick.run();
        } catch (Throwable e) {
            log.error("Room tick failed", e);
        }
    }

    @Override
    public void destroy() {
        pool.shutdownNow();
    }
}
