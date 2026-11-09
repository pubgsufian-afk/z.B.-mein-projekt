-- Dienstfrei and Freiwunsch: separate from billable shifts and timesheets.
CREATE TABLE IF NOT EXISTS schedule_time_off_requests (
  id text PRIMARY KEY,
  employee_user_id text NOT NULL,
  employee_name text NOT NULL,
  requested_date date NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  decision_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text,
  CONSTRAINT time_off_request_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'revoked')),
  CONSTRAINT time_off_reason_check CHECK (length(btrim(reason)) BETWEEN 3 AND 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS schedule_time_off_one_open_request
  ON schedule_time_off_requests (employee_user_id, requested_date)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS schedule_time_off_requests_status_date
  ON schedule_time_off_requests (status, requested_date, created_at DESC);
CREATE INDEX IF NOT EXISTS schedule_time_off_requests_employee_date
  ON schedule_time_off_requests (employee_user_id, requested_date DESC);

CREATE TABLE IF NOT EXISTS schedule_days_off (
  employee_user_id text NOT NULL,
  day_off_date date NOT NULL,
  employee_name text NOT NULL,
  source text NOT NULL,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  PRIMARY KEY (employee_user_id, day_off_date),
  CONSTRAINT schedule_days_off_source_check CHECK (source IN ('manual', 'request'))
);
CREATE INDEX IF NOT EXISTS schedule_days_off_date ON schedule_days_off (day_off_date);

-- Serialize a shift and a day-off for the same employee/date, regardless of which API writes.
CREATE OR REPLACE FUNCTION habun_guard_shift_against_day_off()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.employee_user_id || '|' || NEW.shift_date::text)::bigint);
  IF EXISTS (
    SELECT 1 FROM schedule_days_off
    WHERE employee_user_id = NEW.employee_user_id AND day_off_date = NEW.shift_date
  ) THEN
    RAISE EXCEPTION 'HABUN_DAY_OFF_CONFLICT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS habun_shift_day_off_guard ON schedule_shifts;
CREATE TRIGGER habun_shift_day_off_guard
BEFORE INSERT OR UPDATE OF employee_user_id, shift_date ON schedule_shifts
FOR EACH ROW EXECUTE FUNCTION habun_guard_shift_against_day_off();

CREATE OR REPLACE FUNCTION habun_guard_day_off_against_shift()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.employee_user_id || '|' || NEW.day_off_date::text)::bigint);
  IF EXISTS (
    SELECT 1 FROM schedule_shifts
    WHERE employee_user_id = NEW.employee_user_id AND shift_date = NEW.day_off_date
  ) THEN
    RAISE EXCEPTION 'HABUN_SHIFT_CONFLICT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS habun_day_off_shift_guard ON schedule_days_off;
CREATE TRIGGER habun_day_off_shift_guard
BEFORE INSERT OR UPDATE OF employee_user_id, day_off_date ON schedule_days_off
FOR EACH ROW EXECUTE FUNCTION habun_guard_day_off_against_shift();
