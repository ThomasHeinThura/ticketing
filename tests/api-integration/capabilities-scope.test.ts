import { createHash, randomUUID } from "node:crypto";
import { defaultRolePayloads } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CAPABILITY_CHECKS } from "../../apps/api/src/capabilities/capability-checks";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { upsertWorkspaceRoleRows } from "./helpers/workspace-role-rows";

// Pinned literally against the existing client permission keys and the two
// optional comment-choice response names. This prevents either side from
// silently renaming the API used by the single composer.
const EXPECTED_CAPABILITY_CHECKS: Record<string, Record<string, string[]>> = {
  manageProjects: { project: ["create", "update", "delete"] },
  createProjects: { project: ["create"] },
  updateProjects: { project: ["update"] },
  deleteProjects: { project: ["delete"] },
  updateTasks: { work_item: ["update"] },
  createTasks: { work_item: ["create"] },
  deleteTasks: { work_item: ["delete"] },
  assignTasks: { work_item: ["assign"] },
  createLabels: { label: ["create"] },
  updateLabels: { label: ["update"] },
  deleteLabels: { label: ["delete"] },
  manageWorkspace: { workspace: ["update", "manage_settings"] },
  deleteWorkspace: { workspace: ["delete"] },
  inviteUsers: { invitation: ["create"] },
  manageTeam: { member: ["update", "delete"] },
  removeMembers: { member: ["delete"] },
  createPublicComments: { comment: ["create"] },
  createInternalComments: { comment: ["create_internal"] },
};

// GET /api/capabilities -- one call replacing the client's legacy
// has-permission fan-out (retrofit plan, S2 row / matrix row 15, issue
// #6). Scope tests: it must never answer for a workspace other than the
// one asked about.

