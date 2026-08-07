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
