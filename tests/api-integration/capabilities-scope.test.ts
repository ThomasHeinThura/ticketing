import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { CAPABILITY_CHECKS } from "../../apps/api/src/capabilities/capability-checks";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

// Pinned literally against apps/web/src/hooks/use-workspace-permission.ts's
// own (private, unexported, hand-copied here once and verified) CAPABILITIES
// map. A1-P5's equivalence tests re-derive their "expected" answer from
// CAPABILITY_CHECKS itself, so they cannot catch a capability being pointed
// at the WRONG permission (both sides of that comparison would move
// together). This is the test that actually catches that: an edit to
// capability-checks.ts that changes what any of the 16 keys checks, without
// updating the client to match, fails here first.
const EXPECTED_CAPABILITY_CHECKS: Record<string, Record<string, string[]>> = {
  manageProjects: { project: ["create", "update", "delete"] },
  createProjects: { project: ["create"] },
  updateProjects: { project: ["update"] },
  deleteProjects: { project: ["delete"] },
  updateTasks: { task: ["update"] },
  createTasks: { task: ["create"] },
  deleteTasks: { task: ["delete"] },
  assignTasks: { task: ["assign"] },
  createLabels: { label: ["create"] },
  updateLabels: { label: ["update"] },
  deleteLabels: { label: ["delete"] },
  manageWorkspace: { workspace: ["update", "manage_settings"] },
  deleteWorkspace: { workspace: ["delete"] },
  inviteUsers: { invitation: ["create"] },
  manageTeam: { member: ["update", "delete"] },
  removeMembers: { member: ["delete"] },
};

// GET /api/capabilities -- one call replacing the client's 16-way
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
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("the 16-key capability vocabulary matches the client's fan-out exactly (A1-P5)", () => {
  it("checks the exact same permission map per key as apps/web/src/hooks/use-workspace-permission.ts", () => {
    expect(CAPABILITY_CHECKS).toEqual(EXPECTED_CAPABILITY_CHECKS);
  });
});

describe("GET /api/capabilities", () => {
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
