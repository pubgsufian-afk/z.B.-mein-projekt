import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { proxyToProductionBackend } from "./_shared/proxy.mts";

type PortalRole = "owner" | "admin" | "manager" | "employee" | "pending";

type ScheduleEntry = {
  id: string;
  employeeUserId: string;
  employeeId: string;
  employeeName: string;
  date: string;
  start: string;
  end: string;
  location: string;
  workArea: string;
  note: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
};

type AccessRecord = {
  role?: PortalRole;
  status?: string;
};

const MULTI_STORE = "portal-work-multi";
const MANAGEMENT_ROLES: PortalRole[] = ["owner", "admin", "manager"];

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Habun-Schedule-Mode": "multi-position",
    },
  });
}

function error(message: string, status = 400) {
  return json({ message }, status);
}

function multiStore() {
  return getStore({ name: MULTI_STORE, consistency: "strong" });
}

function accessStore() {
  return getStore({ name: "portal-access", consistency: "strong" });
}

function entryKey(entry: Pick<ScheduleEntry, "employeeUserId" | "date" | "id">) {
  return `schedule/${entry.employeeUserId}/${entry.date}/${entry.id}`;
}

async function currentPortalUser() {
  const user = await getUser();
  if (!user) return null;

  const email = String(user.email || "").trim().toLowerCase();
  const ownerEmails = new Set(
    (Netlify.env.get("PORTAL_OWNER_EMAILS") || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const access = await accessStore().get(`access/${user.id}`, { type: "json" }) as AccessRecord | null;
  const metadataRoles = Array.isArray(user.appMetadata?.roles)
    ? user.appMetadata.roles.filter((value): value is string => typeof value === "string")
    : [];
  const directRole = typeof (user as { role?: unknown }).role === "string"
    ? [(user as { role: string }).role]
    : [];
  const roles = [...new Set([...(user.roles || []), ...metadataRoles, ...directRole])];
  const role = ownerEmails.has(email)
    ? "owner"
    : access?.status === "active" && access.role
      ? access.role
      : ((roles.find((value) => ["owner", "admin", "manager", "employee", "pending"].includes(value)) || "pending") as PortalRole);

  return { user, role };
}

async function readLocalEntries(prefix = "schedule/") {
  const store = multiStore();
  const { blobs } = await store.list({ prefix });
  const values = await Promise.all(
    blobs.map((blob) => store.get(blob.key, { type: "json" }) as Promise<ScheduleEntry | null>),
  );
  return values.filter((value): value is ScheduleEntry => Boolean(value));
}

function normalized(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase("de");
}

function isExactDuplicate(candidate: Partial<ScheduleEntry>, entry: Partial<ScheduleEntry>) {
  return String(candidate.employeeUserId || "") === String(entry.employeeUserId || "")
    && candidate.date === entry.date
    && candidate.start === entry.start
    && candidate.end === entry.end
    && normalized(candidate.location) === normalized(entry.location)
    && normalized(candidate.workArea) === normalized(entry.workArea);
}

function validateSchedule(body: Record<string, unknown>) {
  const required = ["employeeUserId", "employeeId", "employeeName", "date", "start", "end", "location", "workArea"];
  const missing = required.filter((name) => !String(body[name] || "").trim());
  if (missing.length) return "Mitarbeiter, Datum, Zeit, Einsatzort und Arbeitsbereich sind erforderlich.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) return "Das Datum ist ungültig.";
  if (!/^\d{2}:\d{2}$/.test(String(body.start)) || !/^\d{2}:\d{2}$/.test(String(body.end))) {
    return "Beginn und Ende sind ungültig.";
  }
  return "";
}

function buildEntry(body: Record<string, unknown>, userId: string, existing?: ScheduleEntry): ScheduleEntry {
  const now = new Date().toISOString();
  return {
    id: existing?.id || String(body.entryId || crypto.randomUUID()),
    employeeUserId: String(body.employeeUserId || existing?.employeeUserId || ""),
    employeeId: String(body.employeeId || existing?.employeeId || ""),
    employeeName: String(body.employeeName || existing?.employeeName || ""),
    date: String(body.date || existing?.date || ""),
    start: String(body.start || existing?.start || ""),
    end: String(body.end || existing?.end || ""),
    location: String(body.location || existing?.location || ""),
    workArea: String(body.workArea || existing?.workArea || ""),
    note: String(body.note || ""),
    createdBy: existing?.createdBy || userId,
    createdAt: existing?.createdAt || String(body.createdAt || now),
    updatedAt: existing ? now : undefined,
  };
}

async function upstreamScheduleEntries(request: Request) {
  const url = new URL(request.url);
  url.search = "?resource=schedule";
  const upstreamRequest = new Request(url, {
    method: "GET",
    headers: request.headers,
  });
  const response = await proxyToProductionBackend(upstreamRequest, "/api/work");
  const data = await response.clone().json().catch(() => ({})) as { entries?: ScheduleEntry[] };
  return { response, data, entries: Array.isArray(data.entries) ? data.entries : [] };
}

async function proxyScheduleAction(request: Request, body: Record<string, unknown>) {
  return proxyToProductionBackend(new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  }), "/api/work");
}

