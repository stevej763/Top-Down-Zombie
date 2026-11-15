package com.topdownsurvival.player;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * Keeps {@code players.last_seen_at} current: the app's heartbeat and every socket opening or
 * closing. Writes at most once per {@link #THROTTLE_SECONDS} per player (sooner if the address
 * changed), and never on the caller's thread for socket events. Also records the addresses players
 * come from ({@code player_ips}) and the devices the heartbeat reports ({@code player_devices}).
 */
@Component
public class PlayerActivity implements DisposableBean {
    private static final Logger log = LoggerFactory.getLogger(PlayerActivity.class);
    static final int THROTTLE_SECONDS = 20;
    /** New device ids past this many per player are ignored (the client makes them up). */
    static final int MAX_DEVICES = 20;
    static final int MAX_DETAILS_CHARS = 4096;
    private static final Set<String> PLATFORMS = Set.of("web", "ios", "android");

    /** What the client says about the device it's running on. Everything but the id is optional. */
    public record DeviceReport(String deviceId, String platform, String os, String browser, String model,
            Map<String, Object> details) {}

    private final JdbcClient db;
    private final JsonMapper json;
    private final ExecutorService background = Executors.newVirtualThreadPerTaskExecutor();

    public PlayerActivity(JdbcClient db, JsonMapper json) {
        this.db = db;
        this.json = json;
    }

    /** A new player's first address. */
    public void registered(UUID player, String ip) {
        ip = clip(ip, 64);
        db.sql("UPDATE players SET created_ip = ?, last_ip = ?, last_seen_at = now() WHERE id = ?")
                .params(ip, ip, player)
                .update();
        address(player, ip);
    }

    public void seen(UUID player, String ip) {
        ip = clip(ip, 64);
        db.sql("""
                UPDATE players SET last_seen_at = now(), last_ip = coalesce(?, last_ip)
                WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < now() - make_interval(secs => ?)
                    OR last_ip IS DISTINCT FROM coalesce(?, last_ip))""")
                .params(ip, player, THROTTLE_SECONDS, ip)
                .update();
        address(player, ip);
    }

    /** The heartbeat: {@link #seen} plus the device it came from, if the client said. */
    public void seen(UUID player, String ip, String userAgent, DeviceReport device) {
        seen(player, ip);
        if (device == null || device.deviceId() == null || device.deviceId().isBlank()) return;
        // Set.of rejects contains(null).
        String platform = device.platform() != null && PLATFORMS.contains(device.platform()) ? device.platform() : "web";
        String details = device.details() == null ? "{}" : json.writeValueAsString(device.details());
        if (details.length() > MAX_DETAILS_CHARS) details = "{}";
        String id = clip(device.deviceId().trim(), 64);
        ip = clip(ip, 64);
        db.sql("""
                INSERT INTO player_devices (player_id, device_id, platform, os, browser, model, user_agent, ip, details)
                SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb
                WHERE EXISTS (SELECT 1 FROM player_devices WHERE player_id = ? AND device_id = ?)
                   OR (SELECT count(*) FROM player_devices WHERE player_id = ?) < ?
                ON CONFLICT (player_id, device_id) DO UPDATE SET
                    platform = excluded.platform, os = excluded.os, browser = excluded.browser, model = excluded.model,
                    user_agent = excluded.user_agent, ip = coalesce(excluded.ip, player_devices.ip),
                    details = excluded.details, last_seen_at = now()
                WHERE player_devices.last_seen_at < now() - make_interval(secs => ?)
                   OR player_devices.ip IS DISTINCT FROM coalesce(excluded.ip, player_devices.ip)""")
                .params(player, id, platform, clip(device.os(), 64), clip(device.browser(), 64), clip(device.model(), 64),
                        clip(userAgent, 512), ip, details, player, id, player, MAX_DEVICES, THROTTLE_SECONDS)
                .update();
    }

    /** {@link #seen}, off the caller's thread; failures are only logged. */
    public void seenLater(UUID player, String ip) {
        try {
            background.execute(() -> {
                try {
                    seen(player, ip);
                } catch (RuntimeException e) {
                    log.debug("Couldn't record activity for {}: {}", player, e.toString());
                }
            });
        } catch (RejectedExecutionException e) {
            // Shutting down.
        }
    }

    private void address(UUID player, String ip) {
        if (ip == null) return;
        db.sql("""
                INSERT INTO player_ips (player_id, ip) VALUES (?, ?)
                ON CONFLICT (player_id, ip) DO UPDATE SET last_seen_at = now()
                WHERE player_ips.last_seen_at < now() - make_interval(secs => ?)""")
                .params(player, ip, THROTTLE_SECONDS)
                .update();
    }

    private static String clip(String s, int max) {
        if (s == null || s.isBlank()) return null;
        s = s.trim();
        return s.length() > max ? s.substring(0, max) : s;
    }

    @Override
    public void destroy() {
        background.shutdown();
    }
}
