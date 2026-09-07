import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  signUpUser,
} from "./helpers/organization-http";

// R1 (retrofit plan §4, highest silent-failure risk), first half: the
// rate-limit customRule keyed on the literal path string
// "/organization/invite-member" -- apps/api/src/auth.ts:505-522, the rule
// itself at auth.ts:520.
//
// THIS FILE EXERCISES THE SELF-HOSTED CONFIGURATION, AND THAT IS THE WHOLE
// POINT. An earlier revision forced KANEO_CLOUD=true for the whole file, which
// defeated the control it exists to protect. kaneo shipped `rateLimit.enabled:
// isCloud()`, leaving authentication abuse protection off for exactly the
// self-hosted shape TaskDesk ships; #16 set `enabled: true` for EVERY
// deployment. Under a regression back to `isCloud()`, KANEO_CLOUD=true keeps the
// limiter on and [200x5, 429] still passes -- so the one regression this oracle
// names as its reason to exist was invisible to it.
//
// So: no KANEO_CLOUD here. The assertion below actively refuses to run in cloud
// mode rather than trusting the ambient environment, because a stray
// KANEO_CLOUD=true would silently restore the blind spot. KANEO_CLOUD governs
// the SEPARATE cloud invite-abuse hook (auth.ts:630), characterized in
// organization-invite-abuse-guards.test.ts, not whether this limiter runs.
//
// Proven by mutation: with `rateLimit.enabled` reverted to `isCloud()` and
// KANEO_CLOUD unset, this test goes RED on the sixth call -- 200 where 429 is
// expected. That is recorded in the remediation report for F2.
//
// This test intentionally lives ALONE in its own file: better-auth's in-memory
// rate-limit store is a module-level Map, shared by every createApp() call
// within one test *file* (vitest's default per-file module isolation gives each
// file its own copy, but not each `it`/`describe` within a file). Keeping the
// disposable-email and anonymous-guest R1 checks in a different file stops their
// one invite-member call each from consuming this test's budget of 5.
//
// EXECUTED. These assertions run against a real PostgreSQL 18: the independent
// review of bc8a749 reproduced them green, and the F1-F10 remediation pass
// re-ran them on a freshly created database. An earlier header here claimed
// "UNRUN: no PostgreSQL is available in this environment", which was false at
// that HEAD and is corrected rather than quietly dropped.
describe("R1: rate-limit customRule on /organization/invite-member (auth.ts:505-522)", () => {
  // ONE fixed client address for all six requests. The limiter buckets per
  // resolved client IP, so pinning the address is what makes six calls one
  // caller. 198.51.100.0/24 is TEST-NET-2 (RFC 5737) -- reserved for
  // documentation, never routable. A high host deliberately: the helper's
  // nextClientIp() walks 198.51.100.1 upward and this file's own helper traffic
  // takes only the low end, so nothing collides with the pinned bucket.
  //
  // Not left implicit. Without an explicit address these calls would share a
  // bucket only via better-auth's NODE_ENV=test localhost fallback, or the
  // "no-trusted-ip" bucket -- either of which would still pass while proving
  // something other than what the test says (F9).
  const PINNED_CLIENT_IP = "198.51.100.203";

  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("allows 5 invite-member requests within the 60s window and rejects the 6th with 429, in the SELF-HOSTED configuration", async () => {
    // The self-hosted premise, asserted rather than assumed. If KANEO_CLOUD is
    // set, this file is measuring the cloud path and its result would not
    // constrain the configuration TaskDesk actually ships.
    expect(process.env.KANEO_CLOUD).not.toBe("true");

    // customRules["/organization/invite-member"] = { window: 60, max: 5 }
    // -- apps/api/src/auth.ts:520. Six rapid calls from ONE caller: the first 5
    // succeed, the 6th is blocked. If invitations ever move to a new path (S6a)
    // without moving this rule along, the customRule keys on a path nothing hits
    // any more and the 6th call also returns 200 -- silently, with no failing
    // test anywhere else in the suite (retrofit plan §4, R1).
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
            // The same address on every call, explicitly. At the default trust
            // depth of 1 a single-entry chain is taken verbatim, so this is what
            // one distinct client looks like to resolveClientIp.
            "x-forwarded-for": PINNED_CLIENT_IP,
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
