package com.topdownsurvival.game;

import static org.assertj.core.api.Assertions.assertThat;

import com.topdownsurvival.game.FakeConnection.ManualClock;
import com.topdownsurvival.game.protocol.ClientInput;
import com.topdownsurvival.game.protocol.ServerMessage;
import com.topdownsurvival.game.protocol.Snapshot;
import com.topdownsurvival.sim.GameSim;
import com.topdownsurvival.sim.Player;
import com.topdownsurvival.sim.PlayerInput;
import com.topdownsurvival.sim.SimEvent;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

class GameRoomTest {
    final ManualClock clock = new ManualClock();
    final List<String> removed = new ArrayList<>();
    final List<GameRoom> closedRooms = new ArrayList<>();
    final List<List<ScoreRecorder.Result>> recorded = new ArrayList<>();
    int recordedRound = -1;
    int recordedPartySize = -1;

    final ScoreRecorder scores = (mapId, round, partySize, results) -> {
        recorded.add(results);
        recordedRound = round;
        recordedPartySize = partySize;
        return results.stream().map(_ -> 7).toList();
    };

    final GameRoom.Listener listener = new GameRoom.Listener() {
        @Override
        public void memberRemoved(GameRoom room, UUID account) {
            removed.add(account.toString());
        }

        @Override
        public void closed(GameRoom room) {
            closedRooms.add(room);
        }
    };

    final UUID alice = UUID.randomUUID();
    final UUID bob = UUID.randomUUID();
    final FakeConnection aliceConn = new FakeConnection();
    final FakeConnection bobConn = new FakeConnection();

    GameRoom room(boolean solo) {
        return room(solo, Runnable::run);
    }

    GameRoom room(boolean solo, Executor background) {
        return new GameRoom("ABCD", FakeConnection.map("house"), 3, solo, scores, background, clock, () -> 42, listener);
    }

    /** A solo room in play, with zombies held off. */
    GameRoom soloGame() {
        GameRoom r = room(true);
        r.join(alice, "Alice", aliceConn);
        assertThat(r.start(alice)).isNull();
        r.sim().rounds.intermission = 1e9;
        return r;
    }

    GameRoom duoGame() {
        GameRoom r = room(false);
        r.join(alice, "Alice", aliceConn);
        r.join(bob, "Bob", bobConn);
        r.ready(bob, true);
        assertThat(r.start(alice)).isNull();
        r.sim().rounds.intermission = 1e9;
        return r;
    }

    static ClientInput input(int seq, Consumer<PlayerInput.Builder> b) {
        PlayerInput.Builder in = PlayerInput.builder();
        b.accept(in);
        return ClientInput.of(seq, in.build());
    }

    static void ticks(GameRoom r, int n) {
        for (int i = 0; i < n; i++) r.tick();
    }

    static Player first(GameRoom r) {
        return r.sim().players.getFirst();
    }

    @Test
    void welcomeAndLobbyOnJoin() {
        GameRoom r = room(false);
        assertThat(r.join(alice, "Alice", aliceConn)).isNull();
        assertThat(r.join(bob, "Bob", bobConn)).isNull();

        ServerMessage.Welcome w = bobConn.last(ServerMessage.Welcome.class);
        assertThat(w.you().playerId()).isEqualTo(2);
        assertThat(w.room()).isEqualTo(new ServerMessage.RoomInfo("ABCD", "house", 3, false));
        assertThat(w.map().id()).isEqualTo("house");

        ServerMessage.Lobby lobby = aliceConn.last(ServerMessage.Lobby.class);
        assertThat(lobby.ownerId()).isEqualTo(1);
        assertThat(lobby.state()).isEqualTo("lobby");
        assertThat(lobby.players()).extracting(ServerMessage.LobbyPlayer::name).containsExactly("Alice", "Bob");
    }

    @Test
    void onlyTheOwnerStartsAndOnlyWhenOthersAreReady() {
        GameRoom r = room(false);
        r.join(alice, "Alice", aliceConn);
        r.join(bob, "Bob", bobConn);
        assertThat(r.start(bob)).contains("host");
        assertThat(r.start(alice)).contains("Bob isn't ready");
        r.ready(bob, true);
        assertThat(r.start(alice)).isNull();
        assertThat(r.state()).isEqualTo(GameRoom.State.PLAYING);
        assertThat(r.sim().players).extracting(p -> p.name).containsExactly("Alice", "Bob");
        assertThat(bobConn.last(ServerMessage.Start.class)).isNotNull();
        assertThat(r.join(UUID.randomUUID(), "Late", new FakeConnection())).contains("already started");
    }

