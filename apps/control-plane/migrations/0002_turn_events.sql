CREATE TABLE turn_event (
  turn_id uuid NOT NULL REFERENCES turn(id),
  seq integer NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (turn_id, seq)
);

CREATE TRIGGER turn_event_no_update_or_delete
  BEFORE UPDATE OR DELETE ON turn_event
  FOR EACH ROW EXECUTE FUNCTION trajectory_append_only();

CREATE TRIGGER turn_event_no_truncate
  BEFORE TRUNCATE ON turn_event
  FOR EACH STATEMENT EXECUTE FUNCTION trajectory_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON turn_event FROM sga_app;

CREATE TABLE action_result (
  action_id uuid PRIMARY KEY,
  turn_id uuid NOT NULL REFERENCES turn(id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
