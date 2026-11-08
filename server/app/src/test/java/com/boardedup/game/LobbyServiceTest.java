package com.boardedup.game;

import static org.assertj.core.api.Assertions.assertThat;

import com.boardedup.game.FakeConnection.ManualClock;
import com.boardedup.game.protocol.ServerMessage;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class LobbyServiceTest {
    final ManualClock clock = new ManualClock();
    final List<Runnable> ticks = new ArrayList<>();
    int stopped;

    final LobbyService lobby = new LobbyService(
            id -> id.equals("house") ? Optional.of(new LobbyService.RoomMap(FakeConnection.map("house"), 1)) : Optional.empty(),
            (_, _, _, results) -> results.stream().map(_ -> 0).toList(),
            tick -> {
                ticks.add(tick);
                return () -> stopped++;
            },
            clock, () -> 1);

    record Client(UUID account, String name, FakeConnection conn) {}

    static Client client(String name) {
        return new Client(UUID.randomUUID(), name, new FakeConnection());
    }

    String create(Client c, boolean solo) {
        assertThat(lobby.create(c.account(), c.name(), "house", solo, c.conn())).isNull();
        return c.conn().last(ServerMessage.Welcome.class).room().code();
    }

    String join(Client c, String code) {
        return lobby.join(c.account(), c.name(), code, c.conn());
    }

    @Test
    void codesAreFourUnambiguousLetters() {
        Set<String> codes = new HashSet<>();
        for (int i = 0; i < 200; i++) codes.add(create(client("P" + i), false));
        assertThat(codes).hasSize(200).allMatch(c -> c.matches("[A-HJKMNP-Z]{4}"));
        assertThat(lobby.roomCount()).isEqualTo(200);
        assertThat(ticks).hasSize(200);
    }

    @Test
    void unknownMapsAndCodesAreRejected() {
        Client a = client("A");
        assertThat(lobby.create(a.account(), a.name(), "nowhere", false, a.conn())).contains("No map");
        assertThat(join(a, "ZZZZ")).contains("No room");
    }

    @Test
    void joinIgnoresCaseAndAFifthPlayerIsTurnedAway() {
        String code = create(client("Host"), false);
        for (int i = 0; i < 3; i++) assertThat(join(client("P" + i), code.toLowerCase())).isNull();
        assertThat(join(client("Fifth"), code)).contains("full");
    }

    @Test
    void joiningAfterTheStartIsRejected() {
        Client host = client("Host");
        String code = create(host, false);
        lobby.roomOf(host.account()).orElseThrow().start(host.account());
        assertThat(join(client("Late"), code)).contains("already started");
    }

    @Test
    void onlyTheOwnerCanStart() {
        Client host = client("Host");
        Client guest = client("Guest");
        String code = create(host, false);
        join(guest, code);
        GameRoom room = lobby.room(code).orElseThrow();
        room.ready(guest.account(), true);
        assertThat(room.start(guest.account())).contains("host");
        assertThat(room.start(host.account())).isNull();
    }

    @Test
    void soloStartsAtOnceAndCantBeJoined() {
        Client a = client("A");
        String code = create(a, true);
        assertThat(lobby.room(code).orElseThrow().state()).isEqualTo(GameRoom.State.PLAYING);
        assertThat(a.conn().last(ServerMessage.Start.class)).isNotNull();
        assertThat(join(client("B"), code)).contains("solo");
    }

    @Test
    void joiningAnotherRoomLeavesTheFirst() {
        Client a = client("A");
        Client b = client("B");
        String first = create(a, false);
        join(b, first);
        String second = create(client("C"), false);
        assertThat(join(b, second)).isNull();
        assertThat(lobby.room(first).orElseThrow().memberCount()).isEqualTo(1);
        assertThat(lobby.roomOf(b.account()).orElseThrow().code).isEqualTo(second);
    }

    @Test
    void aFailedJoinKeepsYourSeat() {
        Client a = client("A");
        Client b = client("B");
        String mine = create(a, false);
        String solo = create(b, true);
        assertThat(join(a, solo)).isNotNull();
        assertThat(lobby.roomOf(a.account()).orElseThrow().code).isEqualTo(mine);
    }

    @Test
    void theLastToLeaveClosesTheRoom() {
        Client a = client("A");
        String code = create(a, false);
        lobby.leave(a.account());
        assertThat(lobby.room(code)).isEmpty();
        assertThat(lobby.roomOf(a.account())).isEmpty();
        assertThat(stopped).isEqualTo(1);
    }

    @Test
    void reconnectingFindsYourRoom() {
        Client a = client("A");
        create(a, true);
        lobby.disconnected(a.account(), a.conn());
        FakeConnection again = new FakeConnection();
        lobby.connected(a.account(), again);
        assertThat(again.last(ServerMessage.Welcome.class)).isNotNull();
        assertThat(again.last(ServerMessage.Start.class)).isNotNull();
    }
}
