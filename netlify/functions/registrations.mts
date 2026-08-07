import type { Config, Context } from "@netlify/functions";
import { proxyToProductionBackend } from "./_shared/proxy.mts";
import { requirePortalRole } from "./_shared/portal-role.mts";
import { upsertScheduleEmployee, type ScheduleEmployee } from "./_shared/schedule-neon-repository.mts";

type RateEntry = { count: number; resetAt: number };
const attempts = new Map<string, RateEntry>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

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

export default async (request: Request, context: Context) => {
  const access = await requirePortalRole(['owner', 'admin', 'manager']);
  if (access.response) return access.response;

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
