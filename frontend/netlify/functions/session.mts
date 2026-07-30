import type { Config, Context } from "@netlify/functions";
import {
  error,
  getPortalStore,
  json,
  publicUser,
  readAll,
  requireUser,
  type AccessRecord,
  type Registration,
} from "./_shared/portal.mts";

export default async function session(_request: Request, _context: Context) {
  try {
    const { user, role } = await requireUser();
    const profile = publicUser(user);
    const registration = role === "pending"
      ? await getPortalStore("portal-registrations").get(`registration/${user.id}`, { type: "json" }) as Registration | null
      : null;

    let employeeCount = 0;
    if (["owner", "admin", "manager"].includes(role)) {
      const access = await readAll<AccessRecord>("portal-access", "access/");
      employeeCount = access.filter((item) =>
        item.status === "active" && ["employee", "manager", "admin", "owner"].includes(item.role)
      ).length;
    }

    let todayShift = null;
    if (role === "employee") {
      const today = new Date().toISOString().slice(0, 10);
      const shifts = await readAll<Record<string, unknown>>("portal-work", `schedule/${user.id}/`);
      todayShift = shifts.find((shift) => shift.date === today) || null;
    }

    return json({
      ...profile,
      role,
      employeeCount,
      todayShift,
      status: registration?.status || (role === "pending" ? "pending" : "active"),
    });
  } catch (caught) {
    if (caught instanceof Response) return caught;
    return error("Sitzung konnte nicht geladen werden.", 500);
  }
}

export const config: Config = {
  path: "/api/session",
};
