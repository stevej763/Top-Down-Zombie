package com.topdownsurvival.auth;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Counts failed logins in memory, per login name and per address. Past the free failures, each
 * further attempt waits, the wait doubling per failure up to {@link #MAX_LOCK}. An address gets more
 * free failures, since several people may share one.
 */
public final class LoginThrottle {
    public static final int FREE_FAILURES = 5;
    public static final int FREE_FAILURES_PER_IP = 20;
    public static final Duration MAX_LOCK = Duration.ofMinutes(15);

    private record Failures(int count, Instant lockedUntil) {}

    private final Map<String, Failures> failures = new ConcurrentHashMap<>();

    /** Throws 429 while either key is locked out. */
    public void check(String login, String ip, Instant now) {
        for (String key : keys(login, ip)) {
            Failures f = failures.get(key);
            if (f != null && f.lockedUntil() != null && now.isBefore(f.lockedUntil())) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many attempts; try again shortly");
            }
        }
    }

    public void failed(String login, String ip, Instant now) {
        String[] keys = keys(login, ip);
        failed(keys[0], FREE_FAILURES, now);
        failed(keys[1], FREE_FAILURES_PER_IP, now);
    }

    public void succeeded(String login, String ip) {
        for (String key : keys(login, ip)) failures.remove(key);
    }

    private void failed(String key, int free, Instant now) {
        failures.compute(key, (_, f) -> {
            int count = f == null ? 1 : f.count() + 1;
            if (count <= free) return new Failures(count, null);
            long secs = Math.min(MAX_LOCK.toSeconds(), 1L << Math.min(20, count - free));
            return new Failures(count, now.plusSeconds(secs));
        });
    }

    private static String[] keys(String login, String ip) {
        return new String[] {"u:" + login, "ip:" + ip};
    }
}
