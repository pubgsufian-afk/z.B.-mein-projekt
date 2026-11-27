BEGIN;
INSERT INTO schedule_employees(user_id,full_name,role,status)
VALUES ('start-user','Start','employee','active'),('end-user','End','employee','active'),('out-user','Out','employee','active'),('draft-user','Draft','employee','active'),('inactive-user','Inactive','employee','inactive'),('night-user','Night','employee','active');
INSERT INTO schedule_shifts(id,employee_user_id,employee_name,shift_date,start_time,end_time,location,work_area,status,created_at,created_by,updated_at,updated_by)
VALUES
('start','start-user','Start','2026-11-28','06:00','14:30','Testobjekt','Test','published',now(),'ci',now(),'ci'),
('start-draft','draft-user','Draft','2026-11-28','06:00','14:30','Testobjekt','Test','draft',now(),'ci',now(),'ci'),
('start-inactive','inactive-user','Inactive','2026-11-28','06:00','14:30','Testobjekt','Test','published',now(),'ci',now(),'ci'),
('end','end-user','End','2026-11-28','06:00','14:30','Testobjekt','Test','published',now(),'ci',now(),'ci'),
('out','out-user','Out','2026-11-28','06:00','14:30','Testobjekt','Test','published',now(),'ci',now(),'ci'),
('night','night-user','Night','2026-11-27','22:00','06:00','Testobjekt','Test','published',now(),'ci',now(),'ci');
INSERT INTO attendance_events(id,user_id,client_event_id,request_hash,action,server_occurred_at,client_occurred_at,event_date,schedule_id,location_status,offline_captured,expires_at)
SELECT id,uid,id,'test',act,at::timestamptz,at::timestamptz,(at::timestamptz AT TIME ZONE 'Europe/Berlin')::date,sid,'inside',false,now()+interval '1 day'
FROM (VALUES
 ('e-in','end-user','clock-in','2026-11-28 06:00:00+01','end'),
 ('o-in','out-user','clock-in','2026-11-28 06:00:00+01','out'),
 ('o-out','out-user','clock-out','2026-11-28 12:00:00+01','out'),
 ('n-in','night-user','clock-in','2026-11-27 22:00:00+01','night')
) v(id,uid,act,at,sid);
