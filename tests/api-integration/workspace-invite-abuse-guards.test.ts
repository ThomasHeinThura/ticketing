/**
 * S6a (retrofit plan §3, R1): the native equivalent of
 * `organization-invite-abuse-guards.test.ts`, proving the cloud
 * disposable-email/anonymous gate moved along with the invite route.
 * `apps/api/src/utils/require-invite-abuse-gate.ts` is the native
 * `requireInviteAbuseGate()` middleware mounted on
 * `POST /api/workspace/{id}/invitations`
 * (`apps/api/src/workspace/index.ts`).
 *
 * Kept in its own file, separate from `workspace-invitation-writes.test.ts`
 * and `workspace-invite-rate-limit.test.ts`, for the same reason the plugin
 * version is: each test below makes exactly one invite-create call, well
 * under that file's separate rate-limit budget of 5, so this file's own
 * ordering cannot make the rate-limit file flaky or vice versa.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  inviteAndAcceptAsNewMember,
  signUpUser,
} from "./helpers/organization-http";
import { inviteWorkspaceMemberNative } from "./helpers/workspace-invitation-write-http";

describe("S6a: native cloud abuse gates on POST /api/workspace/{id}/invitations", () => {
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

  it("blocks an invite to a disposable-email address on cloud, and writes no invitation row", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const response = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspace.id,
      { email: "throwaway@dropmail.me", role: "member" },
    );
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toMatch(/disposable-email/);

    const invitationRows = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.workspaceId, workspace.id));
    expect(invitationRows).toHaveLength(0);
  });

  it("allows an ordinary invite on cloud when the email is not disposable and the caller is not anonymous", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const response = await inviteWorkspaceMemberNative(
      app,
      owner.cookie,
      workspace.id,
      { email: "legitimate@example.com", role: "member" },
    );
    expect(response.status).toBe(200);
  });

  it("does not apply the disposable-email gate off cloud (self-hosted)", async () => {
    const savedFlag = process.env.KANEO_CLOUD;
    delete process.env.KANEO_CLOUD;
    try {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };

      const response = await inviteWorkspaceMemberNative(
        app,
        owner.cookie,
        workspace.id,
        { email: "throwaway@dropmail.me", role: "member" },
      );
      expect(response.status).toBe(200);
    } finally {
      if (savedFlag === undefined) {
        delete process.env.KANEO_CLOUD;
      } else {
        process.env.KANEO_CLOUD = savedFlag;
      }
    }
  });

  it("blocks a caller whose user.is_anonymous column is true, on cloud, even though #6 removed the anonymous() plugin from the ordinary sign-up flow", async () => {
    // No sign-up path in this codebase can set `isAnonymous: true` any more
    // (`organization-invite-abuse-guards.test.ts` characterizes the plugin's
    // OWN version of this branch as unreachable for exactly that reason).
    // `require-invite-abuse-gate.ts`'s doc comment explains why this native
    // gate reads the `is_anonymous` DB column directly rather than trusting
    // `c.get("user")` -- that column still exists and can still be set by
    // anything else that writes to it (a future guest-access feature, a
    // migration, direct operator action), so this proves the native gate
    // stays live against that column rather than silently inheriting the
    // plugin path's now-dead branch. Setting it directly is the only way to
    // reach it with no anonymous-sign-up flow to drive it through.
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    // A real, ordinary admin membership -- `requireWorkspacePermission`
    // must already be satisfied for this test to reach the abuse gate at
    // all, otherwise a 403 here would prove nothing about THIS guard.
    const guest = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "admin",
    );

    await db
      .update(schema.userTable)
      .set({ isAnonymous: true })
      .where(eq(schema.userTable.id, guest.user.id));

    const invited = await inviteWorkspaceMemberNative(
      app,
      guest.cookie,
      workspace.id,
      { email: "someone@example.com", role: "member" },
    );
    expect(invited.status).toBe(403);
    await expect(invited.text()).resolves.toMatch(/[Gg]uest/);

    // Filtered by email, deliberately: `inviteAndAcceptAsNewMember`'s own
    // setup call above already wrote (and accepted) an unrelated invitation
    // row for `guest`'s own email into this workspace, so an unfiltered
    // count would pass even if this gate let the blocked invite through.
    const invitationRows = await db
      .select()
      .from(schema.invitationTable)
      .where(
        and(
          eq(schema.invitationTable.workspaceId, workspace.id),
          eq(schema.invitationTable.email, "someone@example.com"),
        ),
      );
    expect(invitationRows).toHaveLength(0);
  });
});
