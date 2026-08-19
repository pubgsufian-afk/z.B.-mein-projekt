DO $$
DECLARE
  canonical_mohamed_user_id text;
  policy record;
BEGIN
  SELECT employee_user_id
    INTO canonical_mohamed_user_id
  FROM schedule_shifts
  WHERE lower(btrim(employee_name)) = lower('Mohamed Ahmed warsame')
  ORDER BY shift_date DESC, updated_at DESC, id
  LIMIT 1;

  IF canonical_mohamed_user_id IS NULL THEN
    SELECT employee_user_id
      INTO canonical_mohamed_user_id
    FROM timesheet_entries
    WHERE lower(btrim(employee_name)) = lower('Mohamed Ahmed warsame')
    ORDER BY work_date DESC, updated_at DESC, id
    LIMIT 1;
  END IF;

  IF canonical_mohamed_user_id IS NULL THEN
    RAISE EXCEPTION 'Cannot merge Mohamad: canonical Mohamed Ahmed warsame identity was not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM schedule_shifts legacy
    JOIN schedule_shifts canonical
      ON canonical.id <> legacy.id
     AND canonical.employee_user_id = canonical_mohamed_user_id
     AND canonical.shift_date = legacy.shift_date
     AND canonical.start_time = legacy.start_time
     AND canonical.end_time = legacy.end_time
     AND lower(canonical.location) = lower(legacy.location)
     AND lower(canonical.work_area) = lower(legacy.work_area)
    WHERE lower(btrim(legacy.employee_name)) = lower('Mohamad')
      AND legacy.employee_user_id <> canonical_mohamed_user_id
  ) THEN
    RAISE EXCEPTION 'Cannot merge Mohamad automatically because an exact duplicate shift would be created';
  END IF;

  UPDATE schedule_shifts
     SET employee_user_id = canonical_mohamed_user_id,
         employee_name = 'Mohamed Ahmed warsame',
         updated_at = now(),
         updated_by = 'dienstplan-assistent'
   WHERE lower(btrim(employee_name)) IN (lower('Mohamad'), lower('Mohamed Ahmed warsame'))
     AND (employee_user_id <> canonical_mohamed_user_id OR employee_name <> 'Mohamed Ahmed warsame');

  UPDATE timesheet_entries
     SET employee_user_id = canonical_mohamed_user_id,
         employee_name = 'Mohamed Ahmed warsame',
         updated_at = now(),
         updated_by = 'dienstplan-assistent'
   WHERE lower(btrim(employee_name)) IN (lower('Mohamad'), lower('Mohamed Ahmed warsame'))
     AND (employee_user_id <> canonical_mohamed_user_id OR employee_name <> 'Mohamed Ahmed warsame');

  UPDATE schedule_employees
     SET full_name = 'Mohamed Ahmed warsame',
         synced_at = now()
   WHERE user_id = canonical_mohamed_user_id;

  UPDATE schedule_employees
     SET status = 'inactive',
         synced_at = now()
   WHERE user_id <> canonical_mohamed_user_id
     AND user_id LIKE 'guest:%'
     AND lower(btrim(full_name)) = lower('Mohamad');

  FOR policy IN
    SELECT *
    FROM (VALUES
      ('Amin Khalaf Kije', 30),
      ('Almusa', 60),
      ('Amjad', 60),
      ('Kanee', 60),
      ('Mohamed Ahmed warsame', 60)
    ) AS pause_policy(employee_name, target_pause_minutes)
  LOOP
    WITH ranked AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY shift_date
               ORDER BY (end_time - start_time) DESC, start_time, id
             ) AS daily_rank
      FROM schedule_shifts
      WHERE lower(btrim(employee_name)) = lower(policy.employee_name)
        AND shift_date BETWEEN DATE '2026-08-01' AND DATE '2026-08-19'
    )
    UPDATE schedule_shifts AS shift
       SET pause_minutes = CASE WHEN ranked.daily_rank = 1 THEN policy.target_pause_minutes ELSE 0 END,
           updated_at = now(),
           updated_by = 'dienstplan-assistent'
      FROM ranked
     WHERE shift.id = ranked.id;

    WITH ranked AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY work_date
               ORDER BY (end_time - start_time) DESC, start_time, id
             ) AS daily_rank
      FROM timesheet_entries
      WHERE lower(btrim(employee_name)) = lower(policy.employee_name)
        AND work_date BETWEEN DATE '2026-08-01' AND DATE '2026-08-19'
        AND suppressed = false
    )
    UPDATE timesheet_entries AS entry
       SET pause_minutes = CASE WHEN ranked.daily_rank = 1 THEN policy.target_pause_minutes ELSE 0 END,
           net_minutes = GREATEST(
             0,
             floor(extract(epoch FROM (entry.end_time - entry.start_time)) / 60)::integer
             - CASE WHEN ranked.daily_rank = 1 THEN policy.target_pause_minutes ELSE 0 END
           ),
           updated_at = now(),
           updated_by = 'dienstplan-assistent'
      FROM ranked
     WHERE entry.id = ranked.id;
  END LOOP;

  UPDATE timesheet_entries AS entry
     SET employee_user_id = shift.employee_user_id,
         employee_name = shift.employee_name,
         pause_minutes = shift.pause_minutes,
         net_minutes = GREATEST(
           0,
           floor(extract(epoch FROM (shift.end_time - shift.start_time)) / 60)::integer - shift.pause_minutes
         ),
         updated_at = now(),
         updated_by = 'dienstplan-assistent'
    FROM schedule_shifts AS shift
   WHERE entry.schedule_shift_id = shift.id
     AND entry.manual_override = false
     AND entry.suppressed = false
     AND shift.shift_date BETWEEN DATE '2026-08-01' AND DATE '2026-08-19'
     AND lower(btrim(shift.employee_name)) IN (
       lower('Amin Khalaf Kije'),
       lower('Almusa'),
       lower('Amjad'),
       lower('Kanee'),
       lower('Mohamed Ahmed warsame')
     );
END $$;
