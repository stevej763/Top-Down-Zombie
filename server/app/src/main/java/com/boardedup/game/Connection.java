package com.boardedup.game;

import com.boardedup.game.protocol.ServerMessage;

/** One player's socket, as rooms see it. Implementations must be safe to call from any thread. */
public interface Connection {
    void send(ServerMessage message);

    void close();
}
