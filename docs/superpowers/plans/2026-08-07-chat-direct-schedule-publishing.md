# Dienstpläne aus ChatGPT direkt veröffentlichen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein eindeutiger Dienstplan aus ChatGPT wird ohne Browserlogin direkt für aktive Mitarbeiter in das Habun-Portal geschrieben und sofort veröffentlicht.

**Architecture:** Die vorhandene private Neon-Datenbank wird die gemeinsame Quelle für Dienstplan-Schichten. `schedule-v2` bleibt der Portalvertrag für Admin, Mitarbeiter und PDF, liest und schreibt Schichten künftig aber über einen neuen Neon-Repository-Helper; Einsatzorte bleiben zunächst im bestehenden Netlify-Blob-Store. Bestehende Blob-Schichten werden einmalig idempotent nach Neon übernommen und niemals gelöscht. Die aktive Mitarbeiterliste wird aus `portal-access` über `schedule-directory` nach Neon synchronisiert, damit ChatGPT sie direkt über den verbundenen Neon-Zugriff abgleichen und veröffentlichte Dienste schreiben kann.

**Tech Stack:** PostgreSQL 17 / Neon, `@neondatabase/serverless`, `@netlify/database`, Netlify Functions, Netlify Blobs, Netlify Identity, React 19, Node.js Assertions, Playwright

## Global Constraints

- Eindeutige Dienstpläne werden direkt eingetragen und veröffentlicht.
- Bei widersprüchlichem oder unklarem Datum wird vor dem Schreiben nachgefragt.
- Bei unklarer Mitarbeiterzuordnung wird vor dem Schreiben nachgefragt.
- Nicht aktive bzw. nicht registrierte Mitarbeiter werden übersprungen.
- Mehrere Dienste derselben Person am selben Tag bleiben getrennte Dienste.
- Wenn keine Pause angegeben ist, gelten 0 Minuten Pause.
- Wenn kein anderer Einsatzort angegeben ist, wird der gespeicherte Einsatzort Abbott verwendet.
- Wenn ausdrücklich ein anderer Einsatzort angegeben ist, hat dieser Vorrang.
- Exakte Duplikate dürfen nicht doppelt angelegt werden.
- Personenbezogene Dienstplandaten dürfen nicht in GitHub-Issues, Commits oder öffentlichen Artefakten gespeichert werden.
- Passwörter oder dauerhafte Browser-Sessions werden nicht für ChatGPT gespeichert.
- Mitarbeiter lesen ausschließlich eigene veröffentlichte Dienste.
- Bestehende Dienstplandaten werden nicht gelöscht.
- Keine Produktionsveröffentlichung ohne erneute ausdrückliche Freigabe des Nutzers.

---

### Task 1: Neon-Schema für Mitarbeiter, Schichten und Audit zuerst in einer temporären Datenbankmigration anlegen

