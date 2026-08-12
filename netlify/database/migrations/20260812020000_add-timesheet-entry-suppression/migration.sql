ALTER TABLE timesheet_entries
  ADD COLUMN suppressed boolean NOT NULL DEFAULT false,
  ADD COLUMN suppressed_at timestamp with time zone,
  ADD COLUMN suppressed_by text;

CREATE INDEX timesheet_entries_visible_range_idx
  ON timesheet_entries(work_date, employee_user_id, start_time)
  WHERE suppressed = false;
