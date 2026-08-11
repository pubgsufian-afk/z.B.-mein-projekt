CREATE TABLE timesheet_months (
  month_key text PRIMARY KEY,
  correction_deadline date NOT NULL,
  closed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT timesheet_months_key_check CHECK (month_key ~ '^\d{4}-\d{2}$')
);

CREATE TABLE timesheet_entries (
  id text PRIMARY KEY,
  schedule_shift_id text,
  employee_user_id text NOT NULL,
  employee_name text NOT NULL,
  work_date date NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  pause_minutes integer NOT NULL DEFAULT 0,
  net_minutes integer NOT NULL DEFAULT 0,
  location text NOT NULL DEFAULT '',
  work_area text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'schedule',
  manual_override boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  CONSTRAINT timesheet_entries_pause_check CHECK (pause_minutes >= 0),
  CONSTRAINT timesheet_entries_net_check CHECK (net_minutes >= 0),
  CONSTRAINT timesheet_entries_source_check CHECK (source IN ('schedule', 'manual'))
);

CREATE UNIQUE INDEX timesheet_entries_schedule_shift_idx
  ON timesheet_entries(schedule_shift_id)
  WHERE schedule_shift_id IS NOT NULL;

CREATE INDEX timesheet_entries_month_employee_idx
  ON timesheet_entries(work_date, employee_user_id, start_time);

CREATE TABLE timesheet_audit_log (
  id text PRIMARY KEY,
  occurred_at timestamp with time zone NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  entry_id text,
  month_key text NOT NULL,
  reason text,
  before_data jsonb,
  after_data jsonb
);

CREATE INDEX timesheet_audit_month_time_idx
  ON timesheet_audit_log(month_key, occurred_at DESC);
