-- Separate restricted personnel-document archive; never publicly served.
CREATE TABLE personnel_documents (
 id uuid PRIMARY KEY,
 employee_user_id text NOT NULL,
 employee_name text NOT NULL,
 creator_user_id text NOT NULL,
 creator_name text NOT NULL,
 creator_function text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('warning','termination')),
 title text NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 pdf_base64 text NOT NULL,
 pdf_sha256 text NOT NULL CHECK (pdf_sha256 ~ '^[a-f0-9]{64}$'),
 published_at timestamptz,
 published_by text,
 first_opened_at timestamptz,
 paper_delivered_on date,
 paper_delivery_note text,
 paper_copy_base64 text,
 paper_copy_sha256 text,
 paper_recorded_by text,
 receipt_at timestamptz,
 receipt_signature text,
 receipt_document_sha256 text
);
CREATE INDEX personnel_documents_recipient_idx ON personnel_documents(employee_user_id, created_at DESC);
CREATE INDEX personnel_documents_archive_idx ON personnel_documents(created_at DESC);
