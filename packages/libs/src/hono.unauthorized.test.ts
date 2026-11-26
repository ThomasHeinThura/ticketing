import { expect, it, vi } from "vitest";
import { createApiFetch, onUnauthorized } from "./hono";

const apiBaseUrl = "http://taskdesk.test/api";

it("fires once per first-party 401, not for sign-in routes, other statuses or foreign hosts", async () => {
  const listener = vi.fn();
  const off = onUnauthorized(listener);
  const respond = (status: number) =>
    createApiFetch(async () => new Response("Unauthorized", { status }), {
      apiBaseUrl,
      agentCsrfToken: false,
    });
  try {
    await respond(401)(`${apiBaseUrl}/projects`);
    expect(listener).toHaveBeenCalledTimes(1);
    await respond(401)(`${apiBaseUrl}/auth/sign-in/email`);
    await respond(403)(`${apiBaseUrl}/projects`);
    await respond(401)("https://elsewhere.test/api/projects");
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    off();
  }
});
