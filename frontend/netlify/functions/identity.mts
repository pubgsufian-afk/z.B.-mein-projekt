import type { UserSignupEvent } from "@netlify/functions";
import {
  getPortalStore,
  notifyApprovalRequest,
  ownerEmails,
  safeCode,
  type Registration,
} from "./_shared/portal.mts";

export default {
  async userSignup(event: UserSignupEvent) {
    const email = event.user.email?.toLowerCase() || "";
    const isOwner = ownerEmails().has(email);
    const metadata = event.user.userMetadata || {};

    if (!isOwner) {
      const registration: Registration = {
        id: event.user.id,
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
      await store.setJSON(`registration/${event.user.id}`, registration);
      await notifyApprovalRequest(registration);
    }

    return {
      user: {
        ...event.user,
        appMetadata: {
          ...event.user.appMetadata,
          roles: [isOwner ? "owner" : "pending"],
        },
      },
    };
  },
};
