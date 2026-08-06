import type { Config, Context } from "@netlify/functions";
import { proxyToProductionBackend } from "./_shared/proxy.mts";
import { requirePortalRole } from "./_shared/portal-role.mts";

export default async (request: Request, _context: Context) => {
  const access = await requirePortalRole(['owner', 'admin']);
  if (access.response) return access.response;
  return proxyToProductionBackend(request, "/api/settings");
};

export const config: Config = { path: "/api/settings" };
