CREATE TABLE portal_notifications (
  recipient_user_id text NOT NULL,
  event_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  PRIMARY KEY(recipient_user_id,event_key)
);
CREATE INDEX portal_notifications_recipient_idx ON portal_notifications(recipient_user_id,created_at DESC);
CREATE TABLE portal_mail_messages (
  id uuid PRIMARY KEY,
  sender_user_id text NOT NULL,
  sender_name text NOT NULL,
  recipient_user_id text,
  to_administration boolean NOT NULL,
  subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 160),
  body text NOT NULL CHECK(length(body)<=6000),
  attachment_name text,
  attachment_type text,
  attachment_base64 text,
  attachment_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((to_administration AND recipient_user_id IS NULL) OR (NOT to_administration AND recipient_user_id IS NOT NULL)),
  CHECK ((attachment_base64 IS NULL AND attachment_sha256 IS NULL AND attachment_name IS NULL AND attachment_type IS NULL)
    OR (attachment_base64 IS NOT NULL AND attachment_sha256 IS NOT NULL AND attachment_name IS NOT NULL AND attachment_type IN ('application/pdf','image/jpeg','image/png')))
);
CREATE INDEX portal_mail_sender_idx ON portal_mail_messages(sender_user_id,created_at DESC);
CREATE INDEX portal_mail_recipient_idx ON portal_mail_messages(recipient_user_id,created_at DESC);
CREATE INDEX portal_mail_admin_idx ON portal_mail_messages(created_at DESC) WHERE to_administration;
