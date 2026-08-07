import type { Config, Context } from "@netlify/functions";
import { getStore } from '@netlify/blobs';
import { verifyRequestOrigin } from '@netlify/identity';
import { proxyToProductionBackend } from "./_shared/proxy.mts";
import { requirePortalRole } from "./_shared/portal-role.mts";
import { upsertScheduleEmployee, type ScheduleEmployee } from "./_shared/schedule-neon-repository.mts";

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

async function enrichEmployeeRoles(upstream: Response) {
  if (!upstream.ok) return upstream;
  const data = await upstream.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (!data || !Array.isArray(data.employees)) return upstream;

  const store = getStore({ name: 'portal-access', consistency: 'strong' });
  const { blobs } = await store.list({ prefix: 'access/' });
  const records = await Promise.all(blobs.map((blob) => store.get(blob.key, { type: 'json' }) as Promise<AccessRecord | null>));
  const roles = new Map(records.filter((record): record is AccessRecord => Boolean(record?.userId)).map((record) => [String(record.userId), record.role || 'employee']));
  const employees = data.employees.map((value) => {
    const employee = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const userId = String(employee.userId || employee.id || '');
    return { ...employee, role: roles.get(userId) || String(employee.role || 'employee') };
  });
  return json({ ...data, employees });
}

async function updateActiveEmployeeRole(request: Request, access: Awaited<ReturnType<typeof requirePortalRole>>) {
  if (!access.current || !['owner', 'admin'].includes(access.current.role)) return json({ message: 'Nur Hauptadmin oder Admin dürfen Mitarbeiterrollen ändern.' }, 403);
  try { verifyRequestOrigin(request); } catch { return json({ message: 'Ungültige Anfragequelle.' }, 403); }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = String(body?.id || '').trim();
  const role = String(body?.role || '').trim();
  if (!id || !ASSIGNABLE_ROLES.has(role)) return json({ message: 'Mitarbeiter und gültige Rolle sind erforderlich.' }, 400);

  const store = getStore({ name: 'portal-access', consistency: 'strong' });
  const key = `access/${id}`;
  const target = await store.get(key, { type: 'json' }) as AccessRecord | null;
  if (!target || target.status !== 'active') return json({ message: 'Aktiver Mitarbeiter wurde nicht gefunden.' }, 404);
  if (target.role === 'owner') return json({ message: 'Der Hauptadmin ist geschützt und kann hier nicht geändert werden.' }, 403);
  if (access.current.role !== 'owner' && target.role === 'admin') return json({ message: 'Nur der Hauptadmin darf Admin-Konten ändern.' }, 403);
  if (role === 'admin' && access.current.role !== 'owner') return json({ message: 'Nur der Hauptadmin darf weitere Admins bestimmen.' }, 403);

  const now = new Date().toISOString();
  const employee: AccessRecord = {
    ...target,
    userId: String(target.userId || id),
    role: role as AccessRole,
    status: 'active',
    grantedAt: now,
    grantedBy: access.current.userId,
  };
  await store.setJSON(key, employee);

  if (employee.userId && employee.fullName) {
    await upsertScheduleEmployee({
      userId: employee.userId,
      fullName: employee.fullName,
      role: role as ScheduleEmployee['role'],
      status: 'active',
      location: String(employee.location || ''),
    });
  }

  return json({ ok: true, employee, role });
}

export default async (request: Request, context: Context) => {
  const access = await requirePortalRole(['owner', 'admin', 'manager']);
  if (access.response) return access.response;

  if (request.method === 'PATCH') {
    const payload = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (payload?.action === 'update-role') return updateActiveEmployeeRole(request, access);
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
  if (request.method === 'GET') return enrichEmployeeRoles(upstream);
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
