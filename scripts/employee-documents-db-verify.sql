-- Run only against the disposable PostgreSQL service created by GitHub Actions.
-- The transaction rolls back all test rows. Never point this at a live personnel database.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.employee_documents') IS NULL THEN
    RAISE EXCEPTION 'employee_documents table missing';
  END IF;
  IF to_regclass('public.employee_document_access_audit') IS NULL THEN
    RAISE EXCEPTION 'employee_document_access_audit table missing';
  END IF;
  IF to_regclass('public.employee_documents_by_recipient') IS NULL THEN
    RAISE EXCEPTION 'employee_documents_by_recipient index missing';
  END IF;
  IF to_regclass('public.employee_document_access_audit_by_document') IS NULL THEN
    RAISE EXCEPTION 'employee_document_access_audit_by_document index missing';
  END IF;
END $$;

INSERT INTO employee_documents
  (id, employee_user_id, sender_user_id, document_type, title, file_name, blob_key, sha256, byte_size)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'ci-employee-a', 'ci-admin', 'payslip', 'CI Testabrechnung A', 'test-a.pdf', 'ci/a', repeat('a', 64), 1200),
  ('00000000-0000-4000-8000-000000000002', 'ci-employee-b', 'ci-admin', 'contract', 'CI Vertrag B', 'test-b.pdf', 'ci/b', repeat('b', 64), 2400);
INSERT INTO employee_document_access_audit (id, document_id, actor_user_id, action)
VALUES ('00000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000001', 'ci-employee-a', 'download');

DO $$
DECLARE
  count_a integer;
  count_b integer;
  audits integer;
BEGIN
  SELECT count(*) INTO count_a FROM employee_documents WHERE employee_user_id = 'ci-employee-a' AND revoked_at IS NULL;
  SELECT count(*) INTO count_b FROM employee_documents WHERE employee_user_id = 'ci-employee-b' AND revoked_at IS NULL;
  SELECT count(*) INTO audits FROM employee_document_access_audit WHERE actor_user_id = 'ci-employee-a' AND action = 'download';
  IF count_a <> 1 OR count_b <> 1 OR audits <> 1 THEN
    RAISE EXCEPTION 'document or audit persistence failed: %, %, %', count_a, count_b, audits;
  END IF;
END $$;

UPDATE employee_documents
SET revoked_at = now(), revoked_by = 'ci-admin'
WHERE id = '00000000-0000-4000-8000-000000000001';
DO $$
BEGIN
  IF (SELECT revoked_at IS NULL FROM employee_documents WHERE id = '00000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'withdrawal not persisted';
  END IF;
  IF (SELECT count(*) FROM employee_documents WHERE employee_user_id = 'ci-employee-a' AND revoked_at IS NULL) <> 0 THEN
    RAISE EXCEPTION 'withdrawn document still visible in active query';
  END IF;
END $$;
ROLLBACK;
SELECT 'PASS: document inbox PostgreSQL schema, recipient index, separate recipients, audit and withdrawal' AS result;
