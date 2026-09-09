import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CAPABILITY_CHECKS } from "../../apps/api/src/capabilities/capability-checks";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  inviteAndAcceptAsNewMember,
  nextClientIp,
  signUpUser,
} from "./helpers/organization-http";

// GET /api/capabilities is an equivalence claim, not a smoke test: for the
// SAME fixture, it must agree with the still-mounted organization() plugin's
// /organization/has-permission for every one of the 16 checks it replaces
// (retrofit plan, S2 row / matrix row 15, issue #6, plan §3 "S2 explicitly
// diffs the two evaluators over the same fixtures"). These tests drive BOTH
// evaluators over real HTTP, with real sessions -- exactly the S1
// characterization suite's own "has-permission" pattern
// (tests/api-integration/organization-plugin-characterization.test.ts:939-1123),
// reused read-only here, never modified.

type App = ReturnType<typeof createApp>["app"];

async function checkPluginPermission(
  app: App,
  cookie: string,
  organizationId: string,
  permissions: Record<string, string[]>,
): Promise<boolean> {
  const response = await app.request("/api/auth/organization/has-permission", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      // Every one of the 16 checks in this file's matrix tests is a
      // SEPARATE call to this route, and this route carries no
      // organization-specific rate-limit rule -- it falls under auth.ts's
      // general default (max 100 per 10s window). A matrix across
      // viewer/member/admin/custom plus the equivalence suite above adds
      // up to well over 100 calls in the same file, and without a
      // per-call client identity they would all land in one bucket and
      // start tripping 429s partway through -- not a plugin behavior this
      // suite is characterizing, just cross-test interference from
      // sharing one synthetic "caller". A fresh address per call is the
      // same fix `inviteAndAcceptAsNewMember` already applies for
      // `/organization/invite-member`'s own limit.
      "x-forwarded-for": nextClientIp(),
    },
    body: JSON.stringify({ organizationId, permissions }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { success: boolean };
  return body.success;
}

async function getCapabilities(
  app: App,
  cookie: string,
  workspaceId: string,
): Promise<Record<string, boolean>> {
  const response = await app.request(
    `/api/capabilities?workspaceId=${workspaceId}`,
    { headers: { cookie } },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, boolean>;
}

async function assertFullEquivalence(
  app: App,
  cookie: string,
  workspaceId: string,
) {
  const capabilities = await getCapabilities(app, cookie, workspaceId);

  for (const [name, permissions] of Object.entries(CAPABILITY_CHECKS)) {
    const expected = await checkPluginPermission(
      app,
      cookie,
      workspaceId,
      permissions,
    );
    expect(
      capabilities[name],
      `capability "${name}" (${JSON.stringify(permissions)}) should be ${expected}, got ${capabilities[name]}`,
    ).toBe(expected);
  }
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("GET /api/capabilities agrees with the plugin's has-permission (A1-P5)", () => {
  it("owner", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    await assertFullEquivalence(app, owner.cookie, workspace.id);
  });

  it("admin", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const admin = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "admin",
    );

    await assertFullEquivalence(app, admin.cookie, workspace.id);
  });

  it("member", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "member",
    );

    await assertFullEquivalence(app, member.cookie, workspace.id);
  });

  it("viewer", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const viewer = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "viewer",
    );

    await assertFullEquivalence(app, viewer.cookie, workspace.id);
  });

  it("a custom role", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    await app.request("/api/auth/organization/create-role", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({
        organizationId: workspace.id,
        role: "readonly-scratch",
        permission: { task: ["read"] },
      }),
    });
    const readonly = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "readonly-scratch",
    );

    await assertFullEquivalence(app, readonly.cookie, workspace.id);
  });
});

