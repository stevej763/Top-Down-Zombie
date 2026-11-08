package com.boardedup.game;

import com.boardedup.game.protocol.ClientInput;
import com.boardedup.game.protocol.ServerMessage;
import com.boardedup.sim.GameSim;
import com.boardedup.sim.Player;
import com.boardedup.sim.PlayerInput;
import com.boardedup.sim.map.MapDoc;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.function.LongSupplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * One game: its members, lobby state and (while playing) the {@link GameSim}. {@link #tick} is
 * called 60 times a second by one scheduled task, and it and every membership change hold this
 * room's lock, so the sim only ever sees one thread. Socket threads only enqueue inputs, lock-free.
 * Back in the lobby after a game over, the same members can start again.
 */
public final class GameRoom {
    public enum State { LOBBY, PLAYING }

    /** Told about membership changes so the lobby's indexes stay current. Called under the room lock. */
    public interface Listener {
        void memberRemoved(GameRoom room, UUID account);

        void closed(GameRoom room);
    }

    private static final Logger log = LoggerFactory.getLogger(GameRoom.class);

    public static final int MAX_PLAYERS = 4;
    public static final int TICK_HZ = 60;
    static final double DT = 1.0 / TICK_HZ;
    /** 60 Hz / 3 = 20 snapshots a second. */
    static final int SNAPSHOT_EVERY = 3;
    /** Past this many waiting inputs, the oldest are dropped (their presses kept) to catch up. */
    static final int MAX_QUEUED = 6;
    /** Inputs beyond this are ignored outright; only a broken or hostile client gets here. */
    static final int MAX_BUFFERED = 120;
    static final Duration GRACE = Duration.ofSeconds(30);

    static final class Member {
        final UUID account;
        final int id;
        final String name;
        boolean ready;
        Connection conn;
        Instant disconnectedAt;
        final ConcurrentLinkedQueue<ClientInput> inputs = new ConcurrentLinkedQueue<>();
        /** The input applied last tick, presses included; idle ticks reuse it without the presses. */
        PlayerInput last = PlayerInput.NONE;
        int lastSeq;

        Member(UUID account, int id, String name, Connection conn) {
            this.account = account;
            this.id = id;
            this.name = name;
            this.conn = conn;
        }
    }

    public final String code;
    public final String mapId;
    public final int mapVersion;
    public final boolean solo;
    private final MapDoc map;
    private final ScoreRecorder scores;
    private final InstantSource clock;
    private final LongSupplier seeds;
    private final Listener listener;

    private final Map<UUID, Member> members = new ConcurrentHashMap<>();
    private volatile State state = State.LOBBY;
    private int lastMemberId;
    private int ownerId;
    private boolean closed;
    private GameSim sim;
    private long tick;
    private int partySize;

    public GameRoom(String code, MapDoc map, int mapVersion, boolean solo, ScoreRecorder scores, InstantSource clock,
            LongSupplier seeds, Listener listener) {
        this.code = code;
        this.mapId = map.id();
        this.map = map;
        this.mapVersion = mapVersion;
        this.solo = solo;
        this.scores = scores;
        this.clock = clock;
        this.seeds = seeds;
        this.listener = listener;
    }

    public State state() {
        return state;
    }

    // --------------------------------------------------------------- membership

    /** Adds a member and sends them the welcome. Returns an error message, or null on success. */
    public synchronized String join(UUID account, String name, Connection conn) {
        if (closed) return "No room " + code;
        if (members.containsKey(account)) return "Already in this room";
        if (solo && !members.isEmpty()) return "That's a solo game";
        if (state != State.LOBBY) return "That game has already started";
        if (members.size() >= MAX_PLAYERS) return "Room " + code + " is full";
        Member m = new Member(account, ++lastMemberId, name, conn);
        if (members.isEmpty()) ownerId = m.id;
        members.put(account, m);
        conn.send(welcome(m));
        broadcast(lobby());
        return null;
    }

    /** The same account connected again (within the grace period, or from a second tab). */
    public synchronized void reconnect(UUID account, Connection conn) {
        Member m = members.get(account);
        if (m == null) return;
        Connection old = m.conn;
        m.conn = conn;
        m.disconnectedAt = null;
        conn.send(welcome(m));
        broadcast(lobby());
        if (state == State.PLAYING) conn.send(new ServerMessage.Start(tick));
        if (old != null && old != conn) old.close();
    }

    /** Starts the grace period; the player idles meanwhile. Ignored for a connection already replaced. */
    public synchronized void disconnected(UUID account, Connection conn) {
        Member m = members.get(account);
        if (m == null || m.conn != conn) return;
        m.conn = null;
        m.disconnectedAt = clock.instant();
        m.inputs.clear();
        m.last = PlayerInput.NONE;
        broadcast(lobby());
    }

    public synchronized void leave(UUID account) {
        Member m = members.get(account);
        if (m != null) remove(m);
    }

    public synchronized String ready(UUID account, boolean ready) {
        Member m = members.get(account);
        if (m == null) return "Not in this room";
        if (state != State.LOBBY) return "The game has started";
        m.ready = ready;
        broadcast(lobby());
        return null;
    }

    /** Owner only; everyone else must be ready. */
    public synchronized String start(UUID account) {
        Member m = members.get(account);
        if (m == null) return "Not in this room";
        if (m.id != ownerId) return "Only the host can start";
        if (state != State.LOBBY) return "The game has already started";
        for (Member o : members.values()) if (o != m && !o.ready) return o.name + " isn't ready";

        sim = new GameSim(map, seeds.getAsLong());
        for (Member o : ordered()) {
            sim.addPlayer(o.id, o.name);
            o.inputs.clear();
            o.last = PlayerInput.NONE;
            o.lastSeq = 0;
        }
        partySize = members.size();
        tick = 0;
        state = State.PLAYING;
        broadcast(new ServerMessage.Start(tick));
        broadcast(lobby());
        return null;
    }

    /** Called from socket threads. Inputs outside a game are dropped. */
    public void input(UUID account, List<ClientInput> inputs) {
        Member m = members.get(account);
        if (m == null || state != State.PLAYING || inputs == null) return;
        for (ClientInput in : inputs) {
            if (in == null) continue;
            if (m.inputs.size() >= MAX_BUFFERED) break;
            m.inputs.add(in);
        }
    }

    private void remove(Member m) {
        members.remove(m.account);
        if (sim != null && sim.player(m.id) != null) sim.removePlayer(m.id);
        listener.memberRemoved(this, m.account);
        if (m.id == ownerId) ownerId = ordered().stream().mapToInt(o -> o.id).findFirst().orElse(0);
        if (members.isEmpty()) {
            close();
        } else {
            broadcast(lobby());
        }
    }

    private void close() {
        if (closed) return;
        closed = true;
        sim = null;
        listener.closed(this);
    }

    // --------------------------------------------------------------- tick

    /** One 60 Hz step: expire grace periods, then (while playing) step the sim and send what changed. */
    public synchronized void tick() {
        if (closed) return;
        Instant now = clock.instant();
        for (Member m : ordered()) {
            if (m.conn == null && !now.isBefore(m.disconnectedAt.plus(GRACE))) remove(m);
        }
        if (closed || state != State.PLAYING) return;
        try {
            stepSim();
        } catch (RuntimeException e) {
            // A sim bug shouldn't kill the room's task (which would freeze it for good): end the game instead.
            log.error("Room {}: sim failed at tick {}", code, tick, e);
            broadcast(new ServerMessage.Error("The game crashed"));
            backToLobby();
        }
    }

    private void stepSim() {
        Map<Integer, PlayerInput> inputs = new HashMap<>();
        Map<Integer, Integer> acks = new HashMap<>();
        for (Member m : members.values()) {
            if (sim.player(m.id) == null) continue;
            inputs.put(m.id, nextInput(m));
            acks.put(m.id, m.lastSeq);
        }
        sim.step(DT, inputs);
        tick++;
        if (!sim.events.isEmpty()) {
            broadcast(new ServerMessage.Events(tick, List.copyOf(sim.events)));
            sim.events.clear();
        }
        if (tick % SNAPSHOT_EVERY == 0 || sim.over) broadcast(SnapshotBuilder.build(sim, tick, acks));
        if (sim.over) finish();
    }

    /** One input per tick; see {@link #MAX_QUEUED}. */
    private static PlayerInput nextInput(Member m) {
        PlayerInput dropped = null;
        while (m.inputs.size() > MAX_QUEUED) {
            ClientInput old = m.inputs.poll();
            dropped = dropped == null ? old.toPlayerInput() : mergePresses(dropped, old.toPlayerInput());
            m.lastSeq = old.seq();
        }
        ClientInput next = m.inputs.poll();
        if (next == null) return m.last = held(m.last);
        m.lastSeq = next.seq();
        PlayerInput in = next.toPlayerInput();
        return m.last = dropped == null ? in : mergePresses(dropped, in);
    }

    /** {@code later}, plus any one-tick presses from {@code earlier}. */
    static PlayerInput mergePresses(PlayerInput earlier, PlayerInput later) {
        return new PlayerInput(later.moveX(), later.moveY(), later.aim(), later.fireHeld(),
                earlier.firePressed() || later.firePressed(), earlier.reload() || later.reload(),
                earlier.knife() || later.knife(), later.interactHeld(),
                earlier.interactPressed() || later.interactPressed(),
                later.selectSlot() >= 0 ? later.selectSlot() : earlier.selectSlot(), earlier.swap() || later.swap());
    }

    /** The same input with every one-tick press cleared: what an idle tick repeats. */
    static PlayerInput held(PlayerInput in) {
        return new PlayerInput(in.moveX(), in.moveY(), in.aim(), in.fireHeld(), false, false, false, in.interactHeld(),
                false, -1, false);
    }

    /** Scores, the gameOver message, then back to the lobby. */
    private void finish() {
        int round = Math.max(0, sim.rounds.round - 1);
        List<Player> players = List.copyOf(sim.players);
        List<ScoreRecorder.Result> results = new ArrayList<>();
        for (Player p : players) results.add(new ScoreRecorder.Result(accountOf(p.id), p.kills, p.economy.earned));
        List<Integer> ranks;
        try {
            ranks = scores.record(mapId, round, partySize, results);
        } catch (RuntimeException e) {
            log.error("Room {}: couldn't save scores", code, e);
            ranks = players.stream().map(_ -> -1).toList();
        }
        List<ServerMessage.Result> table = new ArrayList<>();
        for (int i = 0; i < players.size(); i++) {
            Player p = players.get(i);
            table.add(new ServerMessage.Result(p.id, p.name, p.kills, p.economy.earned, ranks.get(i)));
        }
        broadcast(new ServerMessage.GameOver(round, table));
        backToLobby();
    }

    private void backToLobby() {
        sim = null;
        state = State.LOBBY;
        for (Member m : members.values()) {
            m.ready = false;
            m.inputs.clear();
        }
        broadcast(lobby());
    }

    private UUID accountOf(int id) {
        for (Member m : members.values()) if (m.id == id) return m.account;
        throw new IllegalStateException("No member for player " + id);
    }

    // --------------------------------------------------------------- messages

    private List<Member> ordered() {
        return members.values().stream().sorted(Comparator.comparingInt(m -> m.id)).toList();
    }

    private void broadcast(ServerMessage msg) {
        for (Member m : members.values()) if (m.conn != null) m.conn.send(msg);
    }

    private ServerMessage.Welcome welcome(Member m) {
        return new ServerMessage.Welcome(new ServerMessage.You(m.id, m.name), new ServerMessage.RoomInfo(code, mapId, mapVersion), map);
    }

    private ServerMessage.Lobby lobby() {
        var players = ordered().stream().map(m -> new ServerMessage.LobbyPlayer(m.id, m.name, m.ready, m.conn != null)).toList();
        return new ServerMessage.Lobby(code, state.name().toLowerCase(Locale.ROOT), ownerId, players);
    }

    // --------------------------------------------------------------- for tests

    synchronized GameSim sim() {
        return sim;
    }

    /** Changes the sim between ticks, from any thread. */
    synchronized void withSim(java.util.function.Consumer<GameSim> change) {
        if (sim != null) change.accept(sim);
    }

    synchronized int memberCount() {
        return members.size();
    }

    synchronized boolean isClosed() {
        return closed;
    }

    synchronized long currentTick() {
        return tick;
    }
}
