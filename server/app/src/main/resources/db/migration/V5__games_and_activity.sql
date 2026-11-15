-- When each player last had the app open (heartbeat) or a socket opened or closed.
ALTER TABLE players ADD COLUMN last_seen_at timestamptz;
UPDATE players SET last_seen_at = created_at;
CREATE INDEX players_last_seen ON players(last_seen_at DESC);

-- One row per game started in a room, finished or not.
CREATE TABLE games (
    id          uuid PRIMARY KEY,
    room_code   text NOT NULL,
    map_id      text NOT NULL,
    map_version int NOT NULL,
    solo        boolean NOT NULL,
    seed        bigint NOT NULL,
    party_size  int NOT NULL,
    started_at  timestamptz NOT NULL,
    ended_at    timestamptz,
    -- over | abandoned | crashed | shutdown; null while it's running
    end_reason  text,
    -- rounds survived, as in scores
    round       int
);
CREATE INDEX games_started ON games(started_at DESC);

CREATE TABLE game_players (
    game_id   uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id uuid NOT NULL REFERENCES players(id),
    sim_id    int NOT NULL,
    name      varchar(20) NOT NULL,
    kills     int NOT NULL DEFAULT 0,
    points    int NOT NULL DEFAULT 0,
    left_at   timestamptz,
    PRIMARY KEY (game_id, player_id)
);
CREATE INDEX game_players_player ON game_players(player_id);

ALTER TABLE scores ADD COLUMN game_id uuid REFERENCES games(id);
