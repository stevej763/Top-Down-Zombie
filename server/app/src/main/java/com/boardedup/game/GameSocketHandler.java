package com.boardedup.game;

import com.boardedup.game.protocol.ClientMessage;
import com.boardedup.game.protocol.ServerMessage;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectWriter;
import tools.jackson.databind.json.JsonMapper;

/** {@code /ws}: parses client messages and routes them to the {@link LobbyService} and rooms. */
@Component
public class GameSocketHandler extends TextWebSocketHandler implements DisposableBean {
    private static final Logger log = LoggerFactory.getLogger(GameSocketHandler.class);
    /** A client this far behind gets disconnected (and goes into the grace period) rather than stall its room. */
    private static final int SEND_TIME_LIMIT_MS = 5_000;
    private static final int BUFFER_LIMIT_BYTES = 512 * 1024;

    private final LobbyService lobby;
    private final JsonMapper json;
    private final ObjectWriter writer;
    private final long latencyMs;
    /** Only when simulating latency; one thread, so delayed messages keep their order. */
    private final ScheduledExecutorService delayer;
    private final Map<String, SocketConnection> connections = new ConcurrentHashMap<>();

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
        var conn = new SocketConnection(new ConcurrentWebSocketSessionDecorator(session, SEND_TIME_LIMIT_MS, BUFFER_LIMIT_BYTES,
                ConcurrentWebSocketSessionDecorator.OverflowStrategy.TERMINATE));
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
                if (room != null) room.input(account, i.inputs());
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
    }

    private final class SocketConnection implements Connection {
        private final WebSocketSession session;

        SocketConnection(WebSocketSession session) {
            this.session = session;
        }

        @Override
        public void send(ServerMessage message) {
            String text = writer.writeValueAsString(message);
            if (delayer == null) deliver(text);
            else delayer.schedule(() -> deliver(text), latencyMs, TimeUnit.MILLISECONDS);
        }

        private void deliver(String text) {
            if (!session.isOpen()) return;
            try {
                session.sendMessage(new TextMessage(text));
            } catch (IOException | RuntimeException e) {
                // Includes the decorator's limit exceptions; it has already closed the session for those.
                log.debug("Send to {} failed: {}", session.getId(), e.toString());
                close();
            }
        }

        @Override
        public void close() {
            try {
                session.close(CloseStatus.NORMAL);
            } catch (IOException e) {
                log.debug("Close of {} failed: {}", session.getId(), e.toString());
            }
        }
    }
}
