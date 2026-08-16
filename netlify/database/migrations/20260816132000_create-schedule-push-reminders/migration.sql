CREATE TABLE schedule_push_reminders (
  reminder_key text PRIMARY KEY,
  shift_id text NOT NULL,
  scheduled_start timestamp with time zone NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'claimed',
  claimed_at timestamp with time zone NOT NULL DEFAULT now(),
  processed_at timestamp with time zone,
  CONSTRAINT schedule_push_reminders_status_check CHECK (status IN ('claimed', 'processed'))
);

CREATE INDEX schedule_push_reminders_start_idx
  ON schedule_push_reminders (scheduled_start, status);
