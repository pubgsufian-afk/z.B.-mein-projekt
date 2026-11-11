import type { Config, Context } from "@netlify/functions";
import { getStore } from '@netlify/blobs';
import { verifyRequestOrigin } from '@netlify/identity';
import { proxyToProductionBackend } from "./_shared/proxy.mts";
import { employeeManagementPolicy, type EmployeeManagementAction } from './_shared/employee-management-policy.mts';
import { requirePortalRole } from "./_shared/portal-role.mts";
import { tryRecordPortalAdminChange } from './_shared/portal-private-audit-service.mts';
import { deactivateScheduleEmployee } from './_shared/schedule-employee-management.mts';
import { upsertScheduleEmployee, type ScheduleEmployee } from "./_shared/schedule-neon-repository.mts";
import { transferScheduleIdentity } from './_shared/schedule-identity-transfer.mts';
import { findRegistrationEmailConflict, normalizeRegistrationEmail, readPortalRegistrationIdentities } from './_shared/registration-email-guard.mts';

type RateEntry = { count: number; resetAt: number };
type AccessRole = 'owner' | 'admin' | 'manager' | 'employee' | 'pending';
type AccessRecord = {
  userId?: string;
  role?: AccessRole;
  status?: string;
  fullName?: string;
  employeeId?: string;
  company?: string;
  location?: string;
  grantedAt?: string;
  grantedBy?: string;
};

const attempts = new Map<string, RateEntry>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const ASSIGNABLE_ROLES = new Set(['employee', 'manager', 'admin']);

function allowRegistration(context: Context) {
  const key = context.ip || "unknown";
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  current.count += 1;
  attempts.set(key, current);
  return current.count <= MAX_ATTEMPTS;
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' },
  });
}

function normalizedText(value: unknown) {
  return String(value || '').trim().toLocaleLowerCase('de');
}

function normalizedEmail(employee: Record<string, unknown>) {
  return normalizedText(employee.email || employee.mail || employee.emailAddress || employee.email_address);
}

