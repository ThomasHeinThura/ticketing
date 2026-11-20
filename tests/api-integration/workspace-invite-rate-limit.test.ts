import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

describe("S6a: native rate limit on POST /api/workspace/{id}/invitations", () => {
  const PINNED_CLIENT_IP = "198.51.100.204";

  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("allows 10 requests per inviter in 60 seconds and rejects the 11th with Retry-After", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const other = await signUpUser(app);
    const otherWorkspace = (await (
      await createWorkspaceNative(app, other.cookie)
    ).json()) as { id: string };
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await csrfRequest(
        app,
        `/api/workspace/${workspace.id}/invitations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
            "x-forwarded-for": PINNED_CLIENT_IP,
          },
          body: JSON.stringify({
            email: `rate-limit-native-${i}-${randomUUID()}@example.com`,
            role: "member",
          }),
        },
        owner.cookie,
      );
      statuses.push(response.status);
      if (i === 10)
        expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
    const otherResponse = await csrfRequest(
      app,
      `/api/workspace/${otherWorkspace.id}/invitations`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: other.cookie,
          "x-forwarded-for": PINNED_CLIENT_IP,
        },
        body: JSON.stringify({
          email: `other-${randomUUID()}@example.com`,
          role: "member",
        }),
      },
      other.cookie,
    );
    expect(otherResponse.status).toBe(200);
  });
});
