-- Synthetic fixtures only, in the disposable CI database. No production connection.
BEGIN;
INSERT INTO personnel_documents(id,employee_user_id,employee_name,creator_user_id,creator_name,creator_function,kind,title,reason,pdf_base64,pdf_sha256)
SELECT ('f1000000-0000-4000-8000-00000000000'||n)::uuid,'ci-recipient','CI Fixture','ci-admin','CI Admin','Bevollmächtigter','warning','Synthetic','Synthetic','fixture',repeat('a',64)
FROM generate_series(1,4) AS n;
UPDATE personnel_documents SET published_at=now() WHERE id IN ('f1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000003');
UPDATE personnel_documents SET receipt_at=now(),receipt_signature='synthetic-receipt' WHERE id='f1000000-0000-4000-8000-000000000003';
UPDATE personnel_documents SET kind='termination',paper_delivered_on=current_date,paper_copy_base64='paper-fixture',paper_copy_sha256=repeat('b',64) WHERE id='f1000000-0000-4000-8000-000000000004';
DO $$
BEGIN
  BEGIN
    UPDATE personnel_documents SET lifecycle_action='delete',lifecycle_at=now(),lifecycle_by='ci-admin',lifecycle_by_name='CI Admin',lifecycle_reason='CI',pdf_base64='' WHERE id='f1000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'Published document must not be deleted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE personnel_documents SET lifecycle_action='withdraw',lifecycle_at=now(),lifecycle_by='ci-admin',lifecycle_by_name='CI Admin',lifecycle_reason='CI' WHERE id='f1000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'Acknowledged document must not be withdrawn';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE personnel_documents SET lifecycle_action='delete',lifecycle_at=now(),lifecycle_by='ci-admin',lifecycle_by_name='CI Admin',lifecycle_reason='CI',pdf_base64='' WHERE id='f1000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'Paper delivery must not be deleted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE personnel_documents SET lifecycle_action='delete' WHERE id='f1000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Audit fields must be required';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE personnel_documents SET lifecycle_action='delete',lifecycle_at=now(),lifecycle_by='ci-admin',lifecycle_by_name='CI Admin',lifecycle_reason='CI',pdf_base64='',pdf_sha256=repeat('0',64) WHERE id='f1000000-0000-4000-8000-000000000001';
UPDATE personnel_documents SET lifecycle_action='withdraw',lifecycle_at=now(),lifecycle_by='ci-admin',lifecycle_by_name='CI Admin',lifecycle_reason='CI' WHERE id='f1000000-0000-4000-8000-000000000002';
UPDATE personnel_documents SET lifecycle_action='cancel',lifecycle_at=now(),lifecycle_by='ci-admin',lifecycle_by_name='CI Admin',lifecycle_reason='CI' WHERE id IN ('f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000004');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM personnel_documents WHERE id='f1000000-0000-4000-8000-000000000001' AND pdf_base64='' AND lifecycle_by='ci-admin') THEN RAISE EXCEPTION 'Draft deletion evidence missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM personnel_documents WHERE id='f1000000-0000-4000-8000-000000000002' AND pdf_base64='fixture' AND lifecycle_action='withdraw') THEN RAISE EXCEPTION 'Withdrawal evidence missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM personnel_documents WHERE id='f1000000-0000-4000-8000-000000000003' AND receipt_signature='synthetic-receipt' AND lifecycle_action='cancel') THEN RAISE EXCEPTION 'Receipt missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM personnel_documents WHERE id='f1000000-0000-4000-8000-000000000004' AND paper_copy_base64='paper-fixture' AND lifecycle_action='cancel') THEN RAISE EXCEPTION 'Paper evidence missing'; END IF;
END $$;
ROLLBACK;