function employeeTimestamp(employee: Record<string, unknown>, record?: AccessRecord) {
  for (const value of [record?.grantedAt, employee.updatedAt, employee.updated_at, employee.createdAt, employee.created_at]) {
    const timestamp = Date.parse(String(value || ''));
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function preferredEmployee(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  accessByUser: Map<string, AccessRecord>,
) {
  const leftId = String(left.userId || left.id || '');
  const rightId = String(right.userId || right.id || '');
  const leftRecord = accessByUser.get(leftId);
  const rightRecord = accessByUser.get(rightId);
  const leftActiveAccess = leftRecord?.status === 'active' ? 1 : 0;
  const rightActiveAccess = rightRecord?.status === 'active' ? 1 : 0;
  if (leftActiveAccess !== rightActiveAccess) return rightActiveAccess > leftActiveAccess ? right : left;
  const leftTime = employeeTimestamp(left, leftRecord);
  const rightTime = employeeTimestamp(right, rightRecord);
  if (leftTime !== rightTime) return rightTime > leftTime ? right : left;
  return right;
}

function dedupeActiveEmployees(
  values: Record<string, unknown>[],
  accessByUser: Map<string, AccessRecord>,
) {
  const byUserId = new Map<string, Record<string, unknown>>();
  for (const employee of values) {
    const userId = String(employee.userId || employee.id || '').trim();
    if (!userId) continue;
    const previous = byUserId.get(userId);
    byUserId.set(userId, previous ? preferredEmployee(previous, employee, accessByUser) : employee);
  }

  const uniqueUsers = [...byUserId.values()];
  const emailWinners = new Map<string, Record<string, unknown>>();
  for (const employee of uniqueUsers) {
    const email = normalizedEmail(employee);
    if (!email) continue;
    const previous = emailWinners.get(email);
    emailWinners.set(email, previous ? preferredEmployee(previous, employee, accessByUser) : employee);
  }

  const afterEmail = uniqueUsers.filter((employee) => {
    const email = normalizedEmail(employee);
    return !email || emailWinners.get(email) === employee;
  });

  // If an old upstream row has no usable email, only collapse same-name rows when
  // exactly one of them has an active portal-access record. This avoids hiding two
  // genuinely different employees who happen to share a name.
  const byName = new Map<string, Record<string, unknown>[]>();
  for (const employee of afterEmail) {
    const name = normalizedText(employee.fullName || employee.name);
    if (!name) continue;
    const group = byName.get(name) || [];
    group.push(employee);
    byName.set(name, group);
  }
  const staleIds = new Set<string>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const activeAccess = group.filter((employee) => {
      const userId = String(employee.userId || employee.id || '');
      return accessByUser.get(userId)?.status === 'active';
    });
    if (activeAccess.length !== 1) continue;
    const keepId = String(activeAccess[0].userId || activeAccess[0].id || '');
    for (const employee of group) {
      const userId = String(employee.userId || employee.id || '');
      if (userId && userId !== keepId && accessByUser.get(userId)?.status !== 'active') staleIds.add(userId);
    }
  }

  const employees = afterEmail.filter((employee) => !staleIds.has(String(employee.userId || employee.id || '')));
  const activeIds = new Set(employees.map((employee) => String(employee.userId || employee.id || '')));
  const duplicates = uniqueUsers.filter((employee) => !activeIds.has(String(employee.userId || employee.id || '')));
  return { employees, duplicates };
}

async function enrichEmployeeRoles(
  upstream: Response,
  current: NonNullable<Awaited<ReturnType<typeof requirePortalRole>>['current']>,
) {
  if (!upstream.ok) return upstream;
  const data = await upstream.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (!data || !Array.isArray(data.employees)) return upstream;

  const store = getStore({ name: 'portal-access', consistency: 'strong' });
  const { blobs } = await store.list({ prefix: 'access/' });
  const records = await Promise.all(blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<AccessRecord | null>));
  const accessByUser = new Map(
    records
      .filter((record): record is AccessRecord => Boolean(record?.userId))
      .map((record) => [String(record.userId), record]),
  );

  const newlyArchived: Record<string, unknown>[] = [];
  const activeEmployees = data.employees.flatMap((value) => {
    const employee = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const userId = String(employee.userId || employee.id || '');
    const record = accessByUser.get(userId);
    const role = current.role === 'owner' && current.userId === userId
      ? 'owner'
      : String(record?.role || employee.role || 'employee');
    const enriched = {
      ...employee,
      ...(record?.fullName ? { fullName: record.fullName } : {}),
      ...(record?.company !== undefined ? { company: record.company } : {}),
      ...(record?.location !== undefined ? { location: record.location } : {}),
      role,
      status: record?.status || employee.status || 'active',
    };
    if (record?.status === 'inactive') {
      newlyArchived.push(enriched);
      return [];
    }
    return [enriched];
  });

  const { employees, duplicates } = dedupeActiveEmployees(activeEmployees, accessByUser);
  const archived = [
    ...(Array.isArray(data.archived) ? data.archived : []),
    ...newlyArchived,
    ...duplicates.map((employee) => ({ ...employee, status: 'inactive', duplicate: true })),
  ];
  return json({ ...data, employees, archived });
}

