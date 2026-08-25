-- The record stays append-only in every normal path; the single exception is the
-- person's right to erasure, exercised through one owner-defined function that
-- arms a transaction-local flag the trigger honours for DELETE alone.
CREATE OR REPLACE FUNCTION trajectory_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('sga.allow_erasure', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'trajectory is append-only';
END;
$$;

CREATE FUNCTION erase_device(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('sga.allow_erasure', 'on', true);
  DELETE FROM trajectory WHERE turn_id IN (SELECT id FROM turn WHERE device_id = target);
  DELETE FROM turn_event WHERE turn_id IN (SELECT id FROM turn WHERE device_id = target);
  DELETE FROM action_result WHERE turn_id IN (SELECT id FROM turn WHERE device_id = target);
  DELETE FROM confirmation WHERE turn_id IN (SELECT id FROM turn WHERE device_id = target);
  DELETE FROM turn WHERE device_id = target;
  DELETE FROM device_usage WHERE device_id = target;
  DELETE FROM device WHERE id = target;
  PERFORM set_config('sga.allow_erasure', 'off', true);
END;
$$;

GRANT EXECUTE ON FUNCTION erase_device(uuid) TO sga_app;
