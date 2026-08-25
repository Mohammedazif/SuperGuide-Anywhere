ALTER TABLE turn DROP CONSTRAINT turn_status_check;
ALTER TABLE turn ADD CONSTRAINT turn_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'refused', 'stopped', 'needs-input'));

ALTER TABLE action_result ADD COLUMN digest jsonb;