async function manageActiveEmployee(
  request: Request,
  access: Awaited<ReturnType<typeof requirePortalRole>>,
  body: Record<string, unknown>,
) {
  if (!access.current) return json({ message: 'Nicht angemeldet.' }, 401);
  try { verifyRequestOrigin(request); } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403); }

  const action = String(body.action || '') as EmployeeManagementAction;
  const id = String(body.id || '').trim();
  const requestedRole = String(body.role || '').trim();
  if (!id || !['update-role', 'deactivate-account', 'update-profile'].includes(action)) {
    return json({ message: 'Mitarbeiter und Verwaltungsaktion sind erforderlich.' }, 400);
  }
  if (action === 'update-role' && !ASSIGNABLE_ROLES.has(requestedRole)) {
    return json({ message: 'Ungültige Zielrolle.' }, 400);
  }

  const store = getStore({ name: 'portal-access', consistency: 'strong' });
  const key = `access/${id}`;
  const target = await store.get(key, { type: 'json' }) as AccessRecord | null;
  if (!target || target.status !== 'active') {
    return json({ message: 'Aktiver Mitarbeiter wurde nicht gefunden.' }, 404);
  }

  const effectiveTargetRole = access.current.role === 'owner' && access.current.userId === id
    ? 'owner'
    : String(target.role || 'employee');
  const policy = employeeManagementPolicy({
    actorRole: access.current.role,
    actorUserId: access.current.userId,
    targetRole: effectiveTargetRole,
    targetUserId: id,
    action,
    requestedRole: action === 'update-role' ? requestedRole : undefined,
  });
  if (!policy.allowed) return json({ message: policy.message }, policy.status);

  const now = new Date().toISOString();
  if (action === 'deactivate-account') {
    const employee: AccessRecord = {
      ...target,
      userId: String(target.userId || id),
      status: 'inactive',
      grantedAt: now,
      grantedBy: access.current.userId,
    };
    await store.setJSON(key, employee);
    await deactivateScheduleEmployee(String(employee.userId || id));
    await tryRecordPortalAdminChange({ actor: access.current, category: 'Mitarbeiter', action: 'Konto deaktiviert', entityId: id, targetName: String(target.fullName || ''), before: { status: target.status, role: target.role }, after: { status: employee.status, role: employee.role } });
    return json({ ok: true, employee, deactivated: true });
  }

  if (action === 'update-profile') {
    const fullName = String(body.fullName || '').trim();
    const company = String(body.company || '').trim();
    const location = String(body.location || '').trim();
    if (!fullName) return json({ message: 'Der Name darf nicht leer sein.' }, 400);

    const employee: AccessRecord = {
      ...target,
      userId: String(target.userId || id),
      fullName,
      company,
      location,
      grantedAt: now,
      grantedBy: access.current.userId,
    };
    await store.setJSON(key, employee);
    await upsertScheduleEmployee({
      userId: String(employee.userId || id),
      fullName,
      role: effectiveTargetRole as ScheduleEmployee['role'],
      status: 'active',
      location,
    });
    await tryRecordPortalAdminChange({ actor: access.current, category: 'Mitarbeiter', action: 'Mitarbeiterprofil geändert', entityId: id, targetName: String(target.fullName || ''), before: { fullName: target.fullName, company: target.company, location: target.location }, after: { fullName, company, location } });
    return json({ ok: true, employee });
  }

  const employee: AccessRecord = {
    ...target,
    userId: String(target.userId || id),
    role: requestedRole as AccessRole,
    status: 'active',
    grantedAt: now,
    grantedBy: access.current.userId,
  };
  await store.setJSON(key, employee);

  if (employee.userId && employee.fullName) {
    await upsertScheduleEmployee({
      userId: employee.userId,
      fullName: employee.fullName,
      role: requestedRole as ScheduleEmployee['role'],
      status: 'active',
      location: String(employee.location || ''),
    });
  }

  await tryRecordPortalAdminChange({ actor: access.current, category: 'Mitarbeiter', action: 'Berechtigung geändert', entityId: id, targetName: String(target.fullName || ''), before: { role: target.role }, after: { role: requestedRole } });
  return json({ ok: true, employee, role: requestedRole });
}


/**
 * One-time transfer for the duplicate shown in the employee directory:
 * placeholder "12" -> confirmed Kwame Akakpo registration.
 * Only the portal owner may preview/confirm; neither account is deleted.
 */
