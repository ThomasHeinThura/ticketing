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
 * Pass `clientIp` explicitly to pin several requests to ONE address — which is
 * how the rate-limit characterization proves the limiter still fires.
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
 * (apps/api/src/auth.ts:318-378 schema mapping, :412-417
 * beforeCreateOrganization, :418-460 afterCreateOrganization). Returns the
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
  // `/organization/invite-member` to 5 per 60 seconds per client IP, and #16
  // turned that limiter on for every deployment. Each invitation here stands for
  // a different admin acting from their own browser, so one address per call is
  // the accurate model. The rate-limit characterization pins ONE address on
  // purpose and still proves the limiter fires.
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
