-- Where and on what players play, for the admin portal. IPs are as the server saw them (behind
-- nginx, the first X-Forwarded-For hop).
ALTER TABLE players ADD COLUMN created_ip text;
ALTER TABLE players ADD COLUMN last_ip text;

-- Every address a player has registered, sent a heartbeat or opened a game socket from.
CREATE TABLE player_ips (
    player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    ip            text NOT NULL,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, ip)
);
CREATE INDEX player_ips_ip ON player_ips(ip);

-- One row per player per device: a random id the client keeps in localStorage. Reported with the
-- heartbeat. `details` holds the rest (screen, language, time zone, cores, memory, touch, ...).
CREATE TABLE player_devices (
    player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    device_id     text NOT NULL,
    -- web | ios | android
    platform      text NOT NULL,
    os            text,
    browser       text,
    model         text,
    user_agent    text,
    ip            text,
    details       jsonb NOT NULL DEFAULT '{}',
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, device_id)
);
CREATE INDEX player_devices_seen ON player_devices(last_seen_at DESC);