async function addMembership(
  userId: string,
  workspaceId: string,
  role: string,
) {
  await db.insert(schema.workspaceUserTable).values({
    userId,
    workspaceId,
    role,
    joinedAt: new Date(),
  });
  if (Object.hasOwn(defaultRolePayloads, role)) {
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId,
      role,
      permission: JSON.stringify(
        defaultRolePayloads[role as keyof typeof defaultRolePayloads],
      ),
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("the capability vocabulary matches the client helpers exactly (A1-P5)", () => {
  it("keeps legacy and comment choice keys aligned with server checks", () => {
    expect(CAPABILITY_CHECKS).toEqual(EXPECTED_CAPABILITY_CHECKS);
  });
});

describe("GET /api/capabilities", () => {
  it("reports public and internal comment choices from the caller's exact built-in role", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const admin = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const memberResponse = await app.request(
      `/api/capabilities?workspaceId=${member.workspace.id}`,
    );
    const memberCaps = (await memberResponse.json()) as Record<string, boolean>;
    expect(memberResponse.status).toBe(200);
    expect(memberCaps.createPublicComments).toBe(true);
    expect(memberCaps.createInternalComments).toBe(true);

    mockAuthenticatedSession(admin.user);
    const adminResponse = await app.request(
      `/api/capabilities?workspaceId=${admin.workspace.id}`,
    );
    const adminCaps = (await adminResponse.json()) as Record<string, boolean>;
    expect(adminResponse.status).toBe(200);
    expect(adminCaps.createPublicComments).toBe(true);
    expect(adminCaps.createInternalComments).toBe(true);
  });

  it("returns false for malformed role membership and denies duplicate membership rows", async () => {
    const malformed = await createWorkspaceMember({ role: "not-a-built-in" });
    mockAuthenticatedSession(malformed.user);
    const { app } = createApp();
    const malformedResponse = await app.request(
      `/api/capabilities?workspaceId=${malformed.workspace.id}`,
    );
    const malformedCaps = (await malformedResponse.json()) as Record<
      string,
      boolean
    >;
    expect(malformedResponse.status).toBe(200);
    expect(malformedCaps.createPublicComments).toBe(false);
    expect(malformedCaps.createInternalComments).toBe(false);

    await addMembership(malformed.user.id, malformed.workspace.id, "member");
    const duplicateResponse = await app.request(
      `/api/capabilities?workspaceId=${malformed.workspace.id}`,
    );
    expect(duplicateResponse.status).toBe(403);
  });

  it("does not let instance-admin reach replace workspace membership", async () => {
    const { workspace } = await createWorkspaceMember();
    const outsider = await createWorkspaceMember();
    mockAuthenticatedSession({ ...outsider.user, role: "admin" });
    const { app } = createApp();

    const response = await app.request(
      `/api/capabilities?workspaceId=${workspace.id}`,
    );
    expect(response.status).toBe(403);
  });

  // The three flags below are computed from the STRICT canonical capabilities
  // (`work_item:transition`, `work_item:rank`, `project:manage_settings`), never from the
  // legacy better-auth statement map (#708: the legacy gate grants more than the matrix).
  // The expectations are written out by hand from rbac.md, not derived from BUILT_IN_ROLES,
  // so a drift in either side fails here.
  const STRICT_FLAGS: Array<
    [
      role: string,
      expected: {
        transitionTasks: boolean;
        rankTasks: boolean;
        manageProjectSettings: boolean;
      },
    ]
  > = [
    [
      "owner",
      { transitionTasks: true, rankTasks: true, manageProjectSettings: true },
    ],
    [
      "admin",
      { transitionTasks: true, rankTasks: true, manageProjectSettings: true },
    ],
    [
      "manager",
      { transitionTasks: true, rankTasks: true, manageProjectSettings: true },
    ],
    [
      "lead",
      { transitionTasks: true, rankTasks: true, manageProjectSettings: false },
    ],
    [
      "member",
      { transitionTasks: true, rankTasks: true, manageProjectSettings: false },
    ],
    [
      "viewer",
      {
        transitionTasks: false,
        rankTasks: false,
        manageProjectSettings: false,
      },
    ],
  ];

  it.each(STRICT_FLAGS)(
    "reports transitionTasks, rankTasks and manageProjectSettings strictly for the %s role",
    async (role, expected) => {
      const actor = await createWorkspaceMember({ role });
      // `createWorkspaceMember` only seeds the viewer/member/admin role rows; the
      // owner needs none, manager and lead need a genuine system row.
      if (role === "manager" || role === "lead") {
        const now = new Date();
        await db.insert(schema.workspaceRoleTable).values({
          workspaceId: actor.workspace.id,
          role,
          permission: JSON.stringify({}),
          isSystem: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      mockAuthenticatedSession(actor.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/capabilities?workspaceId=${actor.workspace.id}`,
      );
      expect(response.status).toBe(200);
      const caps = (await response.json()) as Record<string, unknown>;
      expect({
        transitionTasks: caps.transitionTasks,
        rankTasks: caps.rankTasks,
        manageProjectSettings: caps.manageProjectSettings,
      }).toEqual(expected);
    },
  );

  it("reports false for the customer role's rank and public-comment flags, as the agent routes refuse customers", async () => {
    // The built-in `customer` role holds `work_item:rank` and `comment:create`, but the agent
    // API answers customers 403 on item-scoped routes (permission matrix; rbac.md), so the
    // flags derive from the same predicate those routes use and the UI is not told it may.
    const customer = await createWorkspaceMember({ role: "customer" });
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: customer.workspace.id,
      role: "customer",
      permission: JSON.stringify({}),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
    mockAuthenticatedSession(customer.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/capabilities?workspaceId=${customer.workspace.id}`,
    );
    expect(response.status).toBe(200);
    const caps = (await response.json()) as Record<string, unknown>;
    expect({
      transitionTasks: caps.transitionTasks,
      rankTasks: caps.rankTasks,
      manageProjectSettings: caps.manageProjectSettings,
    }).toEqual({
      transitionTasks: false,
      rankTasks: false,
      manageProjectSettings: false,
    });
    expect(caps.createPublicComments).toBe(false);
  });

  it("never derives the strict flags from a legacy permission map that claims more (#708)", async () => {
    // A viewer whose stored legacy statements claim transition/rank/manage_settings.
    // The canonical built-in `viewer` role holds none of the three, so all stay false.
    const viewer = await createWorkspaceMember({ role: "viewer" });
    await db
      .update(schema.workspaceRoleTable)
      .set({
        permission: JSON.stringify({
          work_item: ["read", "update", "transition", "rank"],
          project: ["read", "update", "manage_settings"],
        }),
      })
      .where(eq(schema.workspaceRoleTable.workspaceId, viewer.workspace.id));
    mockAuthenticatedSession(viewer.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/capabilities?workspaceId=${viewer.workspace.id}`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transitionTasks: false,
      rankTasks: false,
      manageProjectSettings: false,
    });
  });

  it("returns false for all three strict flags to a malformed (non built-in) role", async () => {
    const custom = await createWorkspaceMember({ role: "not-a-built-in" });
    mockAuthenticatedSession(custom.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/capabilities?workspaceId=${custom.workspace.id}`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transitionTasks: false,
      rankTasks: false,
      manageProjectSettings: false,
    });
  });

  it("is session-only: an API key, even a fully scoped owner key, cannot read the capability map", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const rawKey = `taskdesk_test_${randomUUID()}`;
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      referenceId: owner.user.id,
      userId: owner.user.id,
      key: createHash("sha256")
        .update(rawKey)
        .digest()
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
      name: "capabilities scope test",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({
        work_item: ["transition", "rank"],
        project: ["manage_settings"],
      }),
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();

    const response = await app.request(
      `/api/capabilities?workspaceId=${owner.workspace.id}`,
      { headers: { "x-api-key": rawKey } },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it("reports bindProjectOrganisation from the strict project:create capability, not the legacy createProjects", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const admin = await createWorkspaceMember({ role: "admin" });
    const { app } = createApp();

    mockAuthenticatedSession(member.user);
    const memberCaps = (await (
      await app.request(`/api/capabilities?workspaceId=${member.workspace.id}`)
    ).json()) as Record<string, boolean>;
    // The legacy statement lets a member create projects; the strict capability does not.
    expect(memberCaps.createProjects).toBe(true);
    expect(memberCaps.bindProjectOrganisation).toBe(false);

    mockAuthenticatedSession(admin.user);
    const adminCaps = (await (
      await app.request(`/api/capabilities?workspaceId=${admin.workspace.id}`)
    ).json()) as Record<string, boolean>;
    expect(adminCaps.bindProjectOrganisation).toBe(true);
  });

  it("reports exact service-calendar management for an admin", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/capabilities?workspaceId=${admin.workspace.id}`,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).manageServiceCalendars).toBe(true);
  });

  it("denies service-calendar management to a viewer", async () => {
    const viewer = await createWorkspaceMember({ role: "viewer" });
    mockAuthenticatedSession(viewer.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/capabilities?workspaceId=${viewer.workspace.id}`,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).manageServiceCalendars).toBe(false);
  });

  it("reports the canonical saved-view audience capabilities", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const ownerResponse = await app.request(
      `/api/capabilities?workspaceId=${owner.workspace.id}`,
    );
    const ownerCapabilities = await ownerResponse.json();
    expect(ownerCapabilities.shareSavedViews).toBe(true);
    expect(ownerCapabilities.manageWorkspaceSettings).toBe(true);

    const viewer = await createWorkspaceMember({ role: "viewer" });
    mockAuthenticatedSession(viewer.user);
    const viewerResponse = await app.request(
      `/api/capabilities?workspaceId=${viewer.workspace.id}`,
    );
    const viewerCapabilities = await viewerResponse.json();
    expect(viewerCapabilities.shareSavedViews).toBe(false);
    expect(viewerCapabilities.manageWorkspaceSettings).toBe(false);
  });

  it("exposes the per-area settings capabilities the APIs enforce (M9)", async () => {
    const { app } = createApp();
    const read = async (role: "owner" | "manager" | "viewer") => {
      const member = await createWorkspaceMember({ role });
      mockAuthenticatedSession(member.user);
      const response = await app.request(
        `/api/capabilities?workspaceId=${member.workspace.id}`,
      );
      return response.json();
    };
    const owner = await read("owner");
    expect([
      owner.manageRoles,
      owner.manageWebhooks,
      owner.manageCustomFields,
    ]).toEqual([true, true, true]);
    // A manager manages webhooks and custom fields, but not role definitions.
    const manager = await read("manager");
    expect([
      manager.manageRoles,
      manager.manageWebhooks,
      manager.manageCustomFields,
    ]).toEqual([false, true, true]);
    const viewer = await read("viewer");
    expect([
      viewer.manageRoles,
      viewer.manageWebhooks,
      viewer.manageCustomFields,
    ]).toEqual([false, false, false]);
    // P5 entries follow their own API capability: manage_rates (finance/admin), workflow:manage
    // and budget:read (a viewer reads budgets, but never manages rates or workflows).
    expect([
      owner.manageRates,
      owner.manageWorkflows,
      owner.readBudgets,
    ]).toEqual([true, true, true]);
    expect([
      viewer.manageRates,
      viewer.manageWorkflows,
      typeof viewer.readBudgets,
    ]).toEqual([false, false, "boolean"]);
  });

  it("scopes to the requested workspace -- same user, different roles in two workspaces, different answers (A1-P4)", async () => {
    const owner = await createWorkspaceMember({
      workspaceName: "Workspace Owner-side",
      role: "owner",
    });
    const { user } = owner;
    const viewerSide = await createWorkspaceMember({
      workspaceName: "Workspace Viewer-side",
      role: "owner",
    });
    // Same user, ALSO a viewer in the second workspace.
    await addMembership(user.id, viewerSide.workspace.id, "viewer");

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const asOwner = await app.request(
      `/api/capabilities?workspaceId=${owner.workspace.id}`,
    );
    const asViewer = await app.request(
      `/api/capabilities?workspaceId=${viewerSide.workspace.id}`,
    );
    expect(asOwner.status).toBe(200);
    expect(asViewer.status).toBe(200);

    const ownerCaps = (await asOwner.json()) as Record<string, boolean>;
    const viewerCaps = (await asViewer.json()) as Record<string, boolean>;

    expect(ownerCaps.deleteWorkspace).toBe(true);
    expect(viewerCaps.deleteWorkspace).toBe(false);
    expect(ownerCaps).not.toEqual(viewerCaps);
  });

  it("refuses a caller who is not a member of the requested workspace", async () => {
    const { workspace } = await createWorkspaceMember();
    const outsider = await createWorkspaceMember();

    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const response = await app.request(
      `/api/capabilities?workspaceId=${workspace.id}`,
    );
    expect(response.status).toBe(403);
  });

  it("400s when no workspace is specified", async () => {
    const { user } = await createWorkspaceMember();
    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request("/api/capabilities");
    expect(response.status).toBe(400);
  });

  it("has no residual randomness -- a random unrelated workspace id string never resolves", async () => {
    const { user } = await createWorkspaceMember();
    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(
      `/api/capabilities?workspaceId=${randomUUID()}`,
    );
    expect(response.status).toBe(403);
  });
});

