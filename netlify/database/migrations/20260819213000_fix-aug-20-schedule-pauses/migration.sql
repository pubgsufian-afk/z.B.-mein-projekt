DO $$
DECLARE
  target record;
  resolved_user_id text;
  resolved_name text;
  target_shift_id text;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      (1,  'Marwan',        '06:00'::time, '11:00'::time, 'ZuKo',                 0,  'guest:a81ccc3ede0320f8879d99eb2d075e6a404587faa0bc91cbb7812d196388f1f8'),
      (2,  'Sufian',        '11:00'::time, '18:00'::time, 'ZuKo',                 0,  'guest:2ce6f4c299de9b85b077ccccc86f46c09ef79da4c6147431915cc490a673fbb3'),
      (3,  'Sufian',        '18:00'::time, '23:00'::time, 'Brandwach',            0,  'guest:2ce6f4c299de9b85b077ccccc86f46c09ef79da4c6147431915cc490a673fbb3'),
      (4,  'Amin',          '07:30'::time, '16:30'::time, 'Lager+AufzugBediener', 30, 'guest:29a669940f66f7d5d5539801dc422018a92d4799060e2c576d9a30887eba605a'),
      (5,  'Kanee',         '07:00'::time, '17:00'::time, 'Brandwach',            60, 'guest:b8d98cb500220b54ccf39489804f5ff91f71a50340ef23a93d9dde9f6fafb529'),
      (6,  'Amjad',         '07:00'::time, '17:00'::time, 'Brandwach',            60, 'guest:ffc8a893622c8529e4b933e5491369c3a29c3f006c8ca337e5fbd23d6f9f0cc0'),
      (7,  'Omar',          '07:00'::time, '17:00'::time, 'GMP Rundgang',         60, 'guest:21297e6e966afbd06e8f08c4525ae2edcbd3696cc6bc436037e278d4b1e67b4d'),
      (8,  'Ahmed',         '07:00'::time, '17:00'::time, 'GMP Rundgang',         60, 'guest:9af2921d3fd57fe886c9022d1fcc055d53a79e4032fa6137e397583884e1a5de'),
      (9,  'Shukri',        '17:00'::time, '23:00'::time, 'Brandwach',            0,  'guest:2588066f9ac3029c67fa93c7fb814562cc348142d1e2c72cd799e65ceea8de61'),
      (10, 'Adel',          '07:00'::time, '17:00'::time, 'ZuKo GMP',             60, 'guest:783eef82414f06b50a4287010eb1584fb9559b43579fc5cc14aff959df8a48a3'),
      (11, 'Ahmad Zerzour', '08:30'::time, '17:00'::time, 'Bauhelfer',            30, 'guest:26f9e8f05edf7b965aa299799e2f817257924a7faae2792b17f0160347320df9'),
      (12, 'Murtaza',       '08:30'::time, '17:00'::time, 'Bauhelfer',            30, 'guest:c911cd3d9dd8d7874cabe0378d47e0b0de672487295224e1dd177d96745715e6'),
      (13, 'Hevdar',        '07:30'::time, '16:30'::time, 'Baureinigung',         30, 'guest:ea27c88db5a3b93b56a6c11c8ac31c6bc66357df58c16b4b42793a49d60a78ac'),
      (14, 'Kwame',         '08:00'::time, '16:00'::time, 'Staplerfahrer',        0,  'guest:0a6134bd3bff9e045b239287abcddfd900ee9f19efecd58ba21a21a32f566937')
    ) AS roster(seq, input_name, start_time, end_time, work_area, pause_minutes, fallback_user_id)
  LOOP
    resolved_user_id := NULL;
    resolved_name := NULL;
    target_shift_id := NULL;

    SELECT shift.employee_user_id, shift.employee_name
      INTO resolved_user_id, resolved_name
      FROM schedule_shifts AS shift
     WHERE shift.shift_date BETWEEN DATE '2026-08-01' AND DATE '2026-08-19'
       AND (
         lower(btrim(shift.employee_name)) = lower(target.input_name)
         OR (
           position(' ' in target.input_name) = 0
           AND split_part(lower(btrim(shift.employee_name)), ' ', 1) = lower(target.input_name)
         )
       )
     ORDER BY
       CASE WHEN lower(btrim(shift.employee_name)) = lower(target.input_name) THEN 0 ELSE 1 END,
       shift.shift_date DESC,
       shift.updated_at DESC,
       shift.id
     LIMIT 1;

    IF resolved_user_id IS NULL THEN
      SELECT employee.user_id, employee.full_name
        INTO resolved_user_id, resolved_name
        FROM schedule_employees AS employee
       WHERE employee.status = 'active'
         AND (
           lower(btrim(employee.full_name)) = lower(target.input_name)
           OR (
             position(' ' in target.input_name) = 0
             AND split_part(lower(btrim(employee.full_name)), ' ', 1) = lower(target.input_name)
           )
         )
       ORDER BY
         CASE WHEN lower(btrim(employee.full_name)) = lower(target.input_name) THEN 0 ELSE 1 END,
         employee.synced_at DESC,
         employee.user_id
       LIMIT 1;
    END IF;

    resolved_user_id := coalesce(nullif(resolved_user_id, ''), target.fallback_user_id);
    resolved_name := coalesce(nullif(resolved_name, ''), target.input_name);

    SELECT shift.id
      INTO target_shift_id
      FROM schedule_shifts AS shift
     WHERE shift.employee_user_id = resolved_user_id
       AND shift.shift_date = DATE '2026-08-20'
       AND shift.start_time = target.start_time
       AND shift.end_time = target.end_time
       AND lower(btrim(shift.location)) = lower('Abbott Laboratories GmbH')
       AND lower(btrim(shift.work_area)) = lower(target.work_area)
     ORDER BY shift.updated_at DESC, shift.id
     LIMIT 1;

    IF target_shift_id IS NULL THEN
      SELECT shift.id
        INTO target_shift_id
        FROM schedule_shifts AS shift
       WHERE shift.shift_date = DATE '2026-08-20'
         AND shift.start_time = target.start_time
         AND shift.end_time = target.end_time
         AND (
           shift.employee_user_id = resolved_user_id
           OR lower(btrim(shift.employee_name)) = lower(target.input_name)
           OR (
             position(' ' in target.input_name) = 0
             AND split_part(lower(btrim(shift.employee_name)), ' ', 1) = lower(target.input_name)
           )
         )
       ORDER BY
         CASE WHEN shift.employee_user_id = resolved_user_id THEN 0 ELSE 1 END,
         shift.updated_at DESC,
         shift.id
       LIMIT 1;
    END IF;

    IF target_shift_id IS NULL THEN
      target_shift_id := 'chatgpt:2026-08-20:' || lpad(target.seq::text, 2, '0');

      INSERT INTO schedule_shifts (
        id,
        employee_user_id,
        employee_name,
        shift_date,
        start_time,
        end_time,
        pause_minutes,
        object_id,
        location,
        work_area,
        note,
        status,
        version,
        template_id,
        repeat_group_id,
        created_at,
        created_by,
        updated_at,
        updated_by,
        published_at,
        published_by,
        source,
        source_ref
      ) VALUES (
        target_shift_id,
        resolved_user_id,
        resolved_name,
        DATE '2026-08-20',
        target.start_time,
        target.end_time,
        target.pause_minutes,
        NULL,
        'Abbott Laboratories GmbH',
        target.work_area,
        '',
        'published',
        1,
        NULL,
        NULL,
        now(),
        'dienstplan-assistent',
        now(),
        'dienstplan-assistent',
        now(),
        'dienstplan-assistent',
        'chatgpt',
        'dienstplan-2026-08-20'
      )
      ON CONFLICT (id) DO UPDATE SET
        employee_user_id = excluded.employee_user_id,
        employee_name = excluded.employee_name,
        shift_date = excluded.shift_date,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        pause_minutes = excluded.pause_minutes,
        location = excluded.location,
        work_area = excluded.work_area,
        status = 'published',
        version = schedule_shifts.version + 1,
        updated_at = now(),
        updated_by = 'dienstplan-assistent',
        published_at = now(),
        published_by = 'dienstplan-assistent',
        source = 'chatgpt',
        source_ref = 'dienstplan-2026-08-20';
    ELSE
      UPDATE schedule_shifts
         SET employee_user_id = resolved_user_id,
             employee_name = resolved_name,
             shift_date = DATE '2026-08-20',
             start_time = target.start_time,
             end_time = target.end_time,
             pause_minutes = target.pause_minutes,
             location = 'Abbott Laboratories GmbH',
             work_area = target.work_area,
             status = 'published',
             version = version + 1,
             updated_at = now(),
             updated_by = 'dienstplan-assistent',
             published_at = coalesce(published_at, now()),
             published_by = 'dienstplan-assistent',
             source = 'chatgpt',
             source_ref = 'dienstplan-2026-08-20'
       WHERE id = target_shift_id;
    END IF;

    UPDATE timesheet_entries AS entry
       SET employee_user_id = resolved_user_id,
           employee_name = resolved_name,
           work_date = DATE '2026-08-20',
           start_time = target.start_time,
           end_time = target.end_time,
           pause_minutes = target.pause_minutes,
           net_minutes = GREATEST(
             0,
             floor(extract(epoch FROM (target.end_time - target.start_time)) / 60)::integer - target.pause_minutes
           ),
           location = 'Abbott Laboratories GmbH',
           work_area = target.work_area,
           source = 'schedule',
           updated_at = now(),
           updated_by = 'dienstplan-assistent'
     WHERE entry.schedule_shift_id = target_shift_id
       AND entry.manual_override = false
       AND entry.suppressed = false;

    IF NOT EXISTS (
      SELECT 1
        FROM timesheet_entries
       WHERE schedule_shift_id = target_shift_id
    ) THEN
      INSERT INTO timesheet_entries (
        id,
        schedule_shift_id,
        employee_user_id,
        employee_name,
        work_date,
        start_time,
        end_time,
        pause_minutes,
        net_minutes,
        location,
        work_area,
        source,
        manual_override,
        created_at,
        created_by,
        updated_at,
        updated_by,
        suppressed
      ) VALUES (
        'timesheet:' || target_shift_id,
        target_shift_id,
        resolved_user_id,
        resolved_name,
        DATE '2026-08-20',
        target.start_time,
        target.end_time,
        target.pause_minutes,
        GREATEST(
          0,
          floor(extract(epoch FROM (target.end_time - target.start_time)) / 60)::integer - target.pause_minutes
        ),
        'Abbott Laboratories GmbH',
        target.work_area,
        'schedule',
        false,
        now(),
        'dienstplan-assistent',
        now(),
        'dienstplan-assistent',
        false
      );
    END IF;
  END LOOP;
END $$;
