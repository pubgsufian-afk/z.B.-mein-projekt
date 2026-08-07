import type { Config, Context } from "@netlify/functions";
import { proxyToProductionBackend } from "./_shared/proxy.mts";
import { currentPortalActor } from "./_shared/portal-role.mts";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

export default async (request: Request, _context: Context) => {
  const current = await currentPortalActor();
  if (!current) return json({ message: "Nicht angemeldet." }, 401);

  const upstream = await proxyToProductionBackend(request, "/api/session");
  if (!upstream.ok) return upstream;

  const data = await upstream.json().catch(() => null) as Record<string, unknown> | null;
  if (!data) return json({ message: "Die Sitzung konnte nicht geladen werden." }, 502);

  if (current.role === 'employee') {
    return json({
      userId: data.userId || data.id,
      id: data.id || data.userId,
      email: data.email,
      fullName: data.fullName,
      role: 'employee',
    });
  }

  return json({ ...data, role: current.role });
};

export const config: Config = { path: "/api/session" };
