-- Preserve lifecycle evidence; remove PDF bytes only for never-delivered drafts.
ALTER TABLE personnel_documents
 ADD COLUMN lifecycle_action text CHECK (lifecycle_action IN ('delete','withdraw','cancel')),
 ADD COLUMN lifecycle_at timestamptz,
 ADD COLUMN lifecycle_by text,
 ADD COLUMN lifecycle_by_name text,
 ADD COLUMN lifecycle_reason text,
 ADD CONSTRAINT personnel_lifecycle_complete CHECK (
   (lifecycle_action IS NULL AND lifecycle_at IS NULL AND lifecycle_by IS NULL AND lifecycle_by_name IS NULL AND lifecycle_reason IS NULL)
   OR (lifecycle_action IS NOT NULL AND lifecycle_at IS NOT NULL AND lifecycle_by IS NOT NULL AND lifecycle_by_name IS NOT NULL AND lifecycle_reason IS NOT NULL)
 ),
 ADD CONSTRAINT personnel_lifecycle_delivery CHECK (
   lifecycle_action IS NULL
   OR (lifecycle_action='delete' AND published_at IS NULL AND paper_delivered_on IS NULL AND receipt_at IS NULL AND pdf_base64='')
   OR (lifecycle_action='withdraw' AND published_at IS NOT NULL AND paper_delivered_on IS NULL AND receipt_at IS NULL)
   OR (lifecycle_action='cancel' AND (paper_delivered_on IS NOT NULL OR receipt_at IS NOT NULL))
 );
