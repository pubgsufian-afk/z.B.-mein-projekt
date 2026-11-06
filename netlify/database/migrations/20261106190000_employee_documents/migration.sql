-- Employee document inbox. Existing migrations are append-only.
-- Uploaded PDF bytes are private Netlify Blobs, not rows or public files.
CREATE TABLE employee_documents (
  id uuid PRIMARY KEY,
  employee_user_id text NOT NULL,
  sender_user_id text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('contract', 'payslip', 'other')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  file_name text NOT NULL,
  blob_key text NOT NULL UNIQUE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 5 AND 10485760),
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  first_opened_at timestamp with time zone
);
CREATE INDEX employee_documents_by_recipient
  ON employee_documents (employee_user_id, published_at DESC);

CREATE TABLE employee_document_access_audit (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES employee_documents(id),
  actor_user_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('upload', 'download')),
  occurred_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX employee_document_access_audit_by_document
  ON employee_document_access_audit (document_id, occurred_at DESC);
