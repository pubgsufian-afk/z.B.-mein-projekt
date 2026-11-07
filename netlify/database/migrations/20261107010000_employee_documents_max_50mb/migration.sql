-- Increase the private employee inbox PDF limit to 50 MiB.
-- The original migration is immutable; change the existing check constraint here.
ALTER TABLE employee_documents
  DROP CONSTRAINT employee_documents_byte_size_check;

ALTER TABLE employee_documents
  ADD CONSTRAINT employee_documents_byte_size_check
  CHECK (byte_size BETWEEN 5 AND 52428800);
