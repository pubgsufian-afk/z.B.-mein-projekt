import { currentPortalActor } from './portal-role.mts';
import { recordPortalAdminChange } from './portal-private-audit-service.mts';

const FALLBACK_ORIGIN = "https://6a6c6533a553914a3e6e9a53--habun-mitarbeiterportal.netlify.app";

const forwardedHeaders = (request: Request, origin: string) => {
  const headers = new Headers(request.headers);
  for (const name of ["connection", "content-length", "host", "transfer-encoding", "x-forwarded-host", "x-forwarded-proto"]) {
    headers.delete(name);
  }
  headers.set("x-habun-ui-version", "premium-main");
  headers.set("origin", origin);
  headers.set("referer", `${origin}/`);
  return headers;
};

export async function proxyToProductionBackend(request: Request, pathname: string): Promise<Response> {
  const origin = Netlify.env.get("PRODUCTION_BACKEND_ORIGIN") || FALLBACK_ORIGIN;
  const incoming = new URL(request.url);
  const upstream = new URL(pathname + incoming.search, origin);
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();

  const response = await fetch(upstream, {
    method: request.method,
    headers: forwardedHeaders(request, origin),
    body,
    redirect: "manual"
  });

  // Central audit for successful mutations routed through the existing backend.
  // Sensitive request bodies are never saved raw: only a small allowlisted
  // metadata subset is written, and the audit service redacts secret keys.
  if (response.ok && body && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    try {
      const actor = await currentPortalActor();
      if (actor && ['owner', 'admin', 'manager'].includes(actor.role)) {
        let input: Record<string, unknown> = {};
        if (body.byteLength <= 128000) {
          try {
            const parsed = JSON.parse(new TextDecoder().decode(body));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
          } catch { /* Some uploads are not JSON. Do not log their contents. */ }
        }
        const info: Record<string, unknown> = {};
        for (const key of ['id', 'userId', 'employeeUserId', 'role', 'status', 'date', 'start', 'end', 'pauseMinutes', 'workArea', 'location', 'action', 'fullName']) {
          if (input[key] !== undefined) info[key] = input[key];
        }
        await recordPortalAdminChange({
          actor,
          category: pathname.includes('registration') ? 'Mitarbeiter' : 'Portalverwaltung',
          action: String(input.action || request.method + ' ' + pathname),
          entityId: String(input.id || input.userId || input.employeeUserId || ''),
          summary: request.method + ' ' + pathname,
          after: info,
        });
      }
    } catch (error) {
      console.error('Central portal change logging unavailable', error);
    }
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Robots-Tag", "noindex");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders
  });
}
