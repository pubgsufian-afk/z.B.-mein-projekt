import type { Config, Context } from "@netlify/functions";
import { proxyToProductionBackend } from "./_shared/proxy.mts";
import { requirePortalRole } from "./_shared/portal-role.mts";

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
  return proxyToProductionBackend(request, "/api/registrations");
};

export const config: Config = { path: "/api/registrations" };
