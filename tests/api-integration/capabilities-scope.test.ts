import { createHash, randomUUID } from "node:crypto";
import { defaultRolePayloads } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CAPABILITY_CHECKS } from "../../apps/api/src/capabilities/capability-checks";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

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

  it("pins the customer role's strict flags as computed today: rankTasks true, transition and settings false", async () => {
    // Pins TODAY's value, not the intended contract. The built-in `customer` role holds
    // `work_item:rank` (rbac.md role table) but neither `work_item:transition` nor
    // `project:manage_settings`, so the strict check reports rankTasks true. This matches
    // the rank route's current runtime, which does NOT yet enforce rbac.md's "own backlog"
    // limit (WI-13) and lets a customer-role member rank without project reach; the
    // permission matrix declares customer -> 403 on POST /api/work-items/{key}/rank.
    // When the work-item write-route reach fix lands, derive this flag from the same
    // predicate the fixed route uses and update this row.
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
      rankTasks: true,
      manageProjectSettings: false,
    });
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
