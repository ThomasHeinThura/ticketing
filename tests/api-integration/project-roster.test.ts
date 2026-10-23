/**
 * P1 PR-2..PR-4 project roster API (WRITTEN, NOT RUN by its author -- the coordinator runs DB
 * integration tests):
 *   GET/POST /api/projects/{id}/members, PATCH/DELETE /api/projects/{id}/members/{personId},
 *   GET /api/projects/{id}/members/candidates, GET /api/projects/{id}/ownership/preview.
 *
 * The write path reuses the direct `membership_grant` model of the project-creator lead and
 * `projectMembershipKeys`; inherited rows are computed at read time and never written.
 */
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { setProjectParent } from "../../apps/api/src/project/hierarchy.repository";
import { resolveAssigneeEligibility } from "../../apps/api/src/work-item/assignee-eligibility";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";
import { projectKey } from "./helpers/project-key";
import { addMember, json } from "./helpers/reach-world";

type RosterEntry = {
  personId: string;
  roleKey: string;
  source: "direct" | "inherited";
  inheritedFrom: { projectId: string; projectName: string } | null;
  overridesInherited: { roleKey: string } | null;
  removable: boolean;
};

/**
 * A workspace admin has no project reach on its own (reach is a project membership or a
 * workspace sees_all grant), so the acting admin is made a project lead on each project. The
 * fixture role is bumped to the built-in lead rank (50): the roster refuses to grant a role
 * above the caller's own rank, and `project-member` is rank 40.
 */
async function makeLead(userId: string, projectId: string) {
  const role = await grantProjectRole(userId, projectId, [
    "project:read",
    "project:manage_members",
  ]);
  await db
    .update(schema.roleTable)
    .set({ rank: 50 })
    .where(eq(schema.roleTable.id, role.id));
}

async function world() {
  const admin = await createWorkspaceMember({ role: "admin" });
  const workspaceId = admin.workspace.id;
  const make = async () =>
    (await createProjectFixture({ workspaceId, slug: projectKey() })).project;
  const parent = await make();
  const child = await make();
  const other = await make();
  await setProjectParent(db, child.id, parent.id);
  for (const project of [parent, child, other]) {
    await makeLead(admin.user.id, project.id);
  }
  const { app } = createApp();
  mockAuthenticatedSession(admin.user);
  return { admin, workspaceId, parent, child, other, app };
}

async function roster(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
) {
  const response = await json(app, "GET", `/api/projects/${projectId}/members`);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as {
    members: RosterEntry[];
    roles: Array<{ roleKey: string }>;
    callerRank: number;
  };
}

