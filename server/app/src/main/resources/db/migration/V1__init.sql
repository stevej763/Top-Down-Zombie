CREATE TABLE players (
    id         uuid PRIMARY KEY,
    name       varchar(20) NOT NULL,
    token_hash bytea       NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scores (
    id         bigserial PRIMARY KEY,
    player_id  uuid        NOT NULL REFERENCES players (id),
    map_id     text        NOT NULL,
    round      int         NOT NULL,
    kills      int         NOT NULL,
    points     int         NOT NULL,
    party_size int         NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scores_leaderboard ON scores (map_id, round DESC, kills DESC, points DESC);
