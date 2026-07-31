import type { Handler, HandlerEvent } from "@netlify/functions";

const handler: Handler = async (event: HandlerEvent) => {
  const { user } = JSON.parse(event.body || "{}");
  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        ...(user?.app_metadata || {}),
        status: user?.app_metadata?.status || "pending",
        roles: Array.isArray(user?.app_metadata?.roles) ? user.app_metadata.roles : []
      }
    })
  };
};

export { handler };
