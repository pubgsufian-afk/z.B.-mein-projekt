CREATE TABLE attendance_objects (
  id text PRIMARY KEY,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  radius_meters double precision NOT NULL DEFAULT 500,
  updated_at timestamp with time zone,
  updated_by text,
  CONSTRAINT attendance_objects_latitude_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT attendance_objects_longitude_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT attendance_objects_accuracy_meters_check CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  CONSTRAINT attendance_objects_radius_meters_check CHECK (radius_meters >= 0),
  CONSTRAINT attendance_objects_coordinates_all_or_none CHECK (
    (latitude IS NULL AND longitude IS NULL AND accuracy_meters IS NULL)
    OR (latitude IS NOT NULL AND longitude IS NOT NULL AND accuracy_meters IS NOT NULL)
  )
);

CREATE TABLE attendance_events (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  client_event_id text NOT NULL,
  request_hash text NOT NULL,
  action text NOT NULL,
  server_occurred_at timestamp with time zone NOT NULL,
  client_occurred_at timestamp with time zone NOT NULL,
  event_date date NOT NULL,
  schedule_id text,
  object_id text REFERENCES attendance_objects(id) ON DELETE RESTRICT,
  location_status text NOT NULL,
  offline_captured boolean NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT attendance_events_user_id_client_event_id_key UNIQUE (user_id, client_event_id),
  CONSTRAINT attendance_events_action_check CHECK (action IN ('clock-in', 'break-start', 'break-end', 'clock-out')),
  CONSTRAINT attendance_events_location_status_check CHECK (location_status IN ('inside', 'outside', 'unavailable'))
);

