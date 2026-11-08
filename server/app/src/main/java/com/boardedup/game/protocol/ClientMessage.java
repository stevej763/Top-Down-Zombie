package com.boardedup.game.protocol;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import java.util.List;

/** Browser → server over {@code /ws}. Mirrored by client/src/net/protocol.ts; keep the field names identical. */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
        @JsonSubTypes.Type(value = ClientMessage.Create.class, name = "create"),
        @JsonSubTypes.Type(value = ClientMessage.Join.class, name = "join"),
        @JsonSubTypes.Type(value = ClientMessage.Ready.class, name = "ready"),
        @JsonSubTypes.Type(value = ClientMessage.Start.class, name = "start"),
        @JsonSubTypes.Type(value = ClientMessage.Input.class, name = "input"),
        @JsonSubTypes.Type(value = ClientMessage.Leave.class, name = "leave"),
        @JsonSubTypes.Type(value = ClientMessage.Pause.class, name = "pause"),
        @JsonSubTypes.Type(value = ClientMessage.Ping.class, name = "ping"),
})
public sealed interface ClientMessage {
    /** A solo room starts straight away and nobody else can join it. */
    record Create(String mapId, boolean solo) implements ClientMessage {}

    record Join(String code) implements ClientMessage {}

    record Ready(boolean ready) implements ClientMessage {}

    /** Owner only, in the lobby, once everyone else is ready. */
    record Start() implements ClientMessage {}

    /** Usually one input; a client catching up after a stall may send several. */
    record Input(List<ClientInput> inputs) implements ClientMessage {}

    record Leave() implements ClientMessage {}

    /** Solo only: the sim stops while paused. Co-op rooms ignore it. */
    record Pause(boolean paused) implements ClientMessage {}

    /** {@code t} is the client's clock, echoed back in the pong. */
    record Ping(double t) implements ClientMessage {}
}
