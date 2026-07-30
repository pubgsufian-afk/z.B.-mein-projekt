import type { Handler } from "@netlify/functions";
import {
  getPortalStore,
  notifyApprovalRequest,
  ownerEmails,
  safeCode,
  type Registration,
} from "./_shared/portal.mts";

const handler: Handler = async (event) => {
  const payload = JSON.parse(event.body || "{}") as {
    user?: {
      id?: string;
      email?: string;
      app_metadata?: Record<string, unknown>;
      user_metadata?: Record<string, unknown>;
    };
  };
  const user = payload.user;

  if (!user?.id || !user.email) {
    return { statusCode: 400, body: "Ungültige Registrierung." };
  }

  const email = user.email.toLowerCase();
  const isOwner = ownerEmails().has(email);
  const metadata = user.user_metadata || {};

  if (!isOwner) {
    const registration: Registration = {
      id: user.id,
      email,
      fullName: String(metadata.full_name || ""),
      employeeId: String(metadata.employee_id || ""),
      phone: String(metadata.phone || ""),
      company: String(metadata.company || ""),
      location: String(metadata.location || ""),
      approvalCode: safeCode(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    const store = getPortalStore("portal-registrations");
    await store.setJSON(`registration/${user.id}`, registration);
    await notifyApprovalRequest(registration);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        ...(user.app_metadata || {}),
        roles: [isOwner ? "owner" : "pending"],
      },
      user_metadata: metadata,
    }),
  };
};

export { handler };
