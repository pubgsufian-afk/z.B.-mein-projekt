DO $$
DECLARE
  expected record;
  actual_count integer;
BEGIN
  FOR expected IN
    SELECT *
    FROM (VALUES
      ('ZuKo',                  '06:00'::time, '11:00'::time, 1,  0),
      ('ZuKo',                  '11:00'::time, '18:00'::time, 1,  0),
      ('Brandwach',             '18:00'::time, '23:00'::time, 1,  0),
      ('Lager+AufzugBediener',  '07:30'::time, '16:30'::time, 1, 30),
      ('Brandwach',             '07:00'::time, '17:00'::time, 2, 60),
      ('GMP Rundgang',          '07:00'::time, '17:00'::time, 2, 60),
      ('Brandwach',             '17:00'::time, '23:00'::time, 1,  0),
      ('ZuKo GMP',              '07:00'::time, '17:00'::time, 1, 60),
      ('Bauhelfer',             '08:30'::time, '17:00'::time, 2, 30),
      ('Baureinigung',          '07:30'::time, '16:30'::time, 1, 30),
      ('Staplerfahrer',         '08:00'::time, '16:00'::time, 1,  0)
    ) AS policy(work_area, start_time, end_time, expected_count, target_pause_minutes)
  LOOP
    SELECT count(*)::integer
      INTO actual_count
      FROM schedule_shifts
     WHERE shift_date = DATE '2026-08-20'
       AND start_time = expected.start_time
       AND end_time = expected.end_time
       AND lower(btrim(work_area)) = lower(expected.work_area);

    IF actual_count <> expected.expected_count THEN
      RAISE EXCEPTION 'Dienstplan 20.08.2026 unvollständig bei % %-%: erwartet %, gefunden %',
        expected.work_area, expected.start_time, expected.end_time, expected.expected_count, actual_count;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM schedule_shifts
       WHERE shift_date = DATE '2026-08-20'
         AND start_time = expected.start_time
         AND end_time = expected.end_time
         AND lower(btrim(work_area)) = lower(expected.work_area)
         AND status <> 'published'
    ) THEN
      RAISE EXCEPTION 'Dienstplan 20.08.2026 enthält nicht veröffentlichte Schichten bei % %-%',
        expected.work_area, expected.start_time, expected.end_time;
    END IF;

    UPDATE schedule_shifts
       SET pause_minutes = expected.target_pause_minutes,
           updated_at = now(),
           updated_by = 'dienstplan-assistent'
     WHERE shift_date = DATE '2026-08-20'
       AND start_time = expected.start_time
       AND end_time = expected.end_time
       AND lower(btrim(work_area)) = lower(expected.work_area);

    SELECT count(*)::integer
      INTO actual_count
      FROM schedule_shifts
     WHERE shift_date = DATE '2026-08-20'
       AND start_time = expected.start_time
       AND end_time = expected.end_time
       AND lower(btrim(work_area)) = lower(expected.work_area)
       AND pause_minutes = expected.target_pause_minutes;

    IF actual_count <> expected.expected_count THEN
      RAISE EXCEPTION 'Pausenkorrektur 20.08.2026 fehlgeschlagen bei % %-%',
        expected.work_area, expected.start_time, expected.end_time;
    END IF;
  END LOOP;

  UPDATE timesheet_entries AS entry
     SET pause_minutes = shift.pause_minutes,
         net_minutes = GREATEST(
           0,
           floor(extract(epoch FROM (shift.end_time - shift.start_time)) / 60)::integer - shift.pause_minutes
         ),
         updated_at = now(),
         updated_by = 'dienstplan-assistent'
    FROM schedule_shifts AS shift
   WHERE entry.schedule_shift_id = shift.id
     AND shift.shift_date = DATE '2026-08-20'
     AND entry.manual_override = false
     AND entry.suppressed = false;
END $$;
