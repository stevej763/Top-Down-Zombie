package com.boardedup.game;

import com.boardedup.game.protocol.ServerMessage;
import com.boardedup.sim.map.MapDoc;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.core.io.ClassPathResource;
import tools.jackson.databind.json.JsonMapper;

/** Records what a room sends. */
final class FakeConnection implements Connection {
    final List<ServerMessage> sent = new CopyOnWriteArrayList<>();
    boolean closed;

    @Override
    public void send(ServerMessage message) {
        sent.add(message);
    }

    @Override
    public void close() {
        closed = true;
    }

    <T extends ServerMessage> List<T> all(Class<T> type) {
        return sent.stream().filter(type::isInstance).map(type::cast).toList();
    }

    <T extends ServerMessage> T last(Class<T> type) {
        List<T> l = all(type);
        return l.isEmpty() ? null : l.getLast();
    }

    /** A clock tests move by hand. */
    static final class ManualClock implements InstantSource {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");

        @Override
        public Instant instant() {
            return now;
        }

        void advance(Duration d) {
            now = now.plus(d);
        }
    }

    static MapDoc map(String id) {
        try {
            String raw = new ClassPathResource("maps/" + id + ".json").getContentAsString(StandardCharsets.UTF_8);
            return JsonMapper.builder().build().readValue(raw, MapDoc.class);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
