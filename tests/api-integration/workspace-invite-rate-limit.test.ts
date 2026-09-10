/**
 * S6a (retrofit plan §3, R1): the native equivalent of
 * `organization-invite-rate-limit.test.ts`, proving the rate limit MOVED
 * along with the invite route rather than being silently lost.
 * `apps/api/src/utils/require-invite-rate-limit.ts` is the native
 * `requireInviteRateLimit()` middleware mounted on
 * `POST /api/workspace/{id}/invitations`
 * (`apps/api/src/workspace/index.ts`) -- same window and max as the
 * plugin's own `customRules["/organization/invite-member"]`
 * (`{ window: 60, max: 5 }`, `apps/api/src/auth.ts`).
 *
 * Kept in its own file for the identical reason the plugin version is:
 * the in-memory bucket this middleware keeps is a module-level `Map`, and
 * mixing this file's six-call budget with other invite-create traffic in
 * the same file would make ordering matter.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  signUpUser,
} from "./helpers/organization-http";

describe("S6a: native rate limit on POST /api/workspace/{id}/invitations", () => {
  // Same fixed TEST-NET-2 address, same reasoning as
  // organization-invite-rate-limit.test.ts: pinning the bucket is what makes
  // six calls read as one caller to `resolveClientIp` at the default trust
  // depth of 1.
  const PINNED_CLIENT_IP = "198.51.100.204";

  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("allows 5 invite-create requests within the 60s window and rejects the 6th with 429", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const response = await app.request(
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
      );
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});
