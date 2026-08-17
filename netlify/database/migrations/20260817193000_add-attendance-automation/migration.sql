ALTER TABLE schedule_shifts
  DROP CONSTRAINT IF EXISTS schedule_shifts_source_check;

ALTER TABLE schedule_shifts
  ADD CONSTRAINT schedule_shifts_source_check
  CHECK (source IN ('portal', 'chatgpt', 'legacy-blob', 'attendance-flex'));

ALTER TABLE schedule_shifts
  DROP CONSTRAINT IF EXISTS schedule_shifts_time_check;

ALTER TABLE schedule_shifts
  ADD CONSTRAINT schedule_shifts_time_check
  CHECK (end_time <> start_time);

ALTER TABLE schedule_audit_log
  DROP CONSTRAINT IF EXISTS schedule_audit_actor_type_check;

ALTER TABLE schedule_audit_log
  ADD CONSTRAINT schedule_audit_actor_type_check
  CHECK (actor_type IN ('portal', 'chatgpt', 'migration', 'system'));

ALTER TABLE attendance_audit_log
  DROP CONSTRAINT IF EXISTS attendance_audit_log_actor_role_check;

ALTER TABLE attendance_audit_log
  ADD CONSTRAINT attendance_audit_log_actor_role_check
  CHECK (actor_role IN ('owner', 'admin', 'manager', 'employee', 'system'));
