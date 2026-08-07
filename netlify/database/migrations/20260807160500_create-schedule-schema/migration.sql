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

CREATE OR REPLACE FUNCTION portal_publish_chat_shift(
  p_employee_user_id text,
  p_shift_date date,
  p_start_time time without time zone,
  p_end_time time without time zone,
  p_location text,
  p_work_area text,
  p_pause_minutes integer DEFAULT 0,
  p_note text DEFAULT '',
  p_source_request_id text DEFAULT NULL
)
RETURNS TABLE(result text, shift_id text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_employee_name text;
  v_existing_id text;
  v_inserted_id text;
  v_id text := gen_random_uuid()::text;
  v_now timestamp with time zone := now();
  v_location text := btrim(coalesce(p_location, ''));
  v_work_area text := btrim(coalesce(p_work_area, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_duration_minutes integer;
BEGIN
  IF p_employee_user_id IS NULL OR btrim(p_employee_user_id) = '' THEN
    RAISE EXCEPTION 'Mitarbeiter fehlt.';
  END IF;
  IF p_shift_date IS NULL OR p_start_time IS NULL OR p_end_time IS NULL THEN
    RAISE EXCEPTION 'Datum, Beginn und Ende sind erforderlich.';
  END IF;
  IF v_location = '' OR v_work_area = '' THEN
    RAISE EXCEPTION 'Einsatzort und Arbeitsbereich sind erforderlich.';
  END IF;
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'Dienstende muss nach Dienstbeginn liegen.';
  END IF;

  v_duration_minutes := floor(extract(epoch FROM (p_end_time - p_start_time)) / 60)::integer;
  IF p_pause_minutes IS NULL OR p_pause_minutes < 0 OR p_pause_minutes >= v_duration_minutes THEN
    RAISE EXCEPTION 'Pause ist für diese Dienstzeit ungültig.';
  END IF;

  SELECT full_name
    INTO v_employee_name
    FROM schedule_employees
   WHERE user_id = btrim(p_employee_user_id)
     AND status = 'active';

  IF v_employee_name IS NULL THEN
    RAISE EXCEPTION 'Mitarbeiter ist nicht aktiv.';
  END IF;

  SELECT id
    INTO v_existing_id
    FROM schedule_shifts
   WHERE employee_user_id = btrim(p_employee_user_id)
     AND shift_date = p_shift_date
     AND start_time = p_start_time
     AND end_time = p_end_time
     AND lower(btrim(location)) = lower(v_location)
     AND lower(btrim(work_area)) = lower(v_work_area)
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT 'duplicate'::text, v_existing_id;
    RETURN;
  END IF;

  INSERT INTO schedule_shifts (
    id, employee_user_id, employee_name, shift_date, start_time, end_time,
    pause_minutes, object_id, location, work_area, note, status, version,
    template_id, repeat_group_id, created_at, created_by, updated_at, updated_by,
    published_at, published_by, source, source_ref
  ) VALUES (
    v_id, btrim(p_employee_user_id), v_employee_name, p_shift_date, p_start_time, p_end_time,
    p_pause_minutes, NULL, v_location, v_work_area, v_note, 'published', 1,
    NULL, NULL, v_now, 'chatgpt', v_now, 'chatgpt',
    v_now, 'chatgpt', 'chatgpt', nullif(btrim(coalesce(p_source_request_id, '')), '')
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    SELECT id
      INTO v_existing_id
      FROM schedule_shifts
     WHERE employee_user_id = btrim(p_employee_user_id)
       AND shift_date = p_shift_date
       AND start_time = p_start_time
       AND end_time = p_end_time
       AND lower(btrim(location)) = lower(v_location)
       AND lower(btrim(work_area)) = lower(v_work_area)
     LIMIT 1;

    IF v_existing_id IS NULL THEN
      RAISE EXCEPTION 'Dienst konnte wegen eines Datenkonflikts nicht gespeichert werden.';
    END IF;
    RETURN QUERY SELECT 'duplicate'::text, v_existing_id;
    RETURN;
  END IF;

  INSERT INTO schedule_audit_log (
    id, occurred_at, actor_id, actor_type, action, shift_id, details
  ) VALUES (
    gen_random_uuid()::text,
    v_now,
    'chatgpt',
    'chatgpt',
    'shift-published',
    v_inserted_id,
    jsonb_build_object(
      'employeeUserId', btrim(p_employee_user_id),
      'date', p_shift_date,
      'start', to_char(p_start_time, 'HH24:MI'),
      'end', to_char(p_end_time, 'HH24:MI'),
      'location', v_location,
      'workArea', v_work_area,
      'pauseMinutes', p_pause_minutes,
      'sourceRequestId', nullif(btrim(coalesce(p_source_request_id, '')), '')
    )
  );

  RETURN QUERY SELECT 'published'::text, v_inserted_id;
END;
$$;
