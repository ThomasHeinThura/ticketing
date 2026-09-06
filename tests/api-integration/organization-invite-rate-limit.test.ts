import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  signUpUser,
} from "./helpers/organization-http";

// R1 (retrofit plan §4, highest silent-failure risk), first half: the
// rate-limit customRule keyed on the literal path string
// "/organization/invite-member" -- apps/api/src/auth.ts:565-576, the rule
// itself at :574. `rateLimit.enabled: isCloud()` (apps/api/src/auth.ts:569)
// so this only engages when KANEO_CLOUD=true.
//
// This test intentionally lives ALONE in its own file: better-auth's
// in-memory rate-limit store is a module-level Map
// (better-auth/dist/api/rate-limiter/index.mjs), shared by every
// createApp() call within one test *file* (vitest's default per-file module
// isolation gives each file its own copy, but not each `it`/`describe`
// within a file). Putting the disposable-email and anonymous-guest R1
// checks in a different file (organization-invite-abuse-guards.test.ts)
// keeps their one invite-member call each from being silently counted
// against -- or silently consuming -- this test's budget of 5.
//
// UNRUN: no PostgreSQL is available in this environment; see the report for
// how this was verified by reading the source instead.
describe("R1: rate-limit customRule on /organization/invite-member (auth.ts:565-576)", () => {
  const CLOUD_ENV: Record<string, string> = { KANEO_CLOUD: "true" };
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const [key, value] of Object.entries(CLOUD_ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterAll(() => {
    for (const key of Object.keys(CLOUD_ENV)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("allows 5 invite-member requests within the 60s window and rejects the 6th with 429", async () => {
    // customRules["/organization/invite-member"] = { window: 60, max: 5 }
    // -- apps/api/src/auth.ts:574. Six rapid calls from the same caller
    // should see the first 5 succeed and the 6th blocked. If invitations
    // ever move to a new path (S6a) without moving this rule along
    // (auth.ts:520 in the retrofit plan's line numbers, :574 here), this
    // customRule keys on a path nothing hits any more and the 6th call
    // would also return 200 -- silently, with no failing test anywhere
    // else in the suite (retrofit plan §4, R1).
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const response = await app.request(
        "/api/auth/organization/invite-member",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: owner.cookie,
          },
          body: JSON.stringify({
            organizationId: workspace.id,
            email: `rate-limit-invitee-${i}-${randomUUID()}@example.com`,
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
