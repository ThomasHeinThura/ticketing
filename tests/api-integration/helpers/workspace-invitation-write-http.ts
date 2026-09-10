import type { App } from "./organization-http";
import { nextClientIp } from "./organization-http";

// HTTP helpers for the S6a NATIVE invitation write routes (issue #6,
// retrofit plan §3, S6a row): invite (create), accept, reject, cancel.
// Deliberately separate from `organization-http.ts` (the frozen S1 oracle's
// file set, which drives the INHERITED plugin routes) and from
// `workspace-membership-write-http.ts` (S5's own routes) -- matching that
// same per-stage separation.
//
// Like their siblings these return the raw Response, so callers assert on
// database state and status codes rather than on a response shape.

/**
 * A unique `x-forwarded-for` per call, by default. `requireInviteRateLimit()`
 * (`apps/api/src/utils/require-invite-rate-limit.ts`) keys its bucket on the
 * resolved client address, and the integration test harness's `app.request`
 * exposes no real socket (`resolveClientIp` then falls back to a single
 * shared `"no-trusted-ip"` bucket) -- so, exactly like `signUpUser` and
 * `inviteAndAcceptAsNewMember` in `organization-http.ts`, ordinary calls here
 * must each present their own address or they will silently share ONE
 * caller's rate-limit budget across an entire test file. A caller that
 * deliberately wants to test the rate limit passes its own fixed IP in
 * `overrides.clientIp` instead (see `workspace-invite-rate-limit.test.ts`).
 */
export async function inviteWorkspaceMemberNative(
  app: App,
  cookie: string,
  workspaceId: string,
  body: { email?: unknown; role?: unknown; resend?: unknown },
  overrides?: { clientIp?: string },
): Promise<Response> {
  return app.request(`/api/workspace/${workspaceId}/invitations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-forwarded-for": overrides?.clientIp ?? nextClientIp(),
    },
    body: JSON.stringify(body),
  });
}

export async function acceptInvitationNative(
  app: App,
  cookie: string,
  invitationId: string,
): Promise<Response> {
  return app.request(`/api/invitation/${invitationId}/accept`, {
    method: "POST",
    headers: { cookie },
  });
}

export async function rejectInvitationNative(
  app: App,
  cookie: string,
  invitationId: string,
): Promise<Response> {
  return app.request(`/api/invitation/${invitationId}/reject`, {
    method: "POST",
    headers: { cookie },
  });
}

export async function cancelInvitationNative(
  app: App,
  cookie: string,
  invitationId: string,
): Promise<Response> {
  return app.request(`/api/invitation/${invitationId}`, {
    method: "DELETE",
    headers: { cookie },
  });
}