    @Test
    void roomsHoldFourAndSoloHoldsOne() {
        GameRoom r = room(false);
        for (int i = 0; i < GameRoom.MAX_PLAYERS; i++) assertThat(r.join(UUID.randomUUID(), "P" + i, new FakeConnection())).isNull();
        assertThat(r.join(UUID.randomUUID(), "Fifth", new FakeConnection())).contains("full");

        GameRoom s = room(true);
        s.join(alice, "Alice", aliceConn);
        assertThat(s.join(bob, "Bob", bobConn)).contains("solo");
    }

    @Test
    void takesOneInputPerTickAndAcksIt() {
        GameRoom r = soloGame();
        double x0 = first(r).x;
        r.input(alice, aliceConn, List.of(input(1, b -> b.move(1, 0)), input(2, b -> b.move(1, 0)), input(3, b -> b.move(1, 0))));
        r.tick();
        assertThat(first(r).x).isCloseTo(x0 + Player.SPEED * GameRoom.DT, org.assertj.core.data.Offset.offset(1e-9));
        ticks(r, 2);
        assertThat(aliceConn.last(Snapshot.class).acks()).containsEntry(1, 3);
    }

    @Test
    void anEmptyQueueRepeatsTheLastInputWithoutItsPresses() {
        GameRoom r = soloGame();
        r.input(alice, aliceConn, List.of(input(1, b -> b.move(1, 0).reload())));
        first(r).weapon().mag = 1;
        r.tick();
        double x1 = first(r).x;
        ticks(r, 10);
        assertThat(first(r).x).isGreaterThan(x1 + 9 * Player.SPEED * GameRoom.DT);
        long reloads = aliceConn.all(ServerMessage.Events.class).stream()
                .flatMap(e -> e.events().stream()).filter(e -> e instanceof SimEvent.Reload).count();
        assertThat(reloads).isEqualTo(1);
    }

    @Test
    void aBackedUpQueueDropsTheOldestButKeepsTheirPresses() {
        GameRoom r = soloGame();
        List<ClientInput> burst = new ArrayList<>();
        for (int seq = 1; seq <= 10; seq++) burst.add(seq == 2 ? input(seq, b -> b.knife()) : input(seq, _ -> {}));
        r.input(alice, aliceConn, burst);
        r.tick();
        // 10 queued, 6 may wait: seq 1-4 are dropped, seq 5 is applied with seq 2's knife press.
        assertThat(aliceConn.last(ServerMessage.Events.class).events()).contains(new SimEvent.Knife(1, false));
        ticks(r, 2);
        assertThat(aliceConn.last(Snapshot.class).acks()).containsEntry(1, 7);
    }

    @Test
    void mergePressesKeepsEarlierPressesAndLaterState() {
        PlayerInput earlier = new PlayerInput(1, 0, 1.0, true, true, true, false, false, true, 1, true);
        PlayerInput later = new PlayerInput(0, 1, 2.0, false, false, false, true, true, false, -1, false);
        assertThat(GameRoom.mergePresses(earlier, later))
                .isEqualTo(new PlayerInput(0, 1, 2.0, false, true, true, true, true, true, 1, true));
        assertThat(GameRoom.held(earlier)).isEqualTo(new PlayerInput(1, 0, 1.0, true, false, false, false, false, false, -1, false));
    }

    @Test
    void inputIsSanitized() {
        PlayerInput in = new ClientInput(1, 5, -9, Double.NaN, false, false, false, false, false, false, 7, false).toPlayerInput();
        assertThat(in.moveX()).isEqualTo(1);
        assertThat(in.moveY()).isEqualTo(-1);
        assertThat(in.aim()).isZero();
        assertThat(in.selectSlot()).isEqualTo(-1);
    }

    @Test
    void snapshotsGoOutEveryThirdTick() {
        GameRoom r = soloGame();
        ticks(r, 9);
        assertThat(aliceConn.all(Snapshot.class)).extracting(Snapshot::tick).containsExactly(3L, 6L, 9L);
        Snapshot s = aliceConn.last(Snapshot.class);
        assertThat(s.players()).hasSize(1);
        assertThat(s.players().getFirst().weapons()).hasSize(2);
        assertThat(s.windows()).hasSize(r.sim().barricades.size());
        assertThat(s.interactables()).hasSize(r.sim().interactables.size());
    }

    @Test
    void eventsAreBatchedOncePerTick() {
        GameRoom r = soloGame();
        first(r).weapon().mag = 3;
        r.input(alice, aliceConn, List.of(input(1, b -> b.fire())));
        r.tick();
        List<ServerMessage.Events> events = aliceConn.all(ServerMessage.Events.class);
        assertThat(events).hasSize(1);
        assertThat(events.getFirst().tick()).isEqualTo(1);
        assertThat(events.getFirst().events()).hasAtLeastOneElementOfType(SimEvent.Shot.class).hasAtLeastOneElementOfType(SimEvent.Tracer.class);
        r.tick();
        assertThat(aliceConn.all(ServerMessage.Events.class)).hasSize(1);
    }