async function manageKwameScheduleTransfer(request: Request, access: Awaited<ReturnType<typeof requirePortalRole>>, body: Record<string, unknown>) {
  if (!access.current || access.current.role !== 'owner') {
    return json({ message: 'Nur der Hauptadmin darf Dienstpläne zwischen Konten übertragen.' }, 403);
  }
  try { verifyRequestOrigin(request); } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403); }
  const sourceUserId = String(body.sourceUserId || '').trim();
  const targetUserId = String(body.targetUserId || '').trim();
  const preview = body.action === 'preview-kwame-schedule-transfer';
  if (!sourceUserId || !targetUserId || sourceUserId === targetUserId) {
    return json({ message: 'Zwei unterschiedliche Mitarbeiterkonten müssen angegeben werden.' }, 400);
  }

  // Confirm both account IDs against the real employee directory, not a
  // client-controlled name. The target must have an approved login.
  const directoryRequest = new Request(request.url, { method: 'GET', headers: request.headers });
  const directoryResponse = await proxyToProductionBackend(directoryRequest, '/api/registrations');
  if (!directoryResponse.ok) return json({ message: 'Mitarbeiterkonten können derzeit nicht sicher geprüft werden.' }, 503);
  const directoryData = await directoryResponse.json().catch(() => null) as { employees?: Record<string, unknown>[] } | null;
  const people = Array.isArray(directoryData?.employees) ? directoryData.employees : [];
  const findById = (id: string) => people.find((employee) => String(employee.userId || employee.id || '').trim() === id);
  const source = findById(sourceUserId);
  const target = findById(targetUserId);
  if (!source || !target || source.status === 'inactive' || target.status === 'inactive' ||
      normalizedText(source.fullName || source.name) !== '12' ||
      normalizedText(target.fullName || target.name) !== 'kwame akakpo') {
    return json({ message: 'Die ausgewählten Konten passen nicht zu „12“ und „Kwame Akakpo“. Es wurden keine Schichten verändert.' }, 409);
  }
  const store = getStore({ name: 'portal-access', consistency: 'strong' });
  const [targetAccess, sourceAccess] = await Promise.all([
    store.get(`access/${targetUserId}`, { type: 'json' }) as Promise<AccessRecord | null>,
    store.get(`access/${sourceUserId}`, { type: 'json' }) as Promise<AccessRecord | null>,
  ]);
  if (targetAccess?.status !== 'active' ||
      normalizedText(targetAccess.fullName) !== 'kwame akakpo' ||
      sourceAccess?.role === 'owner' || sourceAccess?.role === 'admin') {
    return json({ message: 'Das richtige aktive Login von Kwame konnte nicht bestätigt werden. Es wurden keine Schichten verändert.' }, 409);
  }

  try {
    const result = await transferScheduleIdentity({
      sourceUserId,
      targetUserId,
      targetName: String(targetAccess.fullName).trim(),
      actorId: access.current.userId,
      preview,
    });
    if (result.conflicts.length) {
      return json({
        message: 'Kwame hat bereits zeitgleiche Dienste. Bitte Überschneidungen zuerst prüfen; es wurde nichts übertragen.',
        ...result, preview,
      }, 409);
    }
    if (!preview && result.moved) {
      await tryRecordPortalAdminChange({
        actor: access.current,
        category: 'Mitarbeiter',
        action: 'Dienstpläne von Platzhalterkonto auf echtes Konto übertragen',
        entityId: targetUserId,
        targetName: String(targetAccess.fullName),
        before: { sourceUserId, shiftCount: result.shiftCount },
        after: { targetUserId, moved: result.moved, publishedCount: result.publishedCount },
      });
    }
    return json({ ok: true, preview, ...result, sourceName: '12', targetName: String(targetAccess.fullName).trim() });
  } catch (error) {
    console.error('Employee schedule account transfer failed', error);
    return json({ message: 'Die sichere Dienstplanübertragung ist fehlgeschlagen. Es wurden keine Teiländerungen gespeichert.' }, 503);
  }
}

