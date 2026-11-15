-- Accounts: a player with an email and password. Players without one are guests.
-- Tokens move to their own table so an account can be signed in on several devices at once.

CREATE TABLE player_tokens (
    token_hash   bytea PRIMARY KEY,
    player_id    uuid        NOT NULL REFERENCES players (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX player_tokens_player ON player_tokens (player_id);

INSERT INTO player_tokens (token_hash, player_id, created_at, last_used_at)
SELECT token_hash, id, created_at, created_at FROM players;

ALTER TABLE players DROP COLUMN token_hash;

ALTER TABLE players
    ADD COLUMN email         varchar(254),
    ADD COLUMN password_hash text,
    ADD COLUMN account_at    timestamptz;

-- Emails and account usernames are unique ignoring case; guest names aren't.
CREATE UNIQUE INDEX players_email ON players (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX players_account_name ON players (lower(name)) WHERE email IS NOT NULL;
