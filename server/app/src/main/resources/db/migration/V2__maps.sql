CREATE TABLE maps (
    id         text PRIMARY KEY,
    name       text        NOT NULL,
    version    int         NOT NULL,
    data       jsonb       NOT NULL,
    published  boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