describe("project-scoped work capability introspection", () => {
  it("uses the project override and never reuses another project's flags", async () => {
    const actor = await createWorkspaceMember({ role: "owner" });
    const first = await createProjectFixture({
      workspaceId: actor.workspace.id,
    });
    const second = await createProjectFixture({
      workspaceId: actor.workspace.id,
    });
    const person = await db.query.personTable.findFirst({
      where: eq(schema.personTable.userId, actor.user.id),
    });
    expect(person).toBeDefined();
    for (const [project, caps] of [
      [first.project, ["project:read", "work_item:read", "comment:create"]],
      [second.project, ["project:read", "work_item:read", "work_item:update"]],
    ] as const) {
      const roleId = randomUUID();
      await db.insert(schema.roleTable).values({
        id: roleId,
        key: roleId,
        name: "Scoped test",
        rank: 1,
        scope: "project",
        workspaceId: actor.workspace.id,
        capabilities: [...caps],
      });
      await db.insert(schema.membershipTable).values({
        id: randomUUID(),
        personId: person?.id ?? "missing-person",
        scope: "project",
        scopeId: project.id,
        roleId,
      });
    }
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();
    const workspace = await app.request(
      `/api/capabilities?workspaceId=${actor.workspace.id}`,
    );
    expect(workspace.status).toBe(200);
    expect((await workspace.json()).updateTasks).toBe(true);
    const readOnly = await app.request(
      `/api/capabilities?workspaceId=${actor.workspace.id}&projectId=${first.project.id}`,
    );
    expect(readOnly.status).toBe(200);
    expect(await readOnly.json()).toMatchObject({
      updateTasks: false,
      assignTasks: false,
      setPriorityTasks: false,
      createPublicComments: true,
    });
    const editable = await app.request(
      `/api/capabilities?workspaceId=${actor.workspace.id}&projectId=${second.project.id}`,
    );
    expect(editable.status).toBe(200);
    expect(await editable.json()).toMatchObject({
      updateTasks: true,
      assignTasks: false,
      setPriorityTasks: false,
    });
  });

  it("a custom workspace role's capabilities (the canonical role row) are the strict authority, and a project role still decides inside its project", async () => {
    const actor = await createWorkspaceMember({ role: "custom-editor" });
    // Owner decision, 23 Oct: a custom role's capabilities live in the canonical `role` row.
    await upsertWorkspaceRoleRows(actor.workspace.id, "custom-editor", {
      work_item: ["read", "update"],
    });
    const { project } = await createProjectFixture({
      workspaceId: actor.workspace.id,
    });
    const person = await db.query.personTable.findFirst({
      where: eq(schema.personTable.userId, actor.user.id),
    });
    expect(person).toBeDefined();
    const roleId = randomUUID();
    await db.insert(schema.roleTable).values({
      id: roleId,
      key: roleId,
      name: "Project editor",
      rank: 1,
      scope: "project",
      workspaceId: actor.workspace.id,
      capabilities: ["project:read", "work_item:read", "work_item:update"],
    });
    await db.insert(schema.membershipTable).values({
      id: randomUUID(),
      personId: person?.id ?? "missing-person",
      scope: "project",
      scopeId: project.id,
      roleId,
    });
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();
    const legacy = await app.request(
      `/api/capabilities?workspaceId=${actor.workspace.id}`,
    );
    expect((await legacy.json()).updateTasks).toBe(true);
    const scoped = await app.request(
      `/api/capabilities?workspaceId=${actor.workspace.id}&projectId=${project.id}`,
    );
    expect(scoped.status).toBe(200);
    expect((await scoped.json()).updateTasks).toBe(true);
  });

  it("makes missing, deleted and other-workspace projects indistinguishable", async () => {
    const actor = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember({ role: "owner" });
    const cross = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const deleted = await createProjectFixture({
      workspaceId: actor.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, deleted.project.id));
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();
    for (const id of [
      "missing-project",
      cross.project.id,
      deleted.project.id,
    ]) {
      const response = await app.request(
        `/api/capabilities?workspaceId=${actor.workspace.id}&projectId=${id}`,
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Project not found");
    }
  });
});
