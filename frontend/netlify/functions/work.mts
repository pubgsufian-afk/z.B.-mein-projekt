import type { Config, Context } from "@netlify/functions";
import { verifyRequestOrigin } from "@netlify/identity";
import {
  error,
  getPortalStore,
  json,
  readAll,
  requireManagement,
  requireUser,
} from "./_shared/portal.mts";

interface ScheduleEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  day: string;
  start: string;
  end: string;
  location: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

interface TimeEvent {
  id: string;
  userId: string;
  action: "started" | "break-started" | "break-ended" | "ended";
  occurredAt: string;
  date: string;
}

export default async function work(request: Request, _context: Context) {
  try {
    const current = await requireUser();
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource");

    if (request.method === "GET" && resource === "schedule") {
      const canSeeAll = ["owner", "admin", "manager"].includes(current.role);
      const entries = canSeeAll
        ? await readAll<ScheduleEntry>("portal-work", "schedule/")
        : await readAll<ScheduleEntry>("portal-work", `schedule/${current.user.id}/`);
      return json({ shifts: groupSchedule(entries) });
    }

    if (request.method === "GET" && resource === "times") {
      const canSeeAll = ["owner", "admin", "manager"].includes(current.role);
      const events = canSeeAll
        ? await readAll<TimeEvent>("portal-work", "time/")
        : await readAll<TimeEvent>("portal-work", `time/${current.user.id}/`);
      return json({ events: events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)) });
    }

    if (request.method !== "POST") return error("Methode nicht erlaubt.", 405);
    verifyRequestOrigin(request);
    const body = await request.json() as Record<string, string>;

    if (body.resource === "time") {
      if (!["employee", "manager", "admin", "owner"].includes(current.role)) return error("Konto nicht freigeschaltet.", 403);
      if (!["started", "break-started", "break-ended", "ended"].includes(body.action)) return error("Ungültige Zeitaktion.");
      const now = new Date();
      const event: TimeEvent = {
        id: crypto.randomUUID(),
        userId: current.user.id,
        action: body.action as TimeEvent["action"],
        occurredAt: now.toISOString(),
        date: now.toISOString().slice(0, 10),
      };
      await getPortalStore("portal-work").setJSON(`time/${current.user.id}/${event.date}/${event.id}`, event);
      return json({ event }, 201);
    }

    if (body.resource === "schedule") {
      await requireManagement(true);
      if (!body.employeeId || !body.employeeName || !body.date || !body.start || !body.end || !body.location) {
        return error("Mitarbeiter, Datum, Zeit und Einsatzort sind erforderlich.");
      }
      const entry: ScheduleEntry = {
        id: crypto.randomUUID(),
        employeeId: body.employeeId,
        employeeName: body.employeeName,
        date: body.date,
        day: dayLabel(body.date),
        start: body.start,
        end: body.end,
        location: body.location,
        note: body.note || "",
        createdBy: current.user.id,
        createdAt: new Date().toISOString(),
      };
      await getPortalStore("portal-work").setJSON(`schedule/${entry.employeeId}/${entry.date}/${entry.id}`, entry);
      return json({ entry }, 201);
    }

    return error("Unbekannte Anfrage.");
  } catch (caught) {
    if (caught instanceof Response) return caught;
    return error("Daten konnten nicht verarbeitet werden.", 500);
  }
}

function groupSchedule(entries: ScheduleEntry[]) {
  const grouped = new Map<string, { employeeId: string; employeeName: string; days: Record<string, ScheduleEntry> }>();
  for (const entry of entries.sort((a, b) => a.employeeName.localeCompare(b.employeeName))) {
    const row = grouped.get(entry.employeeId) || {
      employeeId: entry.employeeId,
      employeeName: entry.employeeName,
      days: {},
    };
    row.days[entry.day] = entry;
    grouped.set(entry.employeeId, row);
  }
  return [...grouped.values()];
}

function dayLabel(date: string) {
  return ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(`${date}T12:00:00`).getDay()];
}

export const config: Config = {
  path: "/api/work",
};
