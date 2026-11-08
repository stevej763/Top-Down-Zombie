package com.boardedup.game;

import com.boardedup.game.protocol.ClientMessage;
import com.boardedup.game.protocol.ServerMessage;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectWriter;
import tools.jackson.databind.json.JsonMapper;

/** {@code /ws}: parses client messages and routes them to the {@link LobbyService} and rooms. */
@Component
public class GameSocketHandler extends TextWebSocketHandler implements DisposableBean {
    private static final Logger log = LoggerFactory.getLogger(GameSocketHandler.class);
    /**
     * A client this far behind gets disconnected (and goes into the grace period). Sends never block
     * the caller (a room's tick thread, holding its lock): each connection queues its messages and
     * drains them on its own virtual thread, so one stalled socket only stalls itself.
     */
    private static final long SEND_TIME_LIMIT_NANOS = TimeUnit.SECONDS.toNanos(5);
    private static final int BUFFER_LIMIT_CHARS = 512 * 1024;

    private final LobbyService lobby;
    private final JsonMapper json;
    private final ObjectWriter writer;
    private final long latencyMs;
    /** Only when simulating latency; one thread, so delayed messages keep their order. */
    private final ScheduledExecutorService delayer;
    private final Map<String, SocketConnection> connections = new ConcurrentHashMap<>();
    /** Drains outboxes and closes sockets; a blocked send parks only its own virtual thread. */
    private final ExecutorService senders = Executors.newVirtualThreadPerTaskExecutor();

    public GameSocketHandler(LobbyService lobby, JsonMapper json, @Value("${boarded-up.debug.latency-ms:0}") long latencyMs) {
        this.lobby = lobby;
        this.json = json;
        this.writer = json.writerFor(ServerMessage.class);
        this.latencyMs = latencyMs;
        this.delayer = latencyMs > 0 ? Executors.newSingleThreadScheduledExecutor(Thread.ofPlatform().name("ws-latency").daemon().factory()) : null;
        if (latencyMs > 0) log.warn("Simulating {} ms of latency each way on /ws", latencyMs);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        var conn = new SocketConnection(session);
        connections.put(session.getId(), conn);
        inbound(() -> lobby.connected(account(session), conn));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        SocketConnection conn = connections.get(session.getId());
        if (conn == null) return;
        String payload = message.getPayload();
        inbound(() -> handle(account(session), name(session), conn, payload));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        SocketConnection conn = connections.remove(session.getId());
        if (conn != null) inbound(() -> lobby.disconnected(account(session), conn));
    }

    private void handle(UUID account, String name, SocketConnection conn, String payload) {
        ClientMessage msg;
        try {
            msg = json.readValue(payload, ClientMessage.class);
        } catch (JacksonException e) {
            conn.send(new ServerMessage.Error("Bad message: " + e.getOriginalMessage()));
            return;
        }
        if (msg == null) {
            conn.send(new ServerMessage.Error("Bad message"));
            return;
        }
        GameRoom room = lobby.roomOf(account).orElse(null);
        String error = switch (msg) {
            case ClientMessage.Create c -> lobby.create(account, name, c.mapId(), c.solo(), conn);
            case ClientMessage.Join j -> lobby.join(account, name, j.code(), conn);
            case ClientMessage.Ready r -> room == null ? "Not in a room" : room.ready(account, r.ready());
            case ClientMessage.Start _ -> room == null ? "Not in a room" : room.start(account);
            case ClientMessage.Input i -> {
                if (room != null) room.input(account, conn, i.inputs());
                yield null;
            }
            case ClientMessage.Pause p -> {
                if (room != null) room.pause(account, p.paused());
                yield null;
            }
            case ClientMessage.Leave _ -> {
                lobby.leave(account);
                yield null;
            }
            case ClientMessage.Ping p -> {
                conn.send(new ServerMessage.Pong(p.t()));
                yield null;
            }
        };
        LobbyService.reply(conn, error);
    }

    private void inbound(Runnable r) {
        if (delayer == null) r.run();
        else delayer.schedule(r, latencyMs, TimeUnit.MILLISECONDS);
    }

    private static UUID account(WebSocketSession s) {
        return (UUID) s.getAttributes().get(TokenHandshakeInterceptor.ACCOUNT);
    }

    private static String name(WebSocketSession s) {
        return (String) s.getAttributes().get(TokenHandshakeInterceptor.NAME);
    }

    @Override
    public void destroy() {
        if (delayer != null) delayer.shutdownNow();
        senders.shutdownNow();
    }

    private final class SocketConnection implements Connection {
        private final WebSocketSession session;
        private final ConcurrentLinkedQueue<String> outbox = new ConcurrentLinkedQueue<>();
        private final AtomicLong queuedChars = new AtomicLong();
        /** True while a drain task owns the session; only that task sends, so sends never overlap. */
        private final AtomicBoolean draining = new AtomicBoolean();
        private final AtomicBoolean closing = new AtomicBoolean();
        /** When the send in progress started, or 0 between sends. */
        private volatile long sendStarted;

        SocketConnection(WebSocketSession session) {
            this.session = session;
        }

        @Override
        public void send(ServerMessage message) {
            String text = writer.writeValueAsString(message);
            if (delayer == null) enqueue(text);
            else delayer.schedule(() -> enqueue(text), latencyMs, TimeUnit.MILLISECONDS);
        }

        private void enqueue(String text) {
            if (closing.get()) return;
            long started = sendStarted;
            if (started != 0 && System.nanoTime() - started > SEND_TIME_LIMIT_NANOS) {
                log.debug("Send to {} stuck for over {} s; closing", session.getId(), TimeUnit.NANOSECONDS.toSeconds(SEND_TIME_LIMIT_NANOS));
                close();
                return;
            }
            if (queuedChars.addAndGet(text.length()) > BUFFER_LIMIT_CHARS) {
                log.debug("Outbox of {} over {} chars; closing", session.getId(), BUFFER_LIMIT_CHARS);
                close();
                return;
            }
            outbox.add(text);
            if (draining.compareAndSet(false, true)) submit(this::drain);
        }

        private void drain() {
            while (true) {
                String text;
                while ((text = outbox.poll()) != null) {
                    queuedChars.addAndGet(-text.length());
                    if (closing.get() || !session.isOpen()) continue;
                    sendStarted = System.nanoTime();
                    try {
                        session.sendMessage(new TextMessage(text));
                    } catch (IOException | RuntimeException e) {
                        log.debug("Send to {} failed: {}", session.getId(), e.toString());
                        close();
                    } finally {
                        sendStarted = 0;
                    }
                }
                draining.set(false);
                // A message queued after the poll but before the flag cleared would otherwise wait for the next one.
                if (outbox.isEmpty() || !draining.compareAndSet(false, true)) return;
            }
        }

        /** Asynchronous: closing sends a close frame, which can block on a stalled socket too. */
        @Override
        public void close() {
            if (!closing.compareAndSet(false, true)) return;
            submit(() -> {
                try {
                    session.close(CloseStatus.NORMAL);
                } catch (IOException | RuntimeException e) {
                    log.debug("Close of {} failed: {}", session.getId(), e.toString());
                }
            });
        }

        private void submit(Runnable task) {
            try {
                senders.execute(task);
            } catch (RejectedExecutionException e) {
                // Shutting down.
            }
        }
    }
}
