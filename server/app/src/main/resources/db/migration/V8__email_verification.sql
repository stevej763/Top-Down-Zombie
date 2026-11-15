-- Email verification: an account proves it owns its address by typing a 6-digit code it was sent.
-- Until then it plays under guest rules.

ALTER TABLE players ADD COLUMN email_verified_at timestamptz;

-- One live code per player. The address is kept with the code so it's only good for the address
-- it was sent to. sends and window_start cap how many codes a player can ask for in a day.
CREATE TABLE email_codes (
    player_id    uuid PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
    email        varchar(254) NOT NULL,
    code_hash    bytea        NOT NULL,
    attempts     int          NOT NULL DEFAULT 0,
    sent_at      timestamptz  NOT NULL,
    expires_at   timestamptz  NOT NULL,
    sends        int          NOT NULL DEFAULT 1,
    window_start timestamptz  NOT NULL
);
