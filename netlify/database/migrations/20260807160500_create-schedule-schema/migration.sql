CREATE TABLE schedule_employees (
  user_id text PRIMARY KEY,
  full_name text NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  location text NOT NULL DEFAULT '',
  synced_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT schedule_employees_name_check CHECK (length(btrim(full_name)) > 0),
  CONSTRAINT schedule_employees_role_check CHECK (role IN ('owner', 'admin', 'manager', 'scheduler', 'employee')),
  CONSTRAINT schedule_employees_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX schedule_employees_name_idx ON schedule_employees (lower(full_name));
CREATE INDEX schedule_employees_status_name_idx ON schedule_employees (status, lower(full_name));

CREATE TABLE schedule_shifts (
  id text PRIMARY KEY,
  employee_user_id text NOT NULL,
  employee_name text NOT NULL,
  shift_date date NOT NULL,
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  pause_minutes integer NOT NULL DEFAULT 0,
  object_id text,
  location text NOT NULL,
  work_area text NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 0,
  template_id text,
  repeat_group_id text,
  created_at timestamp with time zone NOT NULL,
  created_by text NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  updated_by text NOT NULL,
  published_at timestamp with time zone,
  published_by text,
  source text NOT NULL DEFAULT 'portal',
  source_ref text,
  CONSTRAINT schedule_shifts_employee_name_check CHECK (length(btrim(employee_name)) > 0),
  CONSTRAINT schedule_shifts_location_check CHECK (length(btrim(location)) > 0),
  CONSTRAINT schedule_shifts_work_area_check CHECK (length(btrim(work_area)) > 0),
  CONSTRAINT schedule_shifts_pause_check CHECK (pause_minutes >= 0),
  CONSTRAINT schedule_shifts_time_check CHECK (end_time > start_time),
  CONSTRAINT schedule_shifts_status_check CHECK (status IN ('draft', 'published')),
  CONSTRAINT schedule_shifts_source_check CHECK (source IN ('portal', 'chatgpt', 'legacy-blob'))
);

CREATE UNIQUE INDEX schedule_shifts_exact_duplicate_idx
  ON schedule_shifts (employee_user_id, shift_date, start_time, end_time, lower(location), lower(work_area));
CREATE INDEX schedule_shifts_date_start_idx ON schedule_shifts (shift_date, start_time, employee_name);
CREATE INDEX schedule_shifts_employee_date_idx ON schedule_shifts (employee_user_id, shift_date, start_time);
CREATE INDEX schedule_shifts_status_date_idx ON schedule_shifts (status, shift_date, start_time);

CREATE TABLE schedule_versions (
  week_start date NOT NULL,
  version integer NOT NULL,
  published_at timestamp with time zone NOT NULL,
  published_by text NOT NULL,
  shift_ids jsonb NOT NULL,
  PRIMARY KEY (week_start, version),
  CONSTRAINT schedule_versions_shift_ids_check CHECK (jsonb_typeof(shift_ids) = 'array')
);

CREATE TABLE schedule_migrations (
  migration_key text PRIMARY KEY,
  completed_at timestamp with time zone NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT schedule_migrations_details_check CHECK (jsonb_typeof(details) = 'object')
);

CREATE TABLE schedule_audit_log (
  id text PRIMARY KEY,
  occurred_at timestamp with time zone NOT NULL,
  actor_id text NOT NULL,
  actor_type text NOT NULL,
  action text NOT NULL,
  shift_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT schedule_audit_actor_type_check CHECK (actor_type IN ('portal', 'chatgpt', 'migration')),
  CONSTRAINT schedule_audit_details_check CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX schedule_audit_time_idx ON schedule_audit_log (occurred_at DESC);
CREATE INDEX schedule_audit_shift_idx ON schedule_audit_log (shift_id, occurred_at DESC);
