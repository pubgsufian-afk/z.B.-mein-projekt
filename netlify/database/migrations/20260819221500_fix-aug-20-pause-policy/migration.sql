DO $$
BEGIN
  UPDATE schedule_shifts
     SET pause_minutes = CASE
       WHEN lower(btrim(work_area)) IN ('gmp rundgang', 'zuko gmp') THEN 60
       WHEN lower(btrim(work_area)) IN ('bauhelfer', 'baureinigung') THEN 30
       WHEN lower(btrim(work_area)) IN ('zuko', 'brandwach', 'lager+aufzugbediener', 'staplerfahrer') THEN 0
       ELSE pause_minutes
     END,
         updated_at = now(),
         updated_by = 'dienstplan-assistent'
   WHERE shift_date = DATE '2026-08-20'
     AND lower(btrim(work_area)) IN (
       'gmp rundgang',
       'zuko gmp',
       'bauhelfer',
       'baureinigung',
       'zuko',
       'brandwach',
       'lager+aufzugbediener',
       'staplerfahrer'
     );

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
