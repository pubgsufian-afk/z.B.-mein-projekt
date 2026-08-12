DO $$
DECLARE
  schedule_weekday_rows integer;
  schedule_saturday_rows integer;
  timesheet_weekday_rows integer;
  timesheet_saturday_rows integer;
BEGIN
  SELECT count(*)
    INTO schedule_weekday_rows
  FROM schedule_shifts
  WHERE lower(btrim(employee_name)) = lower('Amin Khalaf Kije')
    AND shift_date IN (
      DATE '2026-08-03', DATE '2026-08-04', DATE '2026-08-05', DATE '2026-08-06',
      DATE '2026-08-07', DATE '2026-08-10', DATE '2026-08-11', DATE '2026-08-12'
    )
    AND start_time = TIME '07:30'
    AND end_time = TIME '16:30';

  SELECT count(*)
    INTO schedule_saturday_rows
  FROM schedule_shifts
  WHERE lower(btrim(employee_name)) = lower('Amin Khalaf Kije')
    AND shift_date = DATE '2026-08-08'
    AND start_time = TIME '07:00'
    AND end_time = TIME '17:00';

  IF schedule_weekday_rows <> 8 OR schedule_saturday_rows <> 1 THEN
    RAISE EXCEPTION 'Expected Amin schedule rows: 8 weekday + 1 Saturday, found % weekday + % Saturday', schedule_weekday_rows, schedule_saturday_rows;
  END IF;

  SELECT count(*)
    INTO timesheet_weekday_rows
  FROM timesheet_entries
  WHERE lower(btrim(employee_name)) = lower('Amin Khalaf Kije')
    AND work_date IN (
      DATE '2026-08-03', DATE '2026-08-04', DATE '2026-08-05', DATE '2026-08-06',
      DATE '2026-08-07', DATE '2026-08-10', DATE '2026-08-11', DATE '2026-08-12'
    )
    AND start_time = TIME '07:30'
    AND end_time = TIME '16:30';

  SELECT count(*)
    INTO timesheet_saturday_rows
  FROM timesheet_entries
  WHERE lower(btrim(employee_name)) = lower('Amin Khalaf Kije')
    AND work_date = DATE '2026-08-08'
    AND start_time = TIME '07:00'
    AND end_time = TIME '17:00';

  IF timesheet_weekday_rows <> 8 OR timesheet_saturday_rows <> 1 THEN
    RAISE EXCEPTION 'Expected Amin timesheet rows: 8 weekday + 1 Saturday, found % weekday + % Saturday', timesheet_weekday_rows, timesheet_saturday_rows;
  END IF;

  UPDATE schedule_shifts
     SET pause_minutes = 30,
         updated_at = now(),
         updated_by = 'dienstplan-assistent'
   WHERE lower(btrim(employee_name)) = lower('Amin Khalaf Kije')
     AND shift_date IN (
       DATE '2026-08-03', DATE '2026-08-04', DATE '2026-08-05', DATE '2026-08-06',
       DATE '2026-08-07', DATE '2026-08-10', DATE '2026-08-11', DATE '2026-08-12'
     )
     AND start_time = TIME '07:30'
     AND end_time = TIME '16:30';

  UPDATE schedule_shifts
     SET pause_minutes = 0,
         updated_at = now(),
         updated_by = 'dienstplan-assistent'
   WHERE lower(btrim(employee_name)) = lower('Amin Khalaf Kije')
     AND shift_date = DATE '2026-08-08'
     AND start_time = TIME '07:00'
     AND end_time = TIME '17:00';

  UPDATE timesheet_entries
     SET pause_minutes = 30,
         net_minutes = 510,
         updated_at = now(),
         updated_by = 'dienstplan-assistent'
   WHERE lower(btrim(employee_name)) = lower('Amin Khalaf Kije')
     AND work_date IN (
       DATE '2026-08-03', DATE '2026-08-04', DATE '2026-08-05', DATE '2026-08-06',
       DATE '2026-08-07', DATE '2026-08-10', DATE '2026-08-11', DATE '2026-08-12'
     )
     AND start_time = TIME '07:30'
     AND end_time = TIME '16:30';

  UPDATE timesheet_entries
     SET pause_minutes = 0,
         net_minutes = 600,
         updated_at = now(),
         updated_by = 'dienstplan-assistent'
   WHERE lower(btrim(employee_name)) = lower('Amin Khalaf Kije')
     AND work_date = DATE '2026-08-08'
     AND start_time = TIME '07:00'
     AND end_time = TIME '17:00';
END $$;
