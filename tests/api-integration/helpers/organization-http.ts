import { randomUUID } from "node:crypto";
import type { createApp } from "../../../apps/api/src/index";

// Shared HTTP-level helpers for driving the better-auth organization() plugin
// routes as a real client would (real sign-up, real cookies, real plugin
// endpoints under /api/auth/organization/*) rather than mocking sessions.
//
// These exist to support the S1 characterization suite
// (organization-plugin-characterization.test.ts,
// organization-invite-rate-limit.test.ts,
// organization-invite-abuse-guards.test.ts,
// organization-active-session.test.ts) required by the organization()
// retrofit plan (issue #6, S1 row). They intentionally return raw HTTP
// responses / DB-shaped values, never the plugin's parsed response bodies,
// so callers assert on database state rather than on a response shape that
// S4-S7 will change.

export type App = ReturnType<typeof createApp>["app"];

export function extractSessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
}

export type SignedUpUser = {
  cookie: string;
  user: { id: string; email: string };
};

/**
 * Signs a new user up through the real `/sign-up/email` route (autoSignIn is
 * enabled in apps/api/src/auth.ts, so this also mints a session/cookie) and
 * returns that cookie plus the created user row.
 */
/**
 * A distinct client address per call.
 *
 * `auth.ts` rate-limits `/sign-up/email` to **3 per 60 seconds per client IP**
 * (the `customRules` block), and #16 turned that limiter on for every
 * deployment — kaneo had it `enabled: isCloud()`, so the abuse protection was
 * off for exactly the self-hosted shape TaskDesk ships. It is a real control and
 * these tests must not disable it.
 *
 * A characterization file signs up a dozen or more users. Those are *different
 * people*, and modelling them as one client is what is wrong — not the limit. So
 * each call presents its own `x-forwarded-for`, which is precisely what a
 * distinct client looks like to `resolveClientIp` at the default trust depth of
 * 1. The trusted internal header cannot be spoofed this way: `buildAuthRequest`
 * strips any inbound `x-taskdesk-client-ip` before setting its own.
 *
 * TWO MODES, and the distinction is now real rather than described. Ordinary
 * helper traffic takes a UNIQUE address per call, from this counter. The R1
 * rate-limit characterization passes ONE fixed TEST-NET-2 address explicitly on
 * all six of its requests, because pinning the bucket is what makes six calls
 * one caller.
 *
 * An earlier version of this comment claimed the second mode was already how
 * R1 worked. It was not: that test passed no address at all and its calls
 * shared a bucket only via better-auth's NODE_ENV=test localhost fallback — or
 * the "no-trusted-ip" bucket. Either would still have passed while proving
 * something other than what the test said. Nothing here relies on that
 * fallback now.
 */
let clientIpCounter = 0;
export function nextClientIp(): string {
  clientIpCounter += 1;
  // 198.51.100.0/24 is TEST-NET-2 (RFC 5737) — reserved for documentation and
  // never routable, so nothing here can resemble a real address.
  return `198.51.100.${clientIpCounter % 254}`;
}

export async function signUpUser(
  app: App,
  overrides?: Partial<{
    email: string;
    password: string;
    name: string;
    clientIp: string;
  }>,
): Promise<SignedUpUser> {
  const email = overrides?.email ?? `user-${randomUUID()}@example.com`;
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": overrides?.clientIp ?? nextClientIp(),
    },
    body: JSON.stringify({
      email,
      password: overrides?.password ?? "correct horse battery staple",
      name: overrides?.name ?? "Integration Test User",
    }),
  });
  if (response.status !== 200) {
    throw new Error(
      `signUpUser: sign-up failed with ${response.status}: ${await response.text()}`,
    );
  }
  const cookie = extractSessionCookie(response);
  const body = (await response.json()) as {
    user: { id: string; email: string };
  };
  return { cookie, user: body.user };
}

/**
 * Creates a workspace through the plugin's real `/organization/create` route
 * (apps/api/src/auth.ts:292-329 schema mapping, :363-368
 * beforeCreateOrganization, :369-411 afterCreateOrganization). Returns the
 * raw Response so callers can assert on status as well as the created id.
 */
export async function createWorkspaceViaPlugin(
  app: App,
  cookie: string,
  overrides?: Partial<{ name: string; slug: string }>,
): Promise<Response> {
  return app.request("/api/auth/organization/create", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: overrides?.name ?? "Characterization Workspace",
      slug: overrides?.slug ?? `workspace-${randomUUID()}`,
    }),
  });
}

/**
 * Invites `email` into `workspaceId` with `role` as `ownerCookie`, then signs
 * that email up as a brand-new user and accepts the invitation as them.
 * Mirrors the real invite -> sign-up -> accept flow
 * (apps/api/src/auth.ts:413-444 sendInvitationEmail /
 * better-auth's acceptInvitation, which matches invitation.email against
 * session.user.email).
 */
