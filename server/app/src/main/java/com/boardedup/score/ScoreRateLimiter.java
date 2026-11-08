package com.boardedup.score;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Sliding one-minute window per player. In memory, so it resets on restart; that's fine while
 * scores are client-submitted and the server is a single instance.
 */
@Component
public class ScoreRateLimiter {
    private static final Duration WINDOW = Duration.ofMinutes(1);

    private final int perMinute;
    private final Map<UUID, Deque<Instant>> recent = new ConcurrentHashMap<>();

    public ScoreRateLimiter(@Value("${boarded-up.score-rate-limit}") int perMinute) {
        this.perMinute = perMinute;
    }

    public boolean tryAcquire(UUID playerId) {
        Instant now = Instant.now();
        Deque<Instant> times = recent.computeIfAbsent(playerId, _ -> new ArrayDeque<>());
        synchronized (times) {
            while (!times.isEmpty() && times.peekFirst().isBefore(now.minus(WINDOW))) times.pollFirst();
            if (times.size() >= perMinute) return false;
            times.addLast(now);
            return true;
        }
    }
}