CREATE TABLE attendance_locations (
  event_id text PRIMARY KEY REFERENCES attendance_events(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  object_id text,
  captured_at timestamp with time zone NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy_meters double precision NOT NULL,
  distance_meters double precision,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT attendance_locations_latitude_check CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT attendance_locations_longitude_check CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT attendance_locations_accuracy_meters_check CHECK (accuracy_meters >= 0),
  CONSTRAINT attendance_locations_distance_meters_check CHECK (distance_meters IS NULL OR distance_meters >= 0)
);

CREATE TABLE attendance_idempotency (
  user_id text NOT NULL,
  client_event_id text NOT NULL,
  request_hash text NOT NULL,
  response_data jsonb,
  created_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  PRIMARY KEY (user_id, client_event_id),
  CONSTRAINT attendance_idempotency_response_data_check CHECK (
    response_data IS NULL OR jsonb_typeof(response_data) = 'object'
  )
);

CREATE TABLE attendance_corrections (
  id text PRIMARY KEY,
  event_id text REFERENCES attendance_events(id) ON DELETE SET NULL,
  requested_by text NOT NULL,
  actor_id text NOT NULL,
  actor_email text NOT NULL,
  actor_role text NOT NULL,
  reason text NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT attendance_corrections_actor_role_check CHECK (actor_role IN ('owner', 'admin', 'manager', 'employee')),
  CONSTRAINT attendance_corrections_reason_check CHECK (length(btrim(reason)) > 0),
  CONSTRAINT attendance_corrections_before_data_check CHECK (jsonb_typeof(before_data) = 'object'),
  CONSTRAINT attendance_corrections_after_data_check CHECK (jsonb_typeof(after_data) = 'object'),
  CONSTRAINT attendance_corrections_before_data_keys_check CHECK (
    (before_data - ARRAY['clientOccurredAt','serverOccurredAt','clockInAt','clockOutAt','pauseMinutes','note','scheduleId','objectId','locationStatus']) = '{}'::jsonb
  ),
  CONSTRAINT attendance_corrections_after_data_keys_check CHECK (
    (after_data - ARRAY['clientOccurredAt','serverOccurredAt','clockInAt','clockOutAt','pauseMinutes','note','scheduleId','objectId','locationStatus']) = '{}'::jsonb
  )
);

CREATE TABLE attendance_correction_decisions (
  id text PRIMARY KEY,
  correction_id text NOT NULL REFERENCES attendance_corrections(id) ON DELETE CASCADE,
  decision text NOT NULL,
  actor_id text NOT NULL,
  actor_email text NOT NULL,
  actor_role text NOT NULL,
  reason text NOT NULL,
  request_data jsonb NOT NULL,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT attendance_correction_decisions_decision_check CHECK (decision IN ('approved', 'rejected', 'clarification')),
  CONSTRAINT attendance_correction_decisions_actor_role_check CHECK (actor_role IN ('owner', 'admin', 'manager')),
  CONSTRAINT attendance_correction_decisions_reason_check CHECK (length(btrim(reason)) > 0),
  CONSTRAINT attendance_correction_decisions_request_data_check CHECK (jsonb_typeof(request_data) = 'object'),
  CONSTRAINT attendance_correction_decisions_before_data_check CHECK (jsonb_typeof(before_data) = 'object'),
  CONSTRAINT attendance_correction_decisions_after_data_check CHECK (jsonb_typeof(after_data) = 'object'),
  CONSTRAINT attendance_correction_decisions_request_data_keys_check CHECK (
    (request_data - ARRAY['id','eventId','requestedBy','reason','occurredAt']) = '{}'::jsonb
  ),
  CONSTRAINT attendance_correction_decisions_before_data_keys_check CHECK (
    (before_data - ARRAY['clientOccurredAt','serverOccurredAt','clockInAt','clockOutAt','pauseMinutes','note','scheduleId','objectId','locationStatus']) = '{}'::jsonb
  ),
  CONSTRAINT attendance_correction_decisions_after_data_keys_check CHECK (
    (after_data - ARRAY['clientOccurredAt','serverOccurredAt','clockInAt','clockOutAt','pauseMinutes','note','scheduleId','objectId','locationStatus']) = '{}'::jsonb
  )
);

CREATE TABLE attendance_adjustments (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES attendance_events(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  event_date date NOT NULL,
  pause_minutes integer NOT NULL,
  reason text NOT NULL,
  actor_id text NOT NULL,
  actor_email text NOT NULL,
  actor_role text NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT attendance_adjustments_pause_minutes_check CHECK (pause_minutes >= 0),
  CONSTRAINT attendance_adjustments_reason_check CHECK (length(btrim(reason)) > 0),
  CONSTRAINT attendance_adjustments_actor_role_check CHECK (actor_role IN ('owner', 'admin', 'manager'))
);

CREATE TABLE attendance_audit_log (
  id text PRIMARY KEY,
  occurred_at timestamp with time zone NOT NULL,
  actor_id text NOT NULL,
  actor_email text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  reason text,
  before_data jsonb,
  after_data jsonb,
  expires_at timestamp with time zone NOT NULL,
  CONSTRAINT attendance_audit_log_actor_role_check CHECK (actor_role IN ('owner', 'admin', 'manager', 'employee')),
  CONSTRAINT attendance_audit_log_before_data_check CHECK (before_data IS NULL OR jsonb_typeof(before_data) = 'object'),
  CONSTRAINT attendance_audit_log_after_data_check CHECK (after_data IS NULL OR jsonb_typeof(after_data) = 'object'),
  CONSTRAINT attendance_audit_log_before_data_keys_check CHECK (
    before_data IS NULL OR (before_data - ARRAY['action','locationStatus','offlineCaptured','configured','radiusMeters','eventId','pauseMinutes','clientOccurredAt','serverOccurredAt','clockInAt','clockOutAt','note','scheduleId','objectId','held']) = '{}'::jsonb
  ),
  CONSTRAINT attendance_audit_log_after_data_keys_check CHECK (
    after_data IS NULL OR (after_data - ARRAY['action','locationStatus','offlineCaptured','configured','radiusMeters','eventId','pauseMinutes','clientOccurredAt','serverOccurredAt','clockInAt','clockOutAt','note','scheduleId','objectId','held']) = '{}'::jsonb
  )
);

CREATE TABLE attendance_legal_holds (
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  held boolean NOT NULL,
  reason text NOT NULL,
  actor_id text NOT NULL,
  actor_email text NOT NULL,
  actor_role text NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  PRIMARY KEY (entity_type, entity_id),
  CONSTRAINT attendance_legal_holds_reason_check CHECK (length(btrim(reason)) > 0),
  CONSTRAINT attendance_legal_holds_actor_role_check CHECK (actor_role IN ('owner', 'admin', 'manager'))
);

CREATE INDEX attendance_events_expiry_idx ON attendance_events (expires_at);
CREATE INDEX attendance_events_object_date_idx ON attendance_events (object_id, event_date);
CREATE INDEX attendance_events_status_date_idx ON attendance_events (location_status, event_date);
CREATE INDEX attendance_events_user_date_idx ON attendance_events (user_id, event_date, server_occurred_at);
CREATE INDEX attendance_locations_expiry_idx ON attendance_locations (expires_at);
CREATE INDEX attendance_idempotency_expiry_idx ON attendance_idempotency (expires_at);
CREATE INDEX attendance_corrections_expiry_idx ON attendance_corrections (expires_at);
CREATE INDEX attendance_corrections_open_idx ON attendance_corrections (occurred_at, id);
CREATE INDEX attendance_correction_decisions_correction_time_idx ON attendance_correction_decisions (correction_id, occurred_at DESC, id DESC);
CREATE INDEX attendance_adjustments_expiry_idx ON attendance_adjustments (expires_at);
CREATE INDEX attendance_audit_expiry_idx ON attendance_audit_log (expires_at);
