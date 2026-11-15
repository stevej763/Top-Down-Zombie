-- Admin portal logins. Usernames are stored lower-cased; sessions keep only the SHA-256 of their cookie.
CREATE TABLE admin_users (
    id            uuid PRIMARY KEY,
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
);

CREATE TABLE admin_sessions (
    id           uuid PRIMARY KEY,
    token_hash   bytea NOT NULL UNIQUE,
    admin_id     uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    last_used_at timestamptz NOT NULL DEFAULT now()
);
