import { getDeployStore, getStore } from "@netlify/blobs";
import { admin, getUser } from "@netlify/identity";

export type PortalRole = "owner" | "admin" | "manager" | "employee" | "pending";

export interface Registration {
  id: string;
  email: string;
  fullName: string;
  employeeId: string;
  phone: string;
  company: string;
  location: string;
  approvalCode: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  role?: PortalRole;
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function error(message: string, status = 400) {
  return json({ message }, status);
}

export function ownerEmails() {
  return new Set(
    (Netlify.env.get("PORTAL_OWNER_EMAILS") || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getPortalStore(name: string) {
  if (Netlify.context?.deploy.context === "production") {
    return getStore({ name, consistency: "strong" });
  }
  return getDeployStore({ name });
}

export async function currentPortalUser() {
  const user = await getUser();
  if (!user) return null;

  const email = user.email?.toLowerCase() || "";
  const configuredOwner = ownerEmails().has(email);
  const roles = user.roles || [];
  const role = configuredOwner
    ? "owner"
    : ((roles.find((item) =>
        ["owner", "admin", "manager", "employee", "pending"].includes(item),
      ) || "pending") as PortalRole);

  if (configuredOwner && !roles.includes("owner")) {
    await admin.updateUser(user.id, {
      app_metadata: {
        ...(user.appMetadata || {}),
        roles: ["owner"],
      },
    });
  }

  return { user, role };
}

export async function requireUser() {
  const current = await currentPortalUser();
  if (!current) throw new Response("Nicht angemeldet", { status: 401 });
  return current;
}

export async function requireManagement(allowManager = true) {
  const current = await requireUser();
  const accepted = allowManager ? ["owner", "admin", "manager"] : ["owner", "admin"];
  if (!accepted.includes(current.role)) {
    throw new Response("Keine Berechtigung", { status: 403 });
  }
  return current;
}

export function publicUser(user: Awaited<ReturnType<typeof getUser>>) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: String(user.userMetadata?.full_name || ""),
    employeeId: String(user.userMetadata?.employee_id || ""),
    phone: String(user.userMetadata?.phone || ""),
    company: String(user.userMetadata?.company || ""),
    location: String(user.userMetadata?.location || ""),
  };
}

export async function readAll<T>(storeName: string, prefix: string) {
  const store = getPortalStore(storeName);
  const { blobs } = await store.list({ prefix });
  const values = await Promise.all(blobs.map((blob) => store.get(blob.key, { type: "json" })));
  return values.filter(Boolean) as T[];
}

export function safeCode() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}

export async function notifyApprovalRequest(registration: Registration) {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  const recipients = (Netlify.env.get("PORTAL_ADMIN_EMAILS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const from = Netlify.env.get("PORTAL_FROM_EMAIL");

  if (!apiKey || recipients.length === 0 || !from) return { delivered: false };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject: "Neue Registrierungsanfrage im Mitarbeiterportal",
      html: `
        <h2>Neue Registrierungsanfrage</h2>
        <p><strong>Name:</strong> ${escapeHtml(registration.fullName)}</p>
        <p><strong>Mitarbeiter-ID:</strong> ${escapeHtml(registration.employeeId)}</p>
        <p><strong>Einsatzort:</strong> ${escapeHtml(registration.location)}</p>
        <p><strong>Prüfcode:</strong> ${registration.approvalCode}</p>
        <p>Bitte im geschützten Admin-Bereich freischalten oder ablehnen.</p>
      `,
    }),
  });

  return { delivered: response.ok };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}
