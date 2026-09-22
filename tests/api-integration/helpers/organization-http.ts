import { randomUUID } from "node:crypto";
import db, { schema } from "../../../apps/api/src/database";
import type { createApp } from "../../../apps/api/src/index";
import {
  ensureSetupToken,
  isSetupCompleted,
  SETUP_TOKEN_SINGLETON_ID,
} from "../../../apps/api/src/instance/setup-token";

// Plugin-independent HTTP-level test helpers: real sign-up, real cookies,
// and legacy-row planting -- used by dozens of files across
// tests/api-integration that have nothing to do with the organization()
// plugin (signUpUser alone is used by ~27 files).
//
// UPDATED FOR S10 (issue #6). This file used to also export five
// plugin-route-driving helpers (createWorkspaceViaPlugin,
// inviteAndAcceptAsNewMember, updateMemberRoleViaPlugin,
// updateMemberRoleViaPluginRaw, organizationActionViaPlugin), kept
// byte-identical to `main` while the S1 characterization oracle
// (organization-plugin-characterization.test.ts and its siblings) was still
// in service, so that oracle was never quietly weakened while it was the
// thing proving the plugin's behavior hadn't drifted. S10 deletes that
// oracle along with the organization() plugin itself, so the freeze this
// comment used to describe has lifted: there is nothing left it was
// protecting. The five plugin-route helpers are removed below; every real
// caller they had was ported to the native equivalents in
// workspace-invitation-write-http.ts / workspace-membership-write-http.ts /
// workspace-role-write-http.ts.
//
// What remains is genuinely plugin-independent: `signUpUser` drives the
// core `/sign-up/email` route (unrelated to organization()), and
// `plantLegacyMembershipRole` writes directly to the database rather than
// through any route at all -- both keep their real, current callers.

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

/**
 * #18 closed the "whoever signs up first becomes instance admin, no proof
 * required" hole: a zero-user instance now refuses `/sign-up/email` unless a
 * valid setup token (or TASKDESK_BOOTSTRAP_ADMIN_EMAIL) is presented.
 *
 * `signUpUser` below is the ordinary-user helper -- ~27 files across this
 * suite call it wanting nothing more than "a real, logged-in user", and never
 * meant to depend on instance-admin bootstrap timing. Rather than hand a
 * setup token to every one of them, this marks the instance as already set
 * up (`instance_setting.setup_completed_at`) whenever it isn't already, so
 * the bootstrap gate is inert and `signUpUser`'s HTTP call takes the
 * ordinary registration path no matter how many real rows exist in
 * `user`. Deliberately NOT a placeholder row inserted into `user` itself:
 * an earlier version of this did that, and it silently inflated every
 * count-the-whole-user-table assertion in the suite (p1-identity-schema-seed
 * backfills one `person` per `user` row, for example) by one. Tests that
 * deliberately want the real instance-admin bootstrap fixture use
 * `signUpInstanceAdmin` below instead, which drives the actual token flow.
 */
export async function ensureNotFirstSignup(): Promise<void> {
  if (await isSetupCompleted()) {
    return;
  }
  await db
    .insert(schema.instanceSettingTable)
    .values({
      id: SETUP_TOKEN_SINGLETON_ID,
      setupCompletedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.instanceSettingTable.id,
      set: { setupCompletedAt: new Date() },
    });
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
  await ensureNotFirstSignup();

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
 * Signs up the real, only-legitimate instance-admin bootstrap: obtains a
 * genuine setup token the same way a fresh boot would (`ensureSetupToken`,
 * the production function, not a reimplementation) and presents it on
 * `/sign-up/email` exactly as the setup page does. Only meaningful when the
 * instance is not yet claimed -- callers that need a real "this actor is the
 * instance admin" fixture use this instead of `signUpUser`.
 */
export async function signUpInstanceAdmin(
  app: App,
  overrides?: Partial<{
    email: string;
    password: string;
    name: string;
    clientIp: string;
  }>,
): Promise<SignedUpUser> {
  const setupToken = await ensureSetupToken();
  if (!setupToken) {
    throw new Error(
      "signUpInstanceAdmin: instance is already set up (or no token was issued) -- this helper only works on a fresh instance",
    );
  }

  const email =
    overrides?.email ?? `instance-admin-${randomUUID()}@example.com`;
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": overrides?.clientIp ?? nextClientIp(),
      "x-taskdesk-setup-token": setupToken,
    },
    body: JSON.stringify({
      email,
      password: overrides?.password ?? "correct horse battery staple",
      name: overrides?.name ?? "Instance Admin (test fixture)",
    }),
  });
  if (response.status !== 200) {
    throw new Error(
      `signUpInstanceAdmin: sign-up failed with ${response.status}: ${await response.text()}`,
    );
  }
  const cookie = extractSessionCookie(response);
  const body = (await response.json()) as {
    user: { id: string; email: string };
  };
  return { cookie, user: body.user };
}

/**
 * The caller's pending invitations in a workspace, read straight from the table.
 *
 * Probes against `cancel-invitation` must assert the invitation's own status rather than the
 * response code: the escalation returned `200` and the row moved to `canceled`, so a probe
 * checking only the status would have reported the bypass as a pass.
 */
export async function invitationStatus(invitationId: string): Promise<string> {
  const { eq } = await import("drizzle-orm");
  const { default: db, schema } = await import(
    "../../../apps/api/src/database"
  );
  const [row] = await db
    .select({ status: schema.invitationTable.status })
    .from(schema.invitationTable)
    .where(eq(schema.invitationTable.id, invitationId))
    .limit(1);
  if (!row) throw new Error(`invitationStatus: no invitation ${invitationId}`);
  return row.status;
}

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
