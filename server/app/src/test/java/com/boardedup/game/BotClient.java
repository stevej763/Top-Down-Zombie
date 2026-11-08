package com.boardedup.game;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Predicate;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * A test player over a real socket: records every message, and once {@link #play} is called sends
 * an input every client tick (60 Hz), aiming and firing at the nearest zombie in the latest snapshot.
 */
final class BotClient extends TextWebSocketHandler {
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final List<JsonNode> received = new ArrayList<>();
    private final WebSocketSession session;
    private final AtomicInteger seq = new AtomicInteger();
    private volatile JsonNode snapshot;
    private volatile int playerId = -1;
    private volatile boolean closed;
    private ScheduledFuture<?> playing;

    private BotClient(String url) throws Exception {
        this.session = new StandardWebSocketClient().execute(this, url).get(10, TimeUnit.SECONDS);
    }

    static BotClient connect(int port, String token) throws Exception {
        return new BotClient("ws://localhost:" + port + "/ws?token=" + token);
    }

    @Override
    protected void handleTextMessage(WebSocketSession s, TextMessage message) {
        JsonNode msg = JSON.readTree(message.getPayload());
        switch (msg.get("type").asString()) {
            case "snapshot" -> snapshot = msg;
            case "welcome" -> playerId = msg.get("you").get("playerId").asInt();
            default -> {}
        }
        synchronized (received) {
            received.add(msg);
            received.notifyAll();
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession s, CloseStatus status) {
        closed = true;
    }

    boolean isClosed() {
        return closed;
    }

    int playerId() {
        return playerId;
    }

    synchronized void send(String json) {
        try {
            session.sendMessage(new TextMessage(json));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    void send(ObjectNode msg) {
        send(JSON.writeValueAsString(msg));
    }

    static ObjectNode msg(String type) {
        return JSON.createObjectNode().put("type", type);
    }

    /** The first message received (ever) of this type that matches, waiting for it if needed. */
    JsonNode await(String type, Predicate<JsonNode> where, Duration timeout) throws InterruptedException, TimeoutException {
        long deadline = System.nanoTime() + timeout.toNanos();
        synchronized (received) {
            while (true) {
                for (JsonNode m : received) if (m.get("type").asString().equals(type) && where.test(m)) return m;
                long left = deadline - System.nanoTime();
                if (left <= 0) throw new TimeoutException("No " + type + " message; got " + types());
                TimeUnit.NANOSECONDS.timedWait(received, left);
            }
        }
    }

    JsonNode await(String type) throws InterruptedException, TimeoutException {
        return await(type, _ -> true, Duration.ofSeconds(10));
    }

    List<JsonNode> all(String type) {
        synchronized (received) {
            return received.stream().filter(m -> m.get("type").asString().equals(type)).toList();
        }
    }

    private List<String> types() {
        return received.stream().map(m -> m.get("type").asString()).distinct().toList();
    }

    void play(ScheduledExecutorService pool) {
        playing = pool.scheduleAtFixedRate(this::sendInput, 0, 1_000_000_000L / 60, TimeUnit.NANOSECONDS);
    }

    void stop() {
        if (playing != null) playing.cancel(false);
    }

    void close() throws IOException {
        stop();
        session.close();
    }

    private void sendInput() {
        if (closed) return;
        int n = seq.incrementAndGet();
        double aim = 0;
        boolean reload = false;
        JsonNode s = snapshot;
        JsonNode me = null;
        if (s != null) for (JsonNode p : s.get("players")) if (p.get("id").asInt() == playerId) me = p;
        if (me != null) {
            double best = Double.POSITIVE_INFINITY;
            for (JsonNode z : s.get("zombies")) {
                double dx = z.get("x").asDouble() - me.get("x").asDouble();
                double dy = z.get("y").asDouble() - me.get("y").asDouble();
                double d = Math.hypot(dx, dy);
                if (d < best) {
                    best = d;
                    aim = Math.atan2(dy, dx);
                }
            }
            JsonNode w = me.get("weapons").get(me.get("slot").asInt());
            reload = w.get("mag").asInt() == 0;
        }
        ObjectNode in = JSON.createObjectNode()
                .put("seq", n).put("moveX", 0).put("moveY", 0).put("aim", aim)
                .put("fireHeld", true).put("firePressed", n % 12 == 0).put("reload", reload).put("knife", false)
                .put("interactHeld", false).put("interactPressed", false).put("selectSlot", -1).put("swap", false);
        ObjectNode msg = msg("input");
        msg.putArray("inputs").add(in);
        try {
            send(msg);
        } catch (RuntimeException e) {
            stop();
        }
    }
}
