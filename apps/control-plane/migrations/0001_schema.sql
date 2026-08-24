CREATE TABLE device (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  quota_override integer
);

CREATE TABLE turn (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES device(id),
  origin text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('observe', 'control')),
  task_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'refused', 'stopped')),
  counted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX turn_device_id_idx ON turn (device_id);

CREATE TABLE trajectory (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  turn_id uuid NOT NULL REFERENCES turn(id),
  seq integer NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (turn_id, seq)
);

CREATE FUNCTION trajectory_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'trajectory is append-only';
END;
$$;

CREATE TRIGGER trajectory_no_update_or_delete
  BEFORE UPDATE OR DELETE ON trajectory
  FOR EACH ROW EXECUTE FUNCTION trajectory_append_only();

CREATE TRIGGER trajectory_no_truncate
  BEFORE TRUNCATE ON trajectory
  FOR EACH STATEMENT EXECUTE FUNCTION trajectory_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON trajectory FROM sga_app;

CREATE TABLE device_usage (
  device_id uuid NOT NULL REFERENCES device(id),
  day date NOT NULL,
  used integer NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, day)
);

CREATE TABLE ip_usage (
  ip_hash text NOT NULL,
  day date NOT NULL,
  used integer NOT NULL DEFAULT 0,
  registrations integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);

CREATE TABLE confirmation (
  action_id uuid PRIMARY KEY,
  turn_id uuid NOT NULL REFERENCES turn(id),
  params_hash text NOT NULL,
  approved boolean NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