export async function inviteAndAcceptAsNewMember(
  app: App,
  ownerCookie: string,
  workspaceId: string,
  role: string,
): Promise<SignedUpUser> {
  const email = `member-${randomUUID()}@example.com`;
  // Own client address, for the same reason as signUpUser: auth.ts rate-limits
  // `/organization/invite-member` to 5 per 60 seconds per client IP
  // (auth.ts:520), and #16 turned that limiter on for every deployment. Each
  // invitation here stands for a different admin acting from their own browser,
  // so one address per call is the accurate model -- and it keeps unrelated
  // tests from spending the R1 characterization's budget of 5. R1 pins ONE
  // explicit address instead, which is the only intentional same-client
  // sequence in the suite.
  const invited = await app.request("/api/auth/organization/invite-member", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: ownerCookie,
      "x-forwarded-for": nextClientIp(),
    },
    body: JSON.stringify({ organizationId: workspaceId, email, role }),
  });
  if (invited.status !== 200) {
    throw new Error(
      `inviteAndAcceptAsNewMember: invite failed with ${invited.status}: ${await invited.text()}`,
    );
  }
  const invitation = (await invited.json()) as { id: string };

  const member = await signUpUser(app, { email });

  const accepted = await app.request(
    "/api/auth/organization/accept-invitation",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: member.cookie,
      },
      body: JSON.stringify({ invitationId: invitation.id }),
    },
  );
  if (accepted.status !== 200) {
    throw new Error(
      `inviteAndAcceptAsNewMember: accept failed with ${accepted.status}: ${await accepted.text()}`,
    );
  }

  return member;
}

/**
 * The same plugin route as `updateMemberRoleViaPlugin`, but with the request's **media type
 * and raw body under the caller's control** — including omitting `Content-Type` entirely.
 *
 * This exists because `organization-plugin-role-guard.ts` decides whether to inspect a body,
 * and an earlier version made that decision from a case-SENSITIVE
 * `contentType.includes("application/json")`. `Content-Type: Application/JSON` therefore
 * skipped the guard while better-auth — which parses with `request.json()` and never consults
 * the header — went on to write the multi-role value. Testing that needs a client that can
 * spell the header differently and can send a body that is not valid JSON at all, neither of
 * which `JSON.stringify` plus a fixed header can do.
 *
 * Pass `contentType: null` to send **no** `Content-Type` header.
 */
export async function updateMemberRoleViaPluginRaw(
  app: App,
  actingCookie: string,
  rawBody: string,
  contentType: string | null,
  /**
   * An optional query string, leading `?` included. better-auth's `update-member-role` never
   * reads the query — which is precisely why it is worth being able to send one: a guard that
   * resolved its target from the query could be pointed somewhere the handler will not act,
   * and issue #82's NB-1 was exactly that.
   */
  queryString = "",
): Promise<Response> {
  const headers: Record<string, string> = { cookie: actingCookie };
  if (contentType !== null) headers["content-type"] = contentType;
  return app.request(
    `/api/auth/organization/update-member-role${queryString}`,
    {
      method: "POST",
      headers,
      body: rawBody,
    },
  );
}

/**
 * Drives the still-mounted plugin route `POST
 * /api/auth/organization/update-member-role` (better-auth's
 * `crud-members.mjs`, `updateMemberRoleBodySchema` at line 215) exactly as
 * an admin/owner client would. `role` is typed as `string | string[]`
 * deliberately -- the body schema accepts
 * `z.union([z.string(), z.array(z.string())])`, and it is the array shape
 * that lets a caller ask for more than one role at once (issue #82). This
 * returns the raw `Response` so callers can assert on status as well as on
 * the `workspace_member` row the route writes.
 */
export async function updateMemberRoleViaPlugin(
  app: App,
  actingCookie: string,
  organizationId: string,
  memberId: string,
  role: string | string[],
): Promise<Response> {
  return app.request("/api/auth/organization/update-member-role", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: actingCookie },
    body: JSON.stringify({ organizationId, memberId, role }),
  });
}

/**
 * Writes a role value into `workspace_member` that migration `0050`'s CHECK constraint
 * forbids — the ONLY way to reproduce a legacy malformed row once #82's remediation is in
 * place, and therefore load-bearing rather than a convenience.
 *
 * WHY THIS IS NOT CHEATING. After #82 there are three controls in the way of a multi-role
 * value: `organizationPluginRoleGuard` refuses the write, the evaluator refuses the read,
 * and `workspace_member_role_single_value` refuses the row. Together they make the state
 * unreachable through any route — which is the point, and which also means a test can no
 * longer create it the way the characterization suite used to, by asking the plugin nicely.
 * But "unreachable through a route" is not "impossible": a deployment that upgrades INTO
 * this fix may already hold such a row, written months ago by the plugin when nothing
 * stopped it. That row is exactly what the read-side remediation exists for, so it must
 * still be testable. This helper reproduces it the only way it can now arise — as data that
 * predates the constraint.
 *
 * The constraint is re-added `NOT VALID`, which is what makes this safe to use mid-suite:
 * PostgreSQL then enforces it on every subsequent INSERT and UPDATE while not re-checking
 * the row just planted. So the guard stays live for the rest of the test — a test that
 * plants a legacy row does not thereby switch the constraint off for everything after it.
 */
export async function plantLegacyMembershipRole(
  workspaceId: string,
  userId: string,
  role: string,
): Promise<void> {
  const { sql } = await import("drizzle-orm");
  const { default: db } = await import("../../../apps/api/src/database");

  await db.execute(
    sql`ALTER TABLE "workspace_member" DROP CONSTRAINT IF EXISTS "workspace_member_role_single_value"`,
  );
  await db.execute(
    sql`UPDATE "workspace_member" SET "role" = ${role} WHERE "workspace_id" = ${workspaceId} AND "user_id" = ${userId}`,
  );
  await db.execute(
    sql`ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_role_single_value" CHECK (position(',' in "role") = 0 AND "role" = btrim("role") AND btrim("role") <> '') NOT VALID`,
  );
}
