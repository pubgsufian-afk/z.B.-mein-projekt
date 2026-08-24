DO $$
DECLARE
  schedule_rows integer;
  schedule_dates integer;
  timesheet_rows integer;
  timesheet_dates integer;
BEGIN
  SELECT count(*), count(DISTINCT shift_date)
    INTO schedule_rows, schedule_dates
  FROM schedule_shifts
  WHERE lower(btrim(employee_name)) = lower('Adel Abdal')
    AND shift_date IN (
      DATE '2026-08-03',
      DATE '2026-08-05',
      DATE '2026-08-06',
      DATE '2026-08-07'
    )
    AND start_time = TIME '07:00'
    AND end_time = TIME '17:00'
    AND lower(btrim(work_area)) = lower('ZuKo GMB');

  SELECT count(*), count(DISTINCT work_date)
    INTO timesheet_rows, timesheet_dates
  FROM timesheet_entries
  WHERE lower(btrim(employee_name)) = lower('Adel Abdal')
    AND work_date IN (
      DATE '2026-08-03',
      DATE '2026-08-05',
      DATE '2026-08-06',
      DATE '2026-08-07'
    )
    AND start_time = TIME '07:00'
    AND end_time = TIME '17:00'
    AND lower(btrim(work_area)) = lower('ZuKo GMB');

  IF schedule_rows = 0 AND schedule_dates = 0
     AND timesheet_rows = 0 AND timesheet_dates = 0 THEN
    RAISE NOTICE 'Skipping Adel pause correction because matching historical rows are absent in this database.';
    RETURN;
  END IF;

  IF schedule_rows <> 4 OR schedule_dates <> 4 THEN
    RAISE EXCEPTION 'Expected exactly 4 Adel schedule rows for pause correction, found % rows across % dates', schedule_rows, schedule_dates;
  END IF;

  IF timesheet_rows <> 4 OR timesheet_dates <> 4 THEN
    RAISE EXCEPTION 'Expected exactly 4 Adel timesheet rows for pause correction, found % rows across % dates', timesheet_rows, timesheet_dates;
  END IF;

  UPDATE schedule_shifts
     SET pause_minutes = 60,
         updated_at = now(),
         updated_by = 'dienstplan-assistent'
   WHERE lower(btrim(employee_name)) = lower('Adel Abdal')
     AND shift_date IN (
       DATE '2026-08-03',
       DATE '2026-08-05',
       DATE '2026-08-06',
       DATE '2026-08-07'
     )
     AND start_time = TIME '07:00'
     AND end_time = TIME '17:00'
     AND lower(btrim(work_area)) = lower('ZuKo GMB');

  UPDATE timesheet_entries
     SET pause_minutes = 60,
         net_minutes = 540,
         updated_at = now(),
         updated_by = 'dienstplan-assistent'
   WHERE lower(btrim(employee_name)) = lower('Adel Abdal')
     AND work_date IN (
       DATE '2026-08-03',
       DATE '2026-08-05',
       DATE '2026-08-06',
       DATE '2026-08-07'
     )
     AND start_time = TIME '07:00'
     AND end_time = TIME '17:00'
     AND lower(btrim(work_area)) = lower('ZuKo GMB');
END $$;