    @Test
    void aDisconnectedPlayerIdlesThenIsRemovedAfterTheGracePeriod() {
        GameRoom r = duoGame();
        r.input(bob, bobConn, List.of(input(1, b -> b.move(1, 0))));
        r.disconnected(bob, bobConn);
        Player b = r.sim().player(2);
        double x = b.x;
        ticks(r, 5);
        assertThat(b.x).isEqualTo(x);
        assertThat(aliceConn.last(ServerMessage.Lobby.class).players().get(1).connected()).isFalse();

        clock.advance(GameRoom.GRACE.minusSeconds(1));
        r.tick();
        assertThat(r.sim().players).hasSize(2);
        clock.advance(Duration.ofSeconds(1));
        r.tick();
        assertThat(r.sim().players).extracting(p -> p.id).containsExactly(1);
        assertThat(removed).containsExactly(bob.toString());
        assertThat(aliceConn.last(ServerMessage.Lobby.class).players()).hasSize(1);
    }

    @Test
    void reconnectingResumesThePlayer() {
        GameRoom r = duoGame();
        ticks(r, 10);
        r.disconnected(bob, bobConn);
        clock.advance(Duration.ofSeconds(20));
        FakeConnection again = new FakeConnection();
        r.reconnect(bob, again);
        assertThat(again.last(ServerMessage.Welcome.class).you().playerId()).isEqualTo(2);
        assertThat(again.last(ServerMessage.Start.class).tick()).isEqualTo(10);

        clock.advance(Duration.ofSeconds(60));
        r.input(bob, again, List.of(input(1, b -> b.move(0, 1))));
        double y = r.sim().player(2).y;
        r.tick();
        assertThat(r.sim().player(2).y).isGreaterThan(y);
        ticks(r, 2);
        assertThat(again.all(Snapshot.class)).isNotEmpty();
    }

    @Test
    void aSecondTabReplacesTheFirst() {
        GameRoom r = duoGame();
        FakeConnection tab2 = new FakeConnection();
        r.reconnect(bob, tab2);
        assertThat(bobConn.closed).isTrue();
        // The old socket's close arrives late and must not disconnect the new one.
        r.disconnected(bob, bobConn);
        assertThat(aliceConn.last(ServerMessage.Lobby.class).players().get(1).connected()).isTrue();
    }

    @Test
    void anEmptyRoomCloses() {
        GameRoom r = soloGame();
        r.disconnected(alice, aliceConn);
        clock.advance(GameRoom.GRACE);
        r.tick();
        assertThat(r.isClosed()).isTrue();
        assertThat(closedRooms).containsExactly(r);
    }

    @Test
    void leavingTheLobbyPassesOwnership() {
        GameRoom r = room(false);
        r.join(alice, "Alice", aliceConn);
        r.join(bob, "Bob", bobConn);
        r.leave(alice);
        assertThat(bobConn.last(ServerMessage.Lobby.class).ownerId()).isEqualTo(2);
        assertThat(r.start(bob)).isNull();
    }

    @Test
    void gameOverWritesScoresAndReturnsToTheLobby() {
        GameRoom r = soloGame();
        GameSim sim = r.sim();
        sim.rounds.round = 4;
        first(r).kills = 12;
        first(r).economy.earned = 3456;
        sim.damagePlayer(first(r), 1e6);
        r.tick();

        assertThat(recordedRound).isEqualTo(3);
        assertThat(recordedPartySize).isEqualTo(1);
        assertThat(recorded.getFirst()).containsExactly(new ScoreRecorder.Result(alice, 12, 3456));

        ServerMessage.GameOver over = aliceConn.last(ServerMessage.GameOver.class);
        assertThat(over.round()).isEqualTo(3);
        assertThat(over.players()).containsExactly(new ServerMessage.Result(1, "Alice", 12, 3456, 7));
        assertThat(aliceConn.all(ServerMessage.Events.class).getLast().events()).contains(new SimEvent.GameOver());
        assertThat(r.state()).isEqualTo(GameRoom.State.LOBBY);
        assertThat(aliceConn.last(ServerMessage.Lobby.class).state()).isEqualTo("lobby");

        // Solo plays again with another start.
        assertThat(r.start(alice)).isNull();
        assertThat(r.sim()).isNotSameAs(sim);
    }

    @Test
    void coopGameOverScoresEveryoneWithThePartySize() {
        GameRoom r = duoGame();
        for (Player p : List.copyOf(r.sim().players)) r.sim().damagePlayer(p, 1e6);
        r.tick();
        assertThat(recordedPartySize).isEqualTo(2);
        assertThat(recorded.getFirst()).extracting(ScoreRecorder.Result::playerId).containsExactly(alice, bob);
        assertThat(bobConn.last(ServerMessage.GameOver.class).players()).hasSize(2);
        assertThat(bobConn.last(ServerMessage.Lobby.class).players()).allMatch(p -> !p.ready());
    }

