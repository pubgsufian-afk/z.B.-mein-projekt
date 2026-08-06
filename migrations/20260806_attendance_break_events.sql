BEGIN;

ALTER TABLE attendance_events
  DROP CONSTRAINT IF EXISTS attendance_events_action_check;

ALTER TABLE attendance_events
  ADD CONSTRAINT attendance_events_action_check
  CHECK (action IN ('clock-in', 'break-start', 'break-end', 'clock-out'));

COMMIT;