describe("API integration: project roster (PR-2..PR-4)", () => {
  beforeEach(async () => resetTestDatabase());

  // UNRUN (DB integration): the roster carries the caller's rank for the role Select filter.
  it("returns the caller's project rank (the write ceiling) on the roster", async () => {
    const w = await world();
    const { callerRank, roles } = await roster(w.app, w.parent.id);
    expect(callerRank).toBeGreaterThan(0);
    expect(Number.isInteger(callerRank)).toBe(true);
    expect(roles.length).toBeGreaterThan(0);
  });

  it("adds a workspace person with a project role; they become assignable (AS-5) and audited", async () => {
    const w = await world();
    const person = await addMember(w.workspaceId, "member");

    const response = await json(
      w.app,
      "POST",
      `/api/projects/${w.parent.id}/members`,
      { personId: person.personId, roleKey: "project-member" },
    );
    expect(response.status, await response.clone().text()).toBe(200);

    const { members } = await roster(w.app, w.parent.id);
    expect(members.find((m) => m.personId === person.personId)).toMatchObject({
      roleKey: "project-member",
      source: "direct",
      removable: true,
    });
    expect(
      (await resolveAssigneeEligibility(db, w.parent.id, person.personId))
        .eligible,
    ).toBe(true);
    const grant = await db
      .select()
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(schema.membershipGrantTable.personId, person.personId),
          eq(schema.membershipGrantTable.scopeId, w.parent.id),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    expect(grant).toHaveLength(1);
    expect(grant[0]).toMatchObject({
      sourceKind: "direct",
      directOrigin: "admin",
    });
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, person.personId));
    expect(audit.some((row) => row.action === "membership.changed")).toBe(true);

    // A second add is a conflict, not a silent role change.
    const again = await json(
      w.app,
      "POST",
      `/api/projects/${w.parent.id}/members`,
      { personId: person.personId, roleKey: "project-viewer" },
    );
    expect(again.status).toBe(409);
  });

  it("refuses someone who is not an active staff member of the workspace (422)", async () => {
    const w = await world();
    const stranger = await createWorkspaceMember({ role: "member" });
    const [strangerPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, stranger.user.id));
    const response = await json(
      w.app,
      "POST",
      `/api/projects/${w.parent.id}/members`,
      { personId: strangerPerson?.id, roleKey: "project-member" },
    );
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("person_not_eligible");
  });

  it("shows ancestor members as inherited rows naming the parent; removal on the child is 409 inherited_membership with the parent id (PR-4)", async () => {
    const w = await world();
    const person = await addMember(w.workspaceId, "member");
    await json(w.app, "POST", `/api/projects/${w.parent.id}/members`, {
      personId: person.personId,
      roleKey: "project-member",
    });

    const { members } = await roster(w.app, w.child.id);
    expect(members.find((m) => m.personId === person.personId)).toMatchObject({
      source: "inherited",
      removable: false,
      inheritedFrom: { projectId: w.parent.id },
    });

    const removal = await json(
      w.app,
      "DELETE",
      `/api/projects/${w.child.id}/members/${person.personId}`,
    );
    expect(removal.status).toBe(409);
    const text = await removal.text();
    expect(text).toContain("inherited_membership");
    expect(text).toContain(w.parent.id);
    // Removing at the parent works and takes the inherited row away from the child too.
    const atParent = await json(
      w.app,
      "DELETE",
      `/api/projects/${w.parent.id}/members/${person.personId}`,
    );
    expect(atParent.status, await atParent.clone().text()).toBe(200);
    expect(
      (await roster(w.app, w.child.id)).members.some(
        (m) => m.personId === person.personId,
      ),
    ).toBe(false);
  });

  it("a role change on an inherited member writes the explicit child override (PR-3); removing it restores the inherited role", async () => {
    const w = await world();
    const person = await addMember(w.workspaceId, "member");
    await json(w.app, "POST", `/api/projects/${w.parent.id}/members`, {
      personId: person.personId,
      roleKey: "project-viewer",
    });

    const patch = await json(
      w.app,
      "PATCH",
      `/api/projects/${w.child.id}/members/${person.personId}`,
      { roleKey: "project-member" },
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const overridden = (await roster(w.app, w.child.id)).members.find(
      (m) => m.personId === person.personId,
    );
    expect(overridden).toMatchObject({
      source: "direct",
      roleKey: "project-member",
      inheritedFrom: { projectId: w.parent.id },
      overridesInherited: { roleKey: "project-viewer" },
    });
    // The parent row is untouched.
    expect(
      (await roster(w.app, w.parent.id)).members.find(
        (m) => m.personId === person.personId,
      )?.roleKey,
    ).toBe("project-viewer");

    const removeOverride = await json(
      w.app,
      "DELETE",
      `/api/projects/${w.child.id}/members/${person.personId}`,
    );
    expect(removeOverride.status, await removeOverride.clone().text()).toBe(
      200,
    );
    expect(
      (await roster(w.app, w.child.id)).members.find(
        (m) => m.personId === person.personId,
      ),
    ).toMatchObject({ source: "inherited", roleKey: "project-viewer" });
  });

  it("a caller cannot grant a role above their own rank (403), and an outsider gets 404", async () => {
    const w = await world();
    const caller = await addMember(w.workspaceId, "member");
    // Fixture role: rank 1, but it holds project:manage_members and project:read.
    await grantProjectRole(caller.user.id, w.parent.id, [
      "project:read",
      "project:manage_members",
    ]);
    const target = await addMember(w.workspaceId, "member");
    mockAuthenticatedSession(caller.user);
    const response = await json(
      w.app,
      "POST",
      `/api/projects/${w.parent.id}/members`,
      { personId: target.personId, roleKey: "project-lead" },
    );
    expect(response.status, await response.clone().text()).toBe(403);
    expect(await response.text()).toContain("role_exceeds_caller_authority");

    const outsider = await addMember(w.workspaceId, "member");
    mockAuthenticatedSession(outsider.user);
    expect(
      (await json(w.app, "GET", `/api/projects/${w.parent.id}/members`)).status,
    ).toBe(404);
  });

  it("lists the workspace people who can still be added", async () => {
    const w = await world();
    const person = await addMember(w.workspaceId, "member");
    const before = await json(
      w.app,
      "GET",
      `/api/projects/${w.parent.id}/members/candidates`,
    );
    expect(before.status).toBe(200);
    const candidates = (await before.json()) as Array<{ personId: string }>;
    expect(candidates.some((c) => c.personId === person.personId)).toBe(true);

    await json(w.app, "POST", `/api/projects/${w.parent.id}/members`, {
      personId: person.personId,
      roleKey: "project-member",
    });
    const after = (await (
      await json(
        w.app,
        "GET",
        `/api/projects/${w.parent.id}/members/candidates`,
      )
    ).json()) as Array<{ personId: string }>;
    expect(after.some((c) => c.personId === person.personId)).toBe(false);
  });

  it("previews who gains and loses access if the project is re-parented, writing nothing", async () => {
    const w = await world();
    const parentMember = await addMember(w.workspaceId, "member");
    const otherMember = await addMember(w.workspaceId, "member");
    await json(w.app, "POST", `/api/projects/${w.parent.id}/members`, {
      personId: parentMember.personId,
      roleKey: "project-member",
    });
    await json(w.app, "POST", `/api/projects/${w.other.id}/members`, {
      personId: otherMember.personId,
      roleKey: "project-member",
    });

    const response = await json(
      w.app,
      "GET",
      `/api/projects/${w.child.id}/ownership/preview?parentId=${w.other.id}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const preview = (await response.json()) as {
      refusal: string | null;
      gains: Array<{ personId: string; via: { projectId: string } }>;
      losses: Array<{ personId: string }>;
    };
    expect(preview.refusal).toBeNull();
    expect(preview.gains.map((g) => g.personId)).toContain(
      otherMember.personId,
    );
    expect(preview.losses.map((l) => l.personId)).toContain(
      parentMember.personId,
    );

    const [still] = await db
      .select({ parentId: schema.projectTable.parentId })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, w.child.id));
    expect(still?.parentId).toBe(w.parent.id);
  });
});
