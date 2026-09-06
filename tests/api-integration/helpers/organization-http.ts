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
export async function signUpUser(
  app: App,
  overrides?: Partial<{ email: string; password: string; name: string }>,
): Promise<SignedUpUser> {
  const email = overrides?.email ?? `user-${randomUUID()}@example.com`;
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  const invited = await app.request("/api/auth/organization/invite-member", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ownerCookie },
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