describe("issue #66 CLOSED: a missing/deleted workspace_role row fails closed under both evaluators (A1-P6)", () => {
  // This describe block used to be named "FINDING: default-role fallback
  // diverges from the plugin once the row is gone" and pinned the OPEN
  // defect: with the workspace_role row removed, require-workspace-
  // permission.ts fell back to the compiled-in static role, so
  // /api/capabilities (built directly over hasWorkspacePermission, per S2)
  // silently kept granting privileges the plugin's own has-permission
  // denied. That divergence measured empirically as 0/16 for "viewer"
  // (its compiled fallback only ever granted *:read, and none of the 16
  // checks this endpoint replaces test a bare read action), 6/16 for
  // "member", and 16/16 for "admin" -- see the PR history for the original
  // measurement. The fallback is gone now: a missing row denies every
  // permission regardless of role, so the matrix below asserts FULL
  // equivalence (both evaluators false on all 16 checks) for every one of
  // the three default roles, not just the one ("member") that used to be
  // the smallest reproducer of the gap.
  //
  // The plugin's own delete-role route refuses to remove a role that is
  // still assigned to a member (ROLE_IS_ASSIGNED_TO_MEMBERS -- see the S1
  // oracle's "delete-role" describe block), so the only way to reach
  // "assigned member, row gone" is a raw DB delete: a seed that failed
  // before this fix (afterCreateOrganization now rolls the workspace back
  // instead -- see workspace-write-create-atomicity.test.ts) or direct
  // database access, exactly as #65 measured.
  it.each(["viewer", "member", "admin"] as const)(
    "a %s whose workspace_role row is deleted is denied all 16 capability checks under BOTH evaluators",
    async (role) => {
      const { app } = createApp();
      const owner = await signUpUser(app);
      const created = await createWorkspaceViaPlugin(app, owner.cookie);
      const workspace = (await created.json()) as { id: string };
      const member = await inviteAndAcceptAsNewMember(
        app,
        owner.cookie,
        workspace.id,
        role,
      );

      await db
        .delete(schema.workspaceRoleTable)
        .where(
          and(
            eq(schema.workspaceRoleTable.workspaceId, workspace.id),
            eq(schema.workspaceRoleTable.role, role),
          ),
        );

      const capabilities = await getCapabilities(
        app,
        member.cookie,
        workspace.id,
      );
      for (const [name, permissions] of Object.entries(CAPABILITY_CHECKS)) {
        const pluginAnswer = await checkPluginPermission(
          app,
          member.cookie,
          workspace.id,
          permissions,
        );
        expect(pluginAnswer, `plugin: ${name}`).toBe(false);
        expect(capabilities[name], `capabilities: ${name}`).toBe(false);
      }
    },
  );

  it("a custom role whose workspace_role row is deleted is denied all 16 checks -- it never had a compiled fallback to restore", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    await app.request("/api/auth/organization/create-role", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify({
        organizationId: workspace.id,
        role: "readonly-deleted",
        permission: { task: ["read"] },
      }),
    });
    const readonly = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "readonly-deleted",
    );

    await db
      .delete(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspace.id),
          eq(schema.workspaceRoleTable.role, "readonly-deleted"),
        ),
      );

    const capabilities = await getCapabilities(
      app,
      readonly.cookie,
      workspace.id,
    );
    for (const [name, permissions] of Object.entries(CAPABILITY_CHECKS)) {
      const pluginAnswer = await checkPluginPermission(
        app,
        readonly.cookie,
        workspace.id,
        permissions,
      );
      expect(pluginAnswer, `plugin: ${name}`).toBe(false);
      expect(capabilities[name], `capabilities: ${name}`).toBe(false);
    }
  });

  it("delete-after-narrow escalation: narrowing a role's row and then deleting it does not restore the pre-narrow privilege", async () => {
    // THE ATTACK. An admin narrows a role (removing a capability from its
    // workspace_role row) -- then that row is deleted (or never re-seeded).
    // Before this fix, deleting the row fell back to the compiled-in
    // definition, undoing the narrowing. It must not.
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };
    const member = await inviteAndAcceptAsNewMember(
      app,
      owner.cookie,
      workspace.id,
      "member",
    );

    // Before narrowing: the seeded default "member" role grants createTasks.
    expect(
      (await getCapabilities(app, member.cookie, workspace.id)).createTasks,
    ).toBe(true);

    // Narrow: remove task:create from the seeded row, exactly what an admin
    // does in the Roles UI.
    const [row] = await db
      .select({ permission: schema.workspaceRoleTable.permission })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspace.id),
          eq(schema.workspaceRoleTable.role, "member"),
        ),
      );
    if (!row) throw new Error("expected a seeded member row");
    const permission = JSON.parse(row.permission) as Record<string, string[]>;
    permission.task = (permission.task ?? []).filter(
      (action) => action !== "create",
    );
    await db
      .update(schema.workspaceRoleTable)
      .set({ permission: JSON.stringify(permission) })
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspace.id),
          eq(schema.workspaceRoleTable.role, "member"),
        ),
      );

    expect(
      (await getCapabilities(app, member.cookie, workspace.id)).createTasks,
    ).toBe(false);

    // THE ESCALATION ATTEMPT: delete the narrowed row entirely.
    await db
      .delete(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspace.id),
          eq(schema.workspaceRoleTable.role, "member"),
        ),
      );

    // The narrowing must survive the delete -- privileges do NOT come back.
    expect(
      (await getCapabilities(app, member.cookie, workspace.id)).createTasks,
    ).toBe(false);
    expect(
      await checkPluginPermission(
        app,
        member.cookie,
        workspace.id,
        CAPABILITY_CHECKS.createTasks,
      ),
    ).toBe(false);
  });
});