**Files:**
- Create: `netlify/database/migrations/20260807154500_create-schedule-schema/migration.sql`
- Modify: `scripts/netlify-database-config-test.mjs`
- Create: `scripts/schedule-database-schema-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tables `portal_schedule_employees`, `portal_schedule_shifts`, `portal_schedule_audit`.
- Produces database function `portal_publish_chat_shift(...)` used by ChatGPT direct writes.
- Consumes the existing database connection from `netlify/functions/_shared/database-connection.mts`.

- [ ] **Step 1: Migration SQL als Repository-Artefakt schreiben**

Erstelle `netlify/database/migrations/20260807154500_create-schedule-schema/migration.sql`:

```sql
CREATE TABLE IF NOT EXISTS portal_schedule_employees (
  user_id text PRIMARY KEY,
  full_name text NOT NULL,
  normalized_name text NOT NULL,
  role text NOT NULL,
  location text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_schedule_employees_active_name_idx
  ON portal_schedule_employees (normalized_name)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS portal_schedule_shifts (
  id text PRIMARY KEY,
  employee_user_id text NOT NULL,
  employee_name text NOT NULL,
  shift_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  location text NOT NULL,
  work_area text NOT NULL,
  pause_minutes integer NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  object_id text,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  version integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'portal',
  source_request_id text,
  dedupe_key text NOT NULL,
  template_id text,
  repeat_group_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  published_at timestamptz,
  published_by text,
  CONSTRAINT portal_schedule_pause_valid CHECK (pause_minutes >= 0),
  CONSTRAINT portal_schedule_time_valid CHECK (end_time > start_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_schedule_shifts_dedupe_idx
  ON portal_schedule_shifts (dedupe_key);

CREATE INDEX IF NOT EXISTS portal_schedule_shifts_employee_date_idx
  ON portal_schedule_shifts (employee_user_id, shift_date, start_time);

CREATE INDEX IF NOT EXISTS portal_schedule_shifts_date_status_idx
  ON portal_schedule_shifts (shift_date, status, start_time);

CREATE TABLE IF NOT EXISTS portal_schedule_audit (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  shift_id text,
  employee_user_id text,
  source text NOT NULL,
  source_request_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_schedule_audit_shift_idx
  ON portal_schedule_audit (shift_id, created_at DESC);

CREATE OR REPLACE FUNCTION portal_publish_chat_shift(
  p_employee_user_id text,
  p_shift_date date,
  p_start_time time,
  p_end_time time,
  p_location text,
  p_work_area text,
  p_pause_minutes integer DEFAULT 0,
  p_note text DEFAULT '',
  p_source_request_id text DEFAULT NULL
)
RETURNS TABLE(result text, shift_id text)
LANGUAGE plpgsql
AS $$
DECLARE
  v_employee_name text;
  v_id text;
  v_key text;
  v_existing_id text;
  v_now timestamptz := now();
BEGIN
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'Dienstende muss nach Dienstbeginn liegen.';
  END IF;
  IF p_pause_minutes < 0 OR p_pause_minutes >= EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60 THEN
    RAISE EXCEPTION 'Pause ist für diese Dienstzeit ungültig.';
  END IF;

  SELECT full_name INTO v_employee_name
  FROM portal_schedule_employees
  WHERE user_id = p_employee_user_id AND active = true;

  IF v_employee_name IS NULL THEN
    RAISE EXCEPTION 'Mitarbeiter ist nicht aktiv.';
  END IF;

  v_key := lower(concat_ws('|',
    p_employee_user_id,
    p_shift_date::text,
    to_char(p_start_time, 'HH24:MI'),
    to_char(p_end_time, 'HH24:MI'),
    trim(p_location),
    trim(p_work_area)
  ));

  SELECT id INTO v_existing_id
  FROM portal_schedule_shifts
  WHERE dedupe_key = v_key;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT 'duplicate'::text, v_existing_id;
    RETURN;
  END IF;

  v_id := gen_random_uuid()::text;

  INSERT INTO portal_schedule_shifts (
    id, employee_user_id, employee_name, shift_date, start_time, end_time,
    location, work_area, pause_minutes, note, status, version, source,
    source_request_id, dedupe_key, created_by, updated_by, published_at, published_by
  ) VALUES (
    v_id, p_employee_user_id, v_employee_name, p_shift_date, p_start_time, p_end_time,
    trim(p_location), trim(p_work_area), p_pause_minutes, coalesce(trim(p_note), ''),
    'published', 1, 'chatgpt', p_source_request_id, v_key,
    'chatgpt', 'chatgpt', v_now, 'chatgpt'
  );

  INSERT INTO portal_schedule_audit (
    action, shift_id, employee_user_id, source, source_request_id, details
  ) VALUES (
    'publish', v_id, p_employee_user_id, 'chatgpt', p_source_request_id,
    jsonb_build_object(
      'date', p_shift_date,
      'start', p_start_time,
      'end', p_end_time,
      'location', trim(p_location),
      'workArea', trim(p_work_area),
      'pauseMinutes', p_pause_minutes
    )
  );

  RETURN QUERY SELECT 'published'::text, v_id;
END;
$$;
```

- [ ] **Step 2: Schema-Source-Test erstellen**

Erstelle `scripts/schedule-database-schema-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = await readFile('netlify/database/migrations/20260807154500_create-schedule-schema/migration.sql', 'utf8')
for (const table of ['portal_schedule_employees', 'portal_schedule_shifts', 'portal_schedule_audit']) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
}
assert.match(migration, /portal_publish_chat_shift/)
assert.match(migration, /WHERE user_id = p_employee_user_id AND active = true/)
assert.match(migration, /RETURN QUERY SELECT 'duplicate'/)
assert.match(migration, /'published'/)
assert.match(migration, /'chatgpt'/)
assert.match(migration, /portal_schedule_shifts_dedupe_idx/)
console.log('Schedule database schema tests passed')
```

- [ ] **Step 3: Datenbank-Konfigurationstest erweitern**

In `scripts/netlify-database-config-test.mjs` ergänzen:

```js
const scheduleMigrationPath = 'netlify/database/migrations/20260807154500_create-schedule-schema/migration.sql'
if (!fs.existsSync(scheduleMigrationPath)) {
  throw new Error(`Dienstplan-Datenbankmigration fehlt: ${scheduleMigrationPath}`)
}
```

- [ ] **Step 4: Test in `verify:database` aufnehmen**

Ändere in `package.json`:

```json
"verify:database": "node scripts/netlify-database-config-test.mjs && node scripts/schedule-database-schema-test.mjs"
```

- [ ] **Step 5: Tests lokal rot/grün prüfen**

Run:

```bash
npm run verify:database
```

Expected: PASS, nachdem Migration und Tests vorhanden sind.

- [ ] **Step 6: Migration in Neon nur über den sicheren Migrationsworkflow vorbereiten**

Verwende den Inhalt der Migration mit `prepare_database_migration` gegen Projekt `bitter-poetry-51396199`, Datenbank `neondb`. Danach auf dem vom Tool erzeugten temporären Branch ausführen:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('portal_schedule_employees', 'portal_schedule_shifts', 'portal_schedule_audit')
ORDER BY table_name;
```

und:

```sql
SELECT proname
FROM pg_proc
WHERE proname = 'portal_publish_chat_shift';
```

Expected: drei Tabellen und die Funktion vorhanden.

- [ ] **Step 7: Vor Anwendung auf Main explizite Nutzerfreigabe einholen**

Der Neon-Migrationsworkflow verlangt vor `complete_database_migration(... applyChanges: true)` eine ausdrückliche Bestätigung. Bis dahin wird die Hauptdatenbank nicht verändert.

- [ ] **Step 8: Commit**

```bash
git add netlify/database/migrations/20260807154500_create-schedule-schema/migration.sql scripts/schedule-database-schema-test.mjs scripts/netlify-database-config-test.mjs package.json
git commit -m "feat: add private schedule database schema"
```

---

### Task 2: Neon-Repository für Dienstplan-Schichten implementieren

**Files:**
- Create: `netlify/functions/_shared/neon-schedule.mts`
- Create: `scripts/neon-schedule-repository-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `databaseConnectionString(): string`.
- Produces: `createScheduleRepository(connectionString)` mit Methoden `listShifts`, `findShift`, `upsertShift`, `deleteShift`, `publishWeek`, `syncEmployees`, `importLegacyShifts`.

- [ ] **Step 1: Repository-Source-Test zuerst erstellen**

Erstelle `scripts/neon-schedule-repository-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/_shared/neon-schedule.mts', 'utf8')
assert.match(source, /import\('@neondatabase\/serverless'\)/)
assert.match(source, /export async function createScheduleRepository/)
for (const method of ['listShifts', 'findShift', 'upsertShift', 'deleteShift', 'publishWeek', 'syncEmployees', 'importLegacyShifts']) {
  assert.match(source, new RegExp(`async function ${method}`))
}
assert.match(source, /portal_schedule_shifts/)
assert.match(source, /portal_schedule_employees/)
assert.match(source, /ON CONFLICT \(id\)/)
console.log('Neon schedule repository source tests passed')
```

Run before implementation:

```bash
node scripts/neon-schedule-repository-test.mjs
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 2: Row mapping and dedupe helper implementieren**

`netlify/functions/_shared/neon-schedule.mts` beginnt mit:

```ts
function dateOnly(value: unknown) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10)
}

function timeOnly(value: unknown) {
  return String(value || '').slice(0, 5)
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

export function scheduleDedupeKey(shift: {
  employeeUserId: string
  date: string
  start: string
  end: string
  location: string
  workArea: string
}) {
  return [shift.employeeUserId, shift.date, shift.start, shift.end, shift.location.trim().toLocaleLowerCase('de'), shift.workArea.trim().toLocaleLowerCase('de')].join('|')
}

function mapShiftRow(row: Record<string, unknown>) {
  return {
    id: text(row.id),
    employeeUserId: text(row.employee_user_id),
    employeeName: text(row.employee_name),
    date: dateOnly(row.shift_date),
    start: timeOnly(row.start_time),
    end: timeOnly(row.end_time),
    location: text(row.location),
    workArea: text(row.work_area),
    pauseMinutes: Number(row.pause_minutes || 0),
    note: text(row.note),
    objectId: text(row.object_id) || null,
    status: row.status === 'published' ? 'published' : 'draft',
    version: Number(row.version || 0),
    templateId: text(row.template_id) || null,
    repeatGroupId: text(row.repeat_group_id) || null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    createdBy: text(row.created_by),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    updatedBy: text(row.updated_by),
    publishedAt: row.published_at ? new Date(String(row.published_at)).toISOString() : null,
    publishedBy: text(row.published_by) || null,
  }
}
```

- [ ] **Step 3: Repository erzeugen**

Implementiere:

```ts
export async function createScheduleRepository(connectionString: string) {
  const databaseUrl = String(connectionString || '').trim()
  if (!databaseUrl) throw new Error('Dienstplan-Datenbank ist nicht konfiguriert.')
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(databaseUrl)
```

- [ ] **Step 4: `listShifts` und `findShift` implementieren**

```ts
async function listShifts(filters: { from?: string; to?: string; employeeUserId?: string; publishedOnly?: boolean } = {}) {
  const clauses: string[] = []
  const params: unknown[] = []
  const add = (sqlText: string, value: unknown) => {
    params.push(value)
    clauses.push(sqlText.replace('?', `$${params.length}`))
  }
  if (filters.from) add('shift_date >= ?', filters.from)
  if (filters.to) add('shift_date <= ?', filters.to)
  if (filters.employeeUserId) add('employee_user_id = ?', filters.employeeUserId)
  if (filters.publishedOnly) clauses.push("status = 'published'")
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = await sql(`SELECT * FROM portal_schedule_shifts ${where} ORDER BY shift_date, start_time, employee_name`, params)
  return rows.map((row) => mapShiftRow(row as Record<string, unknown>))
}

async function findShift(id: string) {
  const rows = await sql('SELECT * FROM portal_schedule_shifts WHERE id = $1 LIMIT 1', [id])
  return rows[0] ? mapShiftRow(rows[0] as Record<string, unknown>) : null
}
```

- [ ] **Step 5: `upsertShift` und `deleteShift` implementieren**

`upsertShift(shift, source = 'portal')` nutzt `scheduleDedupeKey(shift)` und einen parameterisierten `INSERT ... ON CONFLICT (id) DO UPDATE`, wobei alle aktuellen Shift-Felder gespiegelt werden. `deleteShift(id)` führt aus:

```ts
await sql('DELETE FROM portal_schedule_shifts WHERE id = $1', [id])
```

Bei Unique-Verletzung auf `dedupe_key` muss `upsertShift` einen Fehler mit Code `EXACT_DUPLICATE` werfen, damit `schedule-v2` weiterhin HTTP 409 liefern kann.

- [ ] **Step 6: `publishWeek` implementieren**

`publishWeek(monday, actorUserId, nextVersion)` aktualisiert in einer einzelnen SQL-Anweisung alle Schichten von Montag bis Sonntag:

```sql
UPDATE portal_schedule_shifts
SET status = 'published',
    version = $2,
    published_at = now(),
    published_by = $3,
    updated_at = now(),
    updated_by = $3
WHERE shift_date BETWEEN $1::date AND ($1::date + 6)
RETURNING *;
```

Die zurückgegebenen Rows werden mit `mapShiftRow` normalisiert.

- [ ] **Step 7: `syncEmployees` implementieren**

Die Methode erhält:

```ts
type DirectoryEmployee = {
  userId: string
  fullName: string
  role: string
  location: string
}
```

Sie setzt zuerst bereits bekannte Mitarbeiter auf `active = false`, danach upsertet sie alle aktuell aktiven IDs mit:

```sql
INSERT INTO portal_schedule_employees (user_id, full_name, normalized_name, role, location, active, synced_at)
VALUES ($1, $2, $3, $4, $5, true, now())
ON CONFLICT (user_id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  normalized_name = EXCLUDED.normalized_name,
  role = EXCLUDED.role,
  location = EXCLUDED.location,
  active = true,
  synced_at = now();
```

`normalized_name` wird mit `fullName.trim().toLocaleLowerCase('de')` erzeugt.

- [ ] **Step 8: `importLegacyShifts` implementieren**

Für jeden bestehenden Blob-Dienst wird `upsertShift(shift, 'legacy-blob')` aufgerufen. Bei bereits vorhandener ID wird aktualisiert; exakte Dedupe-Konflikte mit einer anderen ID werden protokolliert und übersprungen, nicht gelöscht.

- [ ] **Step 9: Methoden zurückgeben und Test registrieren**

```ts
return { listShifts, findShift, upsertShift, deleteShift, publishWeek, syncEmployees, importLegacyShifts }
```

Füge `node scripts/neon-schedule-repository-test.mjs` zu `verify:database` hinzu.

Run:

```bash
npm run verify:database
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add netlify/functions/_shared/neon-schedule.mts scripts/neon-schedule-repository-test.mjs package.json
git commit -m "feat: add Neon schedule repository"
```

---

### Task 3: Bestehende Blob-Schichten sicher und einmalig nach Neon übernehmen

**Files:**
- Modify: `netlify/functions/schedule-v2.mts`
- Create: `scripts/schedule-legacy-migration-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: alte `portal-schedule-v2` Blob-Schichten.
- Produces: idempotente Migration nach `portal_schedule_shifts`; Blob-Daten bleiben unverändert erhalten.

- [ ] **Step 1: Failing Source-Test schreiben**

Erstelle `scripts/schedule-legacy-migration-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/schedule-v2.mts', 'utf8')
assert.match(source, /databaseConnectionString/)
assert.match(source, /createScheduleRepository/)
assert.match(source, /meta\/neon-schedule-migration-v1/)
assert.match(source, /importLegacyShifts/)
assert.doesNotMatch(source, /delete\([^\n]*shifts\//, 'Legacy-Migration darf alte Blob-Schichten nicht löschen.')
console.log('Schedule legacy migration source tests passed')
```

Run:

```bash
node scripts/schedule-legacy-migration-test.mjs
```

Expected: FAIL.

- [ ] **Step 2: Imports ergänzen**

In `netlify/functions/schedule-v2.mts`:

```ts
import { createScheduleRepository } from './_shared/neon-schedule.mts'
import { databaseConnectionString } from './_shared/database-connection.mts'
```

- [ ] **Step 3: Migration-Helper ergänzen**

```ts
async function ensureLegacyScheduleImported(repository: Awaited<ReturnType<typeof createScheduleRepository>>) {
  const markerKey = 'meta/neon-schedule-migration-v1'
  const marker = await store().get(markerKey, { type: 'json' }) as { importedAt?: string } | null
  if (marker?.importedAt) return

  const legacy = await readMany<Shift>('shifts/')
  await repository.importLegacyShifts(legacy)
  await store().setJSON(markerKey, {
    importedAt: new Date().toISOString(),
    importedCount: legacy.length,
  })
}
```

Die Funktion liest und importiert, löscht aber keine alten `shifts/`-Blobs.

- [ ] **Step 4: Repository pro Request initialisieren**

Nach Actor/Role-Prüfung in `scheduleV2`:

```ts
const repository = await createScheduleRepository(databaseConnectionString())
await ensureLegacyScheduleImported(repository)
```

Bei fehlender Datenbankverbindung muss die Funktion mit HTTP 503 und einer klaren Meldung antworten; sie darf in diesem Zustand keine Blob-Daten löschen oder verändern.

- [ ] **Step 5: Source-Test registrieren und ausführen**

Füge `node scripts/schedule-legacy-migration-test.mjs` zu `verify:unified` hinzu.

Run:

```bash
npm run verify:unified
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/schedule-v2.mts scripts/schedule-legacy-migration-test.mjs package.json
git commit -m "feat: preserve and import legacy schedule blobs"
```

---

### Task 4: `schedule-v2` vollständig auf Neon-Schichten umstellen

**Files:**
- Modify: `netlify/functions/schedule-v2.mts`
- Modify: `scripts/employee-access-policy-test.mjs`
- Modify: `scripts/scheduler-support-test.mjs`
- Create: `scripts/schedule-neon-source-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Repository aus Task 2.
- Produces: gleicher HTTP-Vertrag wie bisher für `resource=entries`, `save`, `delete`, `publish`, `copy-previous-week`, `repeat`; sichtbare Schichten stammen ausschließlich aus Neon.

- [ ] **Step 1: Source-Test erstellen**

`scripts/schedule-neon-source-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('netlify/functions/schedule-v2.mts', 'utf8')
assert.match(source, /repository\.listShifts/)
assert.match(source, /repository\.findShift/)
assert.match(source, /repository\.upsertShift/)
assert.match(source, /repository\.deleteShift/)
assert.match(source, /repository\.publishWeek/)
assert.doesNotMatch(source, /readMany<Shift>\('shifts\/'\).*sort/, 'Live-Schichten dürfen nach Migration nicht mehr aus Blobs gelesen werden.')
console.log('Schedule Neon source tests passed')
```

- [ ] **Step 2: `getEntries` auf Repository umstellen**

Signatur:

```ts
async function getEntries(
  current: NonNullable<Awaited<ReturnType<typeof actor>>>,
  url: URL,
  repository: Awaited<ReturnType<typeof createScheduleRepository>>,
) {
```

Implementierung:

```ts
const from = url.searchParams.get('from') || undefined
const to = url.searchParams.get('to') || undefined
if (!MANAGEMENT.has(current.role)) {
  return repository.listShifts({ from, to, employeeUserId: current.userId, publishedOnly: true })
}
return repository.listShifts({ from, to })
```

Nach Scheduler-Patch muss `SCHEDULING` statt `MANAGEMENT` für die Verwaltungsansicht gelten; Employee bleibt serverseitig auf eigene `published` beschränkt.

- [ ] **Step 3: `saveShift` umstellen**

`findShift` und `allShifts` werden durch Repository-Aufrufe ersetzt. `validateShift`, `makeShift`, `overlap` und `exactDuplicate` bleiben als bestehende Geschäftslogik erhalten. Vor dem Schreiben:

```ts
const rows = await repository.listShifts()
```

Danach:

```ts
try {
  await repository.upsertShift(candidate, 'portal')
} catch (error) {
  if ((error as { code?: string }).code === 'EXACT_DUPLICATE') {
    return json({ message: 'Dieser Dienst ist bereits exakt vorhanden.', code: 'EXACT_DUPLICATE' }, 409)
  }
  throw error
}
```

- [ ] **Step 4: Löschen umstellen**

```ts
const existing = await repository.findShift(String(body.id || ''))
if (!existing) return json({ message: 'Dienst nicht gefunden.' }, 404)
await repository.deleteShift(existing.id)
return json({ deleted: true, id: existing.id })
```

- [ ] **Step 5: Wochenfreigabe umstellen**

Die bestehende Versionsnummer aus Blob `meta/version/<monday>` darf vorerst erhalten bleiben. Nach Berechnung von `version`:

```ts
const published = await repository.publishWeek(monday, current.userId, version)
if (!published.length) return json({ message: 'Für diese Woche ist kein Entwurf vorhanden.' }, 404)
```

Danach bleiben `meta/version/...` und `versions/...` als nicht-personenbezogene Freigabemetadaten im Blob-Store bestehen.

- [ ] **Step 6: Kopieren und Wiederholen umstellen**

`copyPreviousWeek` lädt die Quellwoche mit:

```ts
const source = await repository.listShifts({ from: previousMonday, to: addDays(previousMonday, 6), publishedOnly: true })
```

und schreibt Kopien mit `repository.upsertShift(copy, 'portal')`.

`repeatShift` lädt den Ausgangsdienst mit `repository.findShift()` und schreibt jede neue Schicht ebenfalls über `repository.upsertShift`.

- [ ] **Step 7: Suggestions auf Neon umstellen**

`resource=suggestions` verwendet:

```ts
const rows = await repository.listShifts()
```

statt Blob-`allShifts()`.

- [ ] **Step 8: Tests registrieren und ausführen**

Füge `node scripts/schedule-neon-source-test.mjs` zu `verify:unified` hinzu.

Run:

```bash
npm run verify
npm run build
```

Expected: PASS; bestehende Schedule-, Employee- und Scheduler-Policytests bleiben grün.

- [ ] **Step 9: Commit**

```bash
git add netlify/functions/schedule-v2.mts scripts/schedule-neon-source-test.mjs scripts/employee-access-policy-test.mjs scripts/scheduler-support-test.mjs package.json
git commit -m "feat: use Neon as authoritative schedule source"
```

---

### Task 5: Aktive Portal-Mitarbeiter sicher nach Neon synchronisieren

**Files:**
- Modify: `netlify/functions/schedule-directory.mts`
- Modify: `frontend/src/App.jsx`
- Modify: `scripts/apply-scheduler-support.mjs`
- Modify: `scripts/scheduler-support-test.mjs`
- Create: `scripts/schedule-directory-sync-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: aktive `portal-access` Records.
- Produces: dieselben `employees` für das Portal und synchronisierte Rows in `portal_schedule_employees`.

- [ ] **Step 1: Failing Source-Test erstellen**

`scripts/schedule-directory-sync-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [directory, app] = await Promise.all([
  readFile('netlify/functions/schedule-directory.mts', 'utf8'),
  readFile('frontend/src/App.jsx', 'utf8'),
])
assert.match(directory, /createScheduleRepository/)
assert.match(directory, /syncEmployees\(employees\)/)
assert.match(app, /apiJson\('\/api\/schedule-directory'\)/)
console.log('Schedule directory sync tests passed')
```

- [ ] **Step 2: Directory mit Neon verbinden**

Imports:

```ts
import { createScheduleRepository } from './_shared/neon-schedule.mts'
import { databaseConnectionString } from './_shared/database-connection.mts'
```

Nach Erzeugung von `employees`:

```ts
const repository = await createScheduleRepository(databaseConnectionString())
await repository.syncEmployees(employees)
return json({ employees })
```

Bei Datenbankfehlern darf die Funktion keine unvollständige Mitarbeiterliste als erfolgreich synchronisiert melden. Sie antwortet mit 503 und behält `portal-access` unverändert.

- [ ] **Step 3: Dienstplan für alle Planungsrollen auf Directory umstellen**

In `frontend/src/App.jsx` ändere:

```js
if (management) calls.push(apiJson('/api/schedule-v2?resource=objects'), apiJson('/api/registrations'))
```

zu:

```js
if (management) calls.push(apiJson('/api/schedule-v2?resource=objects'), apiJson('/api/schedule-directory'))
```

Dadurch verwenden Admin, Manager und später Scheduler dieselbe datensparsame aktive Mitarbeiterquelle ohne E-Mail-Adressen.

- [ ] **Step 4: Scheduler-Patch vereinfachen**

Entferne aus `scripts/apply-scheduler-support.mjs` die spezielle Ersetzung:

```js
apiJson(session.role === 'scheduler' ? '/api/schedule-directory' : '/api/registrations')
```

und passe sie so an, dass der bereits vorhandene generische `/api/schedule-directory`-Aufruf unverändert bleibt. Der Patch darf nur die Rolle `scheduler` zur Planungsberechtigung ergänzen.

- [ ] **Step 5: Tests ausführen**

Run:

```bash
npm run verify:unified
npm run test:e2e -- --grep "scheduler edits only the schedule|management edits schedule"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/schedule-directory.mts frontend/src/App.jsx scripts/apply-scheduler-support.mjs scripts/scheduler-support-test.mjs scripts/schedule-directory-sync-test.mjs package.json
git commit -m "feat: sync active schedule employees to Neon"
```

---

### Task 6: ChatGPT-Direktveröffentlichung als geprüften Betriebsablauf definieren und testen

**Files:**
- Create: `docs/operations/chat-schedule-publishing.md`
- Create: `scripts/chat-schedule-contract-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `portal_schedule_employees` und Funktion `portal_publish_chat_shift`.
- Produces: ein deterministischer ChatGPT-Ablauf ohne Browserlogin.

- [ ] **Step 1: Betriebsvertrag dokumentieren**

Erstelle `docs/operations/chat-schedule-publishing.md` mit exakt diesem Ablauf:

```text
1. Datum aus dem Nutzertext bestimmen.
2. Bei widersprüchlichem/unklarem Datum NICHT schreiben; Nutzer fragen.
3. Aktive Mitarbeiter lesen:
   SELECT user_id, full_name, normalized_name, location
   FROM portal_schedule_employees
   WHERE active = true
   ORDER BY full_name;
4. Namen nur eindeutig zuordnen. Unbekannte/inaktive Namen überspringen; mehrdeutige Namen nachfragen.
5. Standardwerte:
   pause_minutes = 0, wenn nicht angegeben.
   location = Abbott, wenn kein anderer Einsatzort angegeben ist.
6. Für jeden eindeutigen Dienst einzeln aufrufen:
   SELECT * FROM portal_publish_chat_shift(...);
7. result='published' als erfolgreich melden.
8. result='duplicate' als bereits vorhanden melden, nicht erneut anlegen.
9. Bei Teilfehlern exakt nennen, welche Dienste erfolgreich waren und welche nicht.
```

Die Dokumentation darf keine realen Mitarbeiterdaten enthalten.

- [ ] **Step 2: Contract-Test erstellen**

`scripts/chat-schedule-contract-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [ops, migration] = await Promise.all([
  readFile('docs/operations/chat-schedule-publishing.md', 'utf8'),
  readFile('netlify/database/migrations/20260807154500_create-schedule-schema/migration.sql', 'utf8'),
])
for (const rule of ['pause_minutes = 0', 'location = Abbott', "result='published'", "result='duplicate'", 'NICHT schreiben']) {
  assert.ok(ops.includes(rule), `Chat-Dienstplan-Regel fehlt: ${rule}`)
}
assert.match(migration, /portal_publish_chat_shift/)
assert.match(migration, /active = true/)
console.log('Chat schedule publishing contract tests passed')
```

- [ ] **Step 3: Contract-Test registrieren**

Füge `node scripts/chat-schedule-contract-test.mjs` zu `verify:database` hinzu.

Run:

```bash
npm run verify:database
```

Expected: PASS.

- [ ] **Step 4: Temporären Neon-End-to-End-Test mit synthetischen Daten durchführen**

Nur auf dem temporären Neon-Migrationsbranch:

```sql
INSERT INTO portal_schedule_employees (user_id, full_name, normalized_name, role, location, active)
VALUES ('test-employee-1', 'Test Mitarbeiter', 'test mitarbeiter', 'employee', 'Abbott', true)
ON CONFLICT (user_id) DO UPDATE SET active = true;
```

Dann:

```sql
SELECT * FROM portal_publish_chat_shift(
  'test-employee-1',
  '2026-08-07',
  '14:00',
  '18:00',
  'Abbott',
  'ZuKo',
  0,
  '',
  'test-request-1'
);
```

Expected: `published`.

Denselben Aufruf erneut ausführen.

Expected: `duplicate` mit derselben oder bereits vorhandenen Shift-ID.

Danach Testdaten auf dem temporären Branch entfernen:

```sql
DELETE FROM portal_schedule_audit WHERE source_request_id = 'test-request-1';
DELETE FROM portal_schedule_shifts WHERE source_request_id = 'test-request-1';
DELETE FROM portal_schedule_employees WHERE user_id = 'test-employee-1';
```

- [ ] **Step 5: Commit**

```bash
git add docs/operations/chat-schedule-publishing.md scripts/chat-schedule-contract-test.mjs package.json
git commit -m "docs: define direct chat schedule publishing contract"
```

---

### Task 7: PDF, Mitarbeiteransicht und Adminansicht gegen dieselbe Neon-Quelle regressionsprüfen

**Files:**
- Verify/modify if necessary: `netlify/functions/schedule-pdf-fixed.mts`
- Modify: `scripts/schedule-pdf-test.mjs`
- Modify: `tests/e2e/unified-portal.spec.mjs`
- Create: `scripts/schedule-single-source-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `schedule-v2` als einzige lesende Schedule-API.
- Produces: Nachweis, dass Admin, Mitarbeiter und PDF dieselben veröffentlichten Daten sehen.

- [ ] **Step 1: Single-Source-Test erstellen**

`scripts/schedule-single-source-test.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [schedule, pdf] = await Promise.all([
  readFile('netlify/functions/schedule-v2.mts', 'utf8'),
  readFile('netlify/functions/schedule-pdf-fixed.mts', 'utf8'),
])
assert.match(schedule, /createScheduleRepository/)
assert.match(pdf, /new URL\('\/api\/schedule-v2'/)
assert.match(pdf, /entry\.status === 'published'/)
assert.doesNotMatch(pdf, /getStore\(\{ name: 'portal-schedule-v2'/)
console.log('Schedule single-source tests passed')
```

- [ ] **Step 2: Browser-Mock als gemeinsame Datenquelle strukturieren**

Im E2E-Mock soll eine einzige mutable `scheduleEntries`-Liste sowohl für Admin- als auch Mitarbeiteraufrufe von `/api/schedule-v2` verwendet werden. Für Employee wird servernah gefiltert:

```js
const visible = role === 'employee'
  ? scheduleEntries.filter((entry) => entry.employeeUserId === users.employee.id && entry.status === 'published')
  : scheduleEntries
```

- [ ] **Step 3: E2E-Fall Chat-published simulieren**

Füge einen published Eintrag mit `source: 'chatgpt'` zur Mock-Liste hinzu und prüfe:

```text
Admin sieht den Dienst.
Zugeordneter Mitarbeiter sieht denselben Dienst.
Fremder Mitarbeiter sieht ihn nicht.
Dienstplan-PDF-Request erhält denselben published Datensatz.
```

- [ ] **Step 4: Tests ausführen**

Füge `node scripts/schedule-single-source-test.mjs` zu `verify:unified` hinzu.

Run:

```bash
npm run verify
npm run build
npm run test:e2e
```

Expected: alle Source-, Rollen-, PDF-, Desktop-, iPhone- und Android-Tests PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/schedule-pdf-fixed.mts scripts/schedule-pdf-test.mjs tests/e2e/unified-portal.spec.mjs scripts/schedule-single-source-test.mjs package.json
git commit -m "test: verify one published schedule source across portal"
```

---

### Task 8: Sicherheits- und Produktionsfreigabeprüfung

**Files:**
- Verify only: all changed files
- PR only: no production merge yet

**Interfaces:**
- Consumes: Tasks 1–7 plus the separate employee-visibility plan.
- Produces: vollständig getesteter Preview-Stand und eine klare letzte Produktionsfreigabeentscheidung.

- [ ] **Step 1: Neon Security/Performance Advisors nach Schemaänderung prüfen**

Nach Anwendung der Migration auf der dafür freigegebenen Hauptdatenbank:

```text
Security advisors
Performance advisors
```

Kritische Hinweise müssen vor Produktionsfreigabe behoben oder ausdrücklich bewertet werden.

- [ ] **Step 2: Keine personenbezogenen Testdaten im Repository prüfen**

Run:

```bash
git grep -n -E "Aras|Adel|Shukri|Sufian|Kwame|Abdukader|Amin|Hevdar|Murtaza" -- . ':!docs/superpowers/specs/2026-08-07-chat-schedule-publishing-design.md'
```

Expected: keine neu hinzugefügten realen Mitarbeiternamen in Code, Tests, Docs oder Migrationen.

- [ ] **Step 3: Vollständige Regression erneut ausführen**

```bash
npm run verify
npm run build
npm run test:e2e
```

Expected: alles PASS.

- [ ] **Step 4: Netlify Deploy-Preview prüfen**

Mindestens prüfen:

```text
Admin kann Dienst erstellen/bearbeiten/löschen.
Admin kann Woche veröffentlichen.
Mitarbeiter sieht nur eigene published Dienste.
PDF zeigt published Dienste.
Einsatzortverwaltung funktioniert weiter.
Dienstplan-Support behält seine eingeschränkten Rechte.
Keine horizontale Überläufe auf iPhone/Android.
```

- [ ] **Step 5: Private Datenbank mit vorhandenen aktiven Mitarbeitern synchronisieren**

Auf der Preview/geschützten Adminansicht einmal `Dienstplan` öffnen. Dadurch ruft das Portal `/api/schedule-directory` auf und synchronisiert die aktiven `portal-access`-Mitarbeiter nach Neon.

Danach privat über Neon prüfen:

```sql
SELECT user_id, full_name, active
FROM portal_schedule_employees
ORDER BY full_name;
```

Es dürfen nur die tatsächlich aktiven Portalmitarbeiter als `active = true` für die spätere Chat-Zuordnung verwendet werden.

- [ ] **Step 6: Bestehende Blob-Dienste nach Migration verifizieren**

Nach einem geschützten Schedule-API-Aufruf prüfen:

```sql
SELECT count(*) FROM portal_schedule_shifts;
```

und im Portal visuell dieselbe Woche kontrollieren. Die alten Blob-Daten bleiben zusätzlich unverändert erhalten.

- [ ] **Step 7: PR öffnen, aber nicht mergen**

PR-Beschreibung muss enthalten:

```text
Dienstplan-Schichten werden auf die private Neon-Datenbank als gemeinsame Quelle umgestellt. Bestehende Blob-Schichten werden idempotent übernommen und nicht gelöscht. Aktive Mitarbeiter werden aus portal-access synchronisiert. ChatGPT kann nach eindeutiger Zuordnung published Dienste direkt über die private Neon-Verbindung schreiben; Standardpause 0, Standard-Einsatzort Abbott, Duplikatschutz aktiv. Mitarbeiter sehen weiterhin ausschließlich eigene veröffentlichte Dienste. Kein Merge/keine Produktionsfreigabe ohne ausdrückliche letzte Zustimmung.
```

- [ ] **Step 8: Letzte Freigabe vom Nutzer einholen**

Erst nach erfolgreicher CI, Deploy-Preview, Neon-Verifikation und ausdrücklicher Nutzerfreigabe darf der PR gemergt und die Netlify-Produktion aktualisiert werden.

## Self-Review

- Spec coverage: direkter Chat-Schreibweg, aktive Mitarbeiter, Abbott, 0 Minuten Pause, Unklarheitsregel, Duplikate, Audit, Mitarbeiter-Sichtbarkeit, PDF-Single-Source, bestehende Daten und Datenschutz sind jeweils explizit einem Task zugeordnet.
- Placeholder scan: keine TBD/TODO/unspezifischen Implementierungsschritte.
- Type consistency: `employee_user_id`/`employeeUserId`, `shift_date`/`date`, `start_time`/`start`, `end_time`/`end`, `pause_minutes`/`pauseMinutes` sind durch Repository-Mapping eindeutig definiert.
- Migration safety: bestehende Blob-Schichten werden nur gelesen und idempotent importiert; keine Löschung.
- Privacy: reale Mitarbeiterdaten werden ausschließlich zur Laufzeit in Neon synchronisiert und nicht im Repository transportiert.
- Execution gate: Neon-Hauptmigration und Produktionsmerge benötigen jeweils eine separate ausdrückliche Freigabe.
