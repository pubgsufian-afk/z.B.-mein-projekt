-- Remote attendance entries are NOT employee schedule assignments.
-- Allow only the synthetic attendance-flex source on explicitly free days.
-- Real scheduled work remains blocked on free days.
CREATE OR REPLACE FUNCTION habun_guard_shift_against_day_off()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'attendance-flex' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW.employee_user_id || '|' || NEW.shift_date::text)::bigint);
  IF EXISTS (
    SELECT 1 FROM schedule_days_off
    WHERE employee_user_id = NEW.employee_user_id AND day_off_date = NEW.shift_date
  ) THEN
    RAISE EXCEPTION 'HABUN_DAY_OFF_CONFLICT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION habun_guard_day_off_against_shift()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.employee_user_id || '|' || NEW.day_off_date::text)::bigint);
  IF EXISTS (
    SELECT 1 FROM schedule_shifts
    WHERE employee_user_id = NEW.employee_user_id
      AND shift_date = NEW.day_off_date
      AND source <> 'attendance-flex'
  ) THEN
    RAISE EXCEPTION 'HABUN_SHIFT_CONFLICT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
