import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CAPABILITY_CHECKS } from "../../apps/api/src/capabilities/capability-checks";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  inviteAndAcceptAsNewMember,
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
    headers: { "content-type": "application/json", cookie },
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

describe("FINDING: default-role fallback diverges from the plugin once the row is gone (A1-P6)", () => {
  // Empirically measured (not assumed) across all three seeded default
  // roles before writing this test: with the workspace_role row removed,
  // "viewer" shows ZERO divergence across all 16 /api/capabilities checks
  // -- the compiled-in static viewer role
  // (packages/permissions/src/legacy-better-auth-access-control.ts:37-43)
  // grants only *:read, and none of the 16 checks this endpoint replaces
  // (apps/api/src/capabilities/capability-checks.ts) test a bare "read"
  // action. "member" and "admin" DO diverge, because their compiled
  // fallbacks grant create/update/delete actions that several of the 16
  // checks test directly. This test therefore uses "member" -- the
  // smallest role that actually demonstrates the gap through the real
  // endpoint -- rather than "viewer" as probes-A1.md names it; see the PR
  // description for the full writeup, including why "viewer" does not
  // reproduce it here.
  it("a member whose workspace_role row is removed KEEPS createTasks under /api/capabilities, while the plugin's has-permission denies it", async () => {
    // The plugin's own delete-role route refuses to remove a role that is
    // still assigned to a member (ROLE_IS_ASSIGNED_TO_MEMBERS -- see the S1
    // oracle's "delete-role" describe block), so the only way to reach
    // "assigned member, row gone" is a raw DB delete: a seed that silently
    // failed (afterCreateOrganization's seeding step swallows errors,
    // apps/api/src/auth.ts:369-411) or a not-yet-built S7 delete that omits
    // that guard (already a tracked gap -- retrofit plan §3, S7 row).
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

    await db
      .delete(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspace.id),
          eq(schema.workspaceRoleTable.role, "member"),
        ),
      );

    const pluginAnswer = await checkPluginPermission(
      app,
      member.cookie,
      workspace.id,
      CAPABILITY_CHECKS.createTasks,
    );
    const capabilities = await getCapabilities(
      app,
      member.cookie,
      workspace.id,
    );

    // This is the divergence, pinned in both directions so either side
    // regressing silently is caught:
    expect(pluginAnswer).toBe(false);
    // require-workspace-permission.ts:121-131 deliberately falls back to
    // the compiled-in static role when no workspace_role row matches, "to
    // protect viewer/member/admin users from a 403 if their workspace
    // somehow missed the seed" -- so /api/capabilities, built over that
    // SAME function exactly as specified (retrofit plan, S2 row), still
    // grants it. Fixing this requires changing require-workspace-
    // permission.ts, a shared-contract file this lane does not own and
    // whose behavior every other authenticated route already depends on.
    // Deliberately NOT asserting createTasks is false here -- it is true,
    // and that is the discovered divergence this test exists to pin down,
    // not paper over.
    expect(capabilities.createTasks).toBe(true);
  });
});
