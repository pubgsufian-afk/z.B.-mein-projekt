import type { Config, Context } from "@netlify/functions";
import { proxyToProductionBackend } from "./_shared/proxy.mts";

export default async (request: Request, _context: Context) => proxyToProductionBackend(request, "/api/settings");

export const config: Config = { path: "/api/settings" };