export default async function work(request: Request, _context: Context) {
  const url = new URL(request.url);
  const queryResource = url.searchParams.get("resource");
  const currentAccess = await currentPortalUser();
  if (!currentAccess) return error("Nicht angemeldet.", 401);
  if (!MANAGEMENT_ROLES.includes(currentAccess.role)) return error("Keine Berechtigung.", 403);

  if (request.method === "GET" && queryResource === "schedule") {
    const current = currentAccess;
    const upstream = await proxyToProductionBackend(request, "/api/work");
    if (!upstream.ok || !current) return upstream;

    const data = await upstream.json().catch(() => ({})) as Record<string, unknown> & { entries?: ScheduleEntry[] };
    const prefix = MANAGEMENT_ROLES.includes(current.role) ? "schedule/" : `schedule/${current.user.id}/`;
    const localEntries = await readLocalEntries(prefix);
    const upstreamEntries = Array.isArray(data.entries) ? data.entries : [];
    const merged = [...upstreamEntries, ...localEntries]
      .filter((entry, index, values) => values.findIndex((candidate) => candidate.id === entry.id) === index)
      .sort((left, right) => `${left.date}-${left.start}-${left.employeeName}`.localeCompare(`${right.date}-${right.start}-${right.employeeName}`));

    return json({ ...data, entries: merged });
  }

  if (request.method !== "POST") return proxyToProductionBackend(request, "/api/work");

  const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (!body || body.resource !== "schedule") return proxyToProductionBackend(request, "/api/work");

  try {
    verifyRequestOrigin(request);
  } catch {
    return error("Ungültige Anfragequelle.", 403);
  }

  const current = currentAccess;

  const action = String(body.action || "create");
  const oldKey = body.entryId && body.originalEmployeeUserId && body.originalDate
    ? `schedule/${body.originalEmployeeUserId}/${body.originalDate}/${body.entryId}`
    : "";
  const existingLocal = oldKey
    ? await multiStore().get(oldKey, { type: "json" }) as ScheduleEntry | null
    : null;

  if (action === "delete") {
    if (existingLocal && oldKey) {
      await multiStore().delete(oldKey);
      return json({ deleted: true, id: existingLocal.id });
    }
    return proxyToProductionBackend(request, "/api/work");
  }

  const validation = validateSchedule(body);
  if (validation) return error(validation);

  if (action === "update" && existingLocal && oldKey) {
    const entry = buildEntry(body, current.user.id, existingLocal);
    const newKey = entryKey(entry);
    if (newKey !== oldKey) await multiStore().delete(oldKey);
    await multiStore().setJSON(newKey, entry);
    return json({ entry });
  }

  if (action === "update" && !existingLocal) {
    const upstreamUpdate = await proxyToProductionBackend(request, "/api/work");
    if (upstreamUpdate.ok) return upstreamUpdate;

    const upstreamError = await upstreamUpdate.clone().json().catch(() => ({})) as { message?: string };
    if (!/überschneid|overlap/i.test(String(upstreamError.message || ""))) return upstreamUpdate;

    const deleteResponse = await proxyScheduleAction(request, {
      resource: "schedule",
      action: "delete",
      entryId: body.entryId,
      originalEmployeeUserId: body.originalEmployeeUserId,
      originalDate: body.originalDate,
    });
    if (!deleteResponse.ok) return upstreamUpdate;

    const migrated = buildEntry(body, current.user.id);
    await multiStore().setJSON(entryKey(migrated), migrated);
    return json({ entry: migrated, migrated: true });
  }

  const { response: upstreamResponse, entries: upstreamEntries } = await upstreamScheduleEntries(request);
  if (!upstreamResponse.ok) return upstreamResponse;
  const localEntries = await readLocalEntries("schedule/");
  const candidate = buildEntry(body, current.user.id);
  const duplicate = [...upstreamEntries, ...localEntries].some((entry) => isExactDuplicate(candidate, entry));
  if (duplicate) {
    return error("Dieser Dienst ist bereits exakt für dieselbe Person, Zeit, Stelle und denselben Arbeitsbereich eingetragen.", 409);
  }

  await multiStore().setJSON(entryKey(candidate), candidate);
  return json({ entry: candidate }, 201);
}

export const config: Config = { path: "/api/work" };