    @Test
    void aFailedScoreWriteStillEndsTheGame() {
        GameRoom r = new GameRoom("ABCD", FakeConnection.map("house"), 1, true, (_, _, _, _) -> {
            throw new IllegalStateException("db down");
        }, Runnable::run, clock, () -> 1, listener);
        r.join(alice, "Alice", aliceConn);
        r.start(alice);
        r.sim().damagePlayer(r.sim().players.getFirst(), 1e6);
        r.tick();
        assertThat(aliceConn.last(ServerMessage.GameOver.class).players().getFirst().rank()).isEqualTo(-1);
        assertThat(r.state()).isEqualTo(GameRoom.State.LOBBY);
    }

    @Test
    void aSlowScoreWriteFreezesTheGameUntilItsDone() {
        List<Runnable> pending = new ArrayList<>();
        GameRoom r = room(true, pending::add);
        r.join(alice, "Alice", aliceConn);
        r.start(alice);
        r.sim().damagePlayer(r.sim().players.getFirst(), 1e6);
        r.tick();
        long frozenAt = r.currentTick();
        r.tick();
        assertThat(r.currentTick()).isEqualTo(frozenAt);
        assertThat(aliceConn.last(ServerMessage.GameOver.class)).isNull();
        assertThat(r.state()).isEqualTo(GameRoom.State.PLAYING);
        assertThat(r.start(alice)).isNotNull();

        pending.forEach(Runnable::run);
        r.tick();
        assertThat(aliceConn.last(ServerMessage.GameOver.class).players().getFirst().rank()).isEqualTo(7);
        assertThat(r.state()).isEqualTo(GameRoom.State.LOBBY);
    }

    @Test
    void scoresThatNeverSaveShowTheResultsWithoutRanks() {
        List<Runnable> pending = new ArrayList<>();
        GameRoom r = room(true, pending::add);
        r.join(alice, "Alice", aliceConn);
        r.start(alice);
        r.sim().damagePlayer(r.sim().players.getFirst(), 1e6);
        r.tick();
        clock.advance(GameRoom.SCORE_WAIT);
        r.tick();
        assertThat(aliceConn.last(ServerMessage.GameOver.class).players().getFirst().rank()).isEqualTo(-1);
        assertThat(r.state()).isEqualTo(GameRoom.State.LOBBY);

        // The late write changes nothing.
        pending.forEach(Runnable::run);
        r.tick();
        assertThat(aliceConn.all(ServerMessage.GameOver.class)).hasSize(1);
    }

    @Test
    void resumingCarriesOnFromTheLastAppliedSeqAndIgnoresTheOldSocket() {
        GameRoom r = duoGame();
        r.input(bob, bobConn, List.of(input(41, b -> b.move(1, 0)), input(42, b -> b.move(1, 0))));
        ticks(r, 2);
        FakeConnection tab2 = new FakeConnection();
        r.reconnect(bob, tab2);
        assertThat(tab2.last(ServerMessage.Start.class).seq()).isEqualTo(42);

        // A late input from the replaced socket doesn't count.
        r.input(bob, bobConn, List.of(input(43, b -> b.move(0, 1))));
        double y = r.sim().player(2).y;
        ticks(r, 3);
        assertThat(r.sim().player(2).y).isEqualTo(y);
        assertThat(tab2.last(Snapshot.class).acks()).containsEntry(2, 42);
    }

    @Test
    void soloPauseStopsTheSim() {
        GameRoom r = room(true);
        r.join(alice, "Alice", aliceConn);
        r.start(alice);
        ticks(r, 3);
        r.pause(alice, true);
        ticks(r, 30);
        assertThat(r.currentTick()).isEqualTo(3);
        r.pause(alice, false);
        ticks(r, 3);
        assertThat(r.currentTick()).isEqualTo(6);
    }

    @Test
    void soloWaitsWhileDisconnected() {
        GameRoom r = room(true);
        r.join(alice, "Alice", aliceConn);
        r.start(alice);
        r.disconnected(alice, aliceConn);
        ticks(r, 10);
        assertThat(r.currentTick()).isZero();
        r.reconnect(alice, new FakeConnection());
        ticks(r, 10);
        assertThat(r.currentTick()).isEqualTo(10);
    }

    @Test
    void coopIgnoresPause() {
        GameRoom r = duoGame();
        r.pause(alice, true);
        ticks(r, 5);
        assertThat(r.currentTick()).isEqualTo(5);
    }
}
