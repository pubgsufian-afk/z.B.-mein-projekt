import type { Config, Context } from "@netlify/functions";
import { verifyRequestOrigin } from "@netlify/identity";
import {
  error,
  getPortalStore,
  json,
  readAll,
  requireManagement,
  type AccessRecord,
  type PortalRole,
  type Registration,
} from "./_shared/portal.mts";

const ALLOWED_ROLES = new Set<PortalRole>(["employee", "manager", "admin"]);

export default async function registrations(request: Request, _context: Context) {
  try {
    const current = await requireManagement(false);

    if (request.method === "GET") {
      const values = await readAll<Registration>("portal-registrations", "registration/");
      const requests = values
        .filter((item) => item.status === "pending")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return json({ requests });
    }

    if (request.method !== "PATCH") return error("Methode nicht erlaubt.", 405);
    verifyRequestOrigin(request);

    const body = await request.json() as { id?: string; action?: string; role?: PortalRole };
    if (!body.id || !["approve", "reject"].includes(body.action || "")) {
      return error("Ungültige Entscheidung.");
    }

    const store = getPortalStore("portal-registrations");
    const key = `registration/${body.id}`;
    const registration = await store.get(key, { type: "json" }) as Registration | null;
    if (!registration || registration.status !== "pending") {
      return error("Anfrage nicht gefunden.", 404);
    }

    if (body.action === "reject") {
      registration.status = "rejected";
      registration.decidedAt = new Date().toISOString();
      registration.decidedBy = current.user.id;
      await store.setJSON(key, registration);
      const rejectedAccess: AccessRecord = {
        userId: registration.id,
        role: "pending",
        status: "rejected",
        fullName: registration.fullName,
        employeeId: registration.employeeId,
        company: registration.company,
        location: registration.location,
        grantedAt: registration.decidedAt,
        grantedBy: current.user.id,
      };
      await getPortalStore("portal-access").setJSON(`access/${registration.id}`, rejectedAccess);
      return json({ ok: true });
    }

    const role = body.role || "employee";
    if (!ALLOWED_ROLES.has(role)) return error("Ungültige Rolle.");
    if (role === "admin" && current.role !== "owner") {
      return error("Nur der Hauptadmin darf weitere Admins bestimmen.", 403);
    }

    registration.status = "approved";
    registration.role = role;
    registration.decidedAt = new Date().toISOString();
    registration.decidedBy = current.user.id;
    const access: AccessRecord = {
      userId: registration.id,
      role,
      status: "active",
      fullName: registration.fullName,
      employeeId: registration.employeeId,
      company: registration.company,
      location: registration.location,
      grantedAt: registration.decidedAt,
      grantedBy: current.user.id,
    };
    await Promise.all([
      store.setJSON(key, registration),
      getPortalStore("portal-access").setJSON(`access/${registration.id}`, access),
    ]);

    return json({ ok: true, employee: access, role });
  } catch (caught) {
    if (caught instanceof Response) return caught;
    return error("Registrierungsanfrage konnte nicht verarbeitet werden.", 500);
  }
}

export const config: Config = {
  path: "/api/registrations",
};