export default async (request: Request, context: Context) => {
  const access = await requirePortalRole(['owner', 'admin', 'manager']);
  if (access.response) return access.response;

  if (request.method === 'PATCH') {
    const payload = await request.clone().json().catch(() => null) as Record<string, unknown> | null;

    // Check before the older backend sees the approval request. Both admin UI and
    // automated callers must go through this protection, not just the signup screen.
    if (payload?.action === 'approve') {
      try { verifyRequestOrigin(request); } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403); }
      if (access.current?.role === 'manager') return json({ message: 'Keine Freigabeberechtigung.' }, 403);
      const id = String(payload.id || '').trim();
      if (!id) return json({ message: 'Registrierungs-ID fehlt.' }, 400);
      try {
        const registrations = await readPortalRegistrationIdentities();
        const target = registrations.find((row) => String(row.id || '').trim() === id);
        if (!target || !normalizeRegistrationEmail(target.email)) {
          return json({
            code: 'REGISTRATION_CHECK_UNAVAILABLE',
            message: 'Die E-Mail-Adresse dieser Anfrage konnte nicht sicher geprüft werden. Bitte nicht freigeben und den Hauptadmin informieren.',
          }, 409);
        }
        const collision = findRegistrationEmailConflict(target, registrations);
        if (collision) {
          return json({
            code: 'DUPLICATE_REGISTRATION_EMAIL',
            message: collision.status === 'approved'
              ? 'Diese E-Mail-Adresse ist bereits freigeschaltet. Bitte vorhandenen Zugang benutzen oder „Passwort vergessen“ wählen.'
              : 'Für diese E-Mail-Adresse liegt bereits eine ältere Anfrage vor. Bitte diese zuerst bearbeiten.',
          }, 409);
        }
      } catch {
        return json({
          code: 'REGISTRATION_CHECK_UNAVAILABLE',
          message: 'Registrierungsdaten konnten nicht sicher geprüft werden. Freigabe vorübergehend gesperrt.',
        }, 503);
      }
    }

    if (payload?.action === 'preview-kwame-schedule-transfer' || payload?.action === 'confirm-kwame-schedule-transfer') {
      return manageKwameScheduleTransfer(request, access, payload);
    }

    if (payload?.action === 'update-role' || payload?.action === 'deactivate-account' || payload?.action === 'update-profile') {
      return manageActiveEmployee(request, access, payload);
    }
  }

  if (request.method === "POST") {
    const clone = request.clone();
    const payload = await clone.json().catch(() => null) as Record<string, unknown> | null;
    const isNewRegistration = Boolean(payload?.id && payload?.email && !payload?.action);
    if (isNewRegistration && !allowRegistration(context)) {
      return Response.json(
        { message: "Zu viele Registrierungsversuche. Bitte in zehn Minuten erneut versuchen." },
        { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "600", "X-Robots-Tag": "noindex" } }
      );
    }
  }

  const upstream = await proxyToProductionBackend(request, "/api/registrations");
  if (request.method === 'GET' && access.current) return enrichEmployeeRoles(upstream, access.current);
  if (request.method === 'PATCH' && upstream.ok) {
    const data = await upstream.clone().json().catch(() => null) as Record<string, unknown> | null;
    const employee = data?.employee as Record<string, unknown> | undefined;
    const role = String(employee?.role || data?.role || 'employee');
    const allowedRoles = new Set(['owner', 'admin', 'manager', 'scheduler', 'employee']);
    if (employee?.userId && employee?.fullName && allowedRoles.has(role)) {
      await upsertScheduleEmployee({
        userId: String(employee.userId),
        fullName: String(employee.fullName),
        role: role as ScheduleEmployee['role'],
        status: 'active',
        location: String(employee.location || ''),
      });
    }
  }
  return upstream;
};

export const config: Config = { path: "/api/registrations" };
