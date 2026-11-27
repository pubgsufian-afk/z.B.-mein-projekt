DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM start_due WHERE id='start' AND kind='start' AND minutes=30) THEN RAISE EXCEPTION 'Missing start reminder'; END IF;
 IF NOT EXISTS(SELECT 1 FROM start_due WHERE id='night' AND kind='end' AND minutes=30) THEN RAISE EXCEPTION 'Missing midnight-crossing reminder'; END IF;
 IF EXISTS(SELECT 1 FROM start_due WHERE employee_user_id IN ('draft-user','inactive-user')) THEN RAISE EXCEPTION 'Unauthorized reminder'; END IF;
 IF NOT EXISTS(SELECT 1 FROM five_due WHERE id='end' AND kind='end' AND minutes=5) THEN RAISE EXCEPTION 'Missing end reminder'; END IF;
 IF EXISTS(SELECT 1 FROM five_due WHERE id='out') THEN RAISE EXCEPTION 'Already checked out'; END IF;
 IF NOT EXISTS(SELECT 1 FROM zero_due WHERE id='end' AND kind='end' AND minutes=0) THEN RAISE EXCEPTION 'Missing final reminder'; END IF;
 IF EXISTS(SELECT 1 FROM zero_due WHERE id='out') THEN RAISE EXCEPTION 'Already checked out'; END IF;
 IF NOT EXISTS(SELECT 1 FROM post_due WHERE id='end' AND kind='end' AND minutes=-25) THEN RAISE EXCEPTION 'Missing final post-end warning'; END IF;
 IF EXISTS(SELECT 1 FROM post_due WHERE id='out' OR kind='start') THEN RAISE EXCEPTION 'Invalid post-end warning'; END IF;
 IF EXISTS(SELECT 1 FROM checkout_before WHERE user_id='end-user') THEN RAISE EXCEPTION 'Early automatic checkout'; END IF;
 IF NOT EXISTS(SELECT 1 FROM checkout_due WHERE user_id='end-user' AND schedule_id='end') THEN RAISE EXCEPTION 'Missing due automatic checkout'; END IF;
 IF EXISTS(SELECT 1 FROM checkout_due WHERE user_id='out-user' OR user_id='start-user') THEN RAISE EXCEPTION 'Invalid automatic checkout candidate'; END IF;
 IF NOT EXISTS(SELECT 1 FROM checkout_due WHERE user_id='night-user') THEN RAISE EXCEPTION 'Missing overdue overnight checkout'; END IF;
END $$;
INSERT INTO portal_notifications(recipient_user_id,event_key,title,body,url)
SELECT unnest(ARRAY['admin','owner']::text[]),'test:event','HABUN','Neue Nachricht','/?view=mailbox' ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
INSERT INTO portal_notifications(recipient_user_id,event_key,title,body,url)
VALUES ('admin','test:event','HABUN','Neue Nachricht','/?view=mailbox') ON CONFLICT(recipient_user_id,event_key) DO NOTHING;
UPDATE portal_notifications SET read_at=now() WHERE recipient_user_id='admin' AND event_key='test:event';
DO $$ BEGIN
 IF (SELECT count(*) FROM portal_notifications)<>2 THEN RAISE EXCEPTION 'Duplicate notices'; END IF;
 IF EXISTS(SELECT 1 FROM portal_notifications WHERE recipient_user_id='owner' AND read_at IS NOT NULL) THEN RAISE EXCEPTION 'Another recipient read state modified'; END IF;
END $$;
INSERT INTO portal_mail_messages(id,sender_user_id,sender_name,recipient_user_id,to_administration,subject,body)
VALUES ('00000000-0000-4000-8000-000000000001','staff','Test',NULL,true,'Test','To admins'),
('00000000-0000-4000-8000-000000000002','admin','Test','staff',false,'Test','To staff');
DO $$ BEGIN
 IF (SELECT count(*) FROM portal_mail_messages WHERE sender_user_id='other' OR recipient_user_id='other' OR (false AND to_administration))<>0 THEN RAISE EXCEPTION 'Cross-account read'; END IF;
 IF (SELECT count(*) FROM portal_mail_messages WHERE sender_user_id='staff' OR recipient_user_id='staff' OR (false AND to_administration))<>2 THEN RAISE EXCEPTION 'Own message visibility'; END IF;
END $$;
ROLLBACK;
