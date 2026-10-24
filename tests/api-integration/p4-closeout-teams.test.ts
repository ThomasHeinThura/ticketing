/**
 * TM-4 / TM-7 / TM-8: `project.owner_team_id` is reach step 5 (reach only), a team that owns a
 * project cannot be deleted, and deactivating a person takes them off every team's lead roster
 * and leaves no team-derived reach or authority behind.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { transitionPersonLifecycleInTransaction } from "../../apps/api/src/identity/repository";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { deletionBlockers } from "../../apps/api/src/team/repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";
import { makeTeam, workItemWorld } from "./helpers/p4-closeout";
import { addMember } from "./helpers/reach-world";

async function world() {
  const manager = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: manager.workspace.id,
  });
  await grantProjectRole(manager.user.id, project.id, [
    "project:read",
    "project:manage_members",
    "work_item:read",
  ]);
  const rows = await workItemWorld(manager.workspace.id, project.id);
  const item = await rows.makeItem("Owned by a team");
  const teammate = await addMember(manager.workspace.id, "member");
  const outsider = await addMember(manager.workspace.id, "member");
  const team = await makeTeam(manager.workspace.id, [teammate.user.id], {
    leadUserId: teammate.user.id,
  });
  const { app } = createApp();
  return { manager, project, item, teammate, outsider, team, app };
}

function ownership(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: unknown,
) {
  return app.request(`/api/projects/${projectId}/ownership`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function search(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
) {
  const response = await app.request("/api/work-items/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, query: { entity: "work_item" } }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { data: { id: string }[] };
}

describe("TM-4 owner_team_id is reach step 5", () => {
  beforeEach(async () => resetTestDatabase());

  it("lets an active team member reach the owned project, and only after the manager sets it", async () => {
    const w = await world();
    // Before: a plain workspace member with no project row reaches nothing.
    mockAuthenticatedSession(w.teammate.user);
    expect((await search(w.app, w.manager.workspace.id)).data).toHaveLength(0);
    const hidden = await w.app.request(`/api/work-items/${w.item.key}`);
    expect(hidden.status).toBe(404);

    // The project manager (project:manage_members) sets the owning team.
    mockAuthenticatedSession(w.manager.user);
    const set = await ownership(w.app, w.project.id, {
      ownerTeamId: w.team.id,
    });
    expect(set.status, await set.clone().text()).toBe(200);
    expect(((await set.json()) as { ownerTeamId: string }).ownerTeamId).toBe(
      w.team.id,
    );

    // After: the team member reaches the project through search and by key; an outsider does not.
    mockAuthenticatedSession(w.teammate.user);
    const found = await search(w.app, w.manager.workspace.id);
    expect(found.data.map((row) => row.id)).toEqual([w.item.id]);
    const visible = await w.app.request(`/api/work-items/${w.item.key}`);
    expect(visible.status).toBe(200);
    mockAuthenticatedSession(w.outsider.user);
    expect((await search(w.app, w.manager.workspace.id)).data).toHaveLength(0);
    expect((await w.app.request(`/api/work-items/${w.item.key}`)).status).toBe(
      404,
    );

    // The whole reach surface follows: project list, per-project item list, global search.
    mockAuthenticatedSession(w.teammate.user);
    const projects = await w.app.request(
      `/api/project?workspaceId=${w.manager.workspace.id}`,
    );
    expect(projects.status, await projects.clone().text()).toBe(200);
    expect(JSON.stringify(await projects.json())).toContain(w.project.id);
    const perProject = await w.app.request(
      `/api/projects/${w.project.id}/work-items`,
    );
    expect(perProject.status, await perProject.clone().text()).toBe(200);
    expect(JSON.stringify(await perProject.json())).toContain(w.item.id);
    const global = await w.app.request(
      `/api/search?q=Owned&workspaceId=${w.manager.workspace.id}`,
    );
    expect(global.status, await global.clone().text()).toBe(200);
    expect(JSON.stringify(await global.json())).toContain(w.item.id);

    // Reach only: the team grants no capability the teammate lacked.
    const identity = await resolveIdentity({
      userId: w.teammate.user.id,
      credential: "session",
    });
    expect(identity?.teamIds).toEqual([w.team.id]);
    expect(identity?.authority.some((grant) => grant.scope === "project")).toBe(
      false,
    );

    // Audited as a reach change, naming the team's current active members.
    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "project.reach_changed"),
          eq(schema.auditLogTable.entityId, w.project.id),
        ),
      );
    expect(audit?.after).toMatchObject({
      ownerTeamId: w.team.id,
      ownerTeamMemberPersonIds: [w.teammate.personId],
    });

    // Clearing the team removes the reach again.
    mockAuthenticatedSession(w.manager.user);
    expect(
      (await ownership(w.app, w.project.id, { ownerTeamId: null })).status,
    ).toBe(200);
    mockAuthenticatedSession(w.teammate.user);
    expect((await search(w.app, w.manager.workspace.id)).data).toHaveLength(0);
  });

  it("needs project:manage_members and a team of the project's workspace", async () => {
    const w = await world();
    // A caller holding only project:read is refused.
    mockAuthenticatedSession(w.teammate.user);
    const refused = await ownership(w.app, w.project.id, {
      ownerTeamId: w.team.id,
    });
    expect([403, 404]).toContain(refused.status);

    // A team of another workspace is refused with 422, never silently attached.
    const foreign = await createWorkspaceMember({ role: "owner" });
    const foreignTeam = await makeTeam(foreign.workspace.id, []);
    mockAuthenticatedSession(w.manager.user);
    const wrong = await ownership(w.app, w.project.id, {
      ownerTeamId: foreignTeam.id,
    });
    expect(wrong.status, await wrong.clone().text()).toBe(422);
    const empty = await ownership(w.app, w.project.id, {});
    expect(empty.status).toBe(400);
  });
});

describe("TM-7 a team that owns a project cannot be deleted", () => {
  beforeEach(async () => resetTestDatabase());

  it("counts an owned project (even a soft-deleted one) as a blocker", async () => {
    const w = await world();
    expect(await deletionBlockers(db, w.team)).toEqual([]);
    await db
      .update(schema.projectTable)
      .set({ ownerTeamId: w.team.id })
      .where(eq(schema.projectTable.id, w.project.id));
    expect((await deletionBlockers(db, w.team)).join(" ")).toMatch(
      /owns 1 project/,
    );
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, w.project.id));
    expect((await deletionBlockers(db, w.team)).join(" ")).toMatch(
      /owns 1 project/,
    );
    // The foreign key backs the rule: the row delete itself is refused.
    await expect(
      db.delete(schema.teamTable).where(eq(schema.teamTable.id, w.team.id)),
    ).rejects.toThrow();
  });

  it("does not stand in the way of deleting the whole workspace (team and projects cascade together)", async () => {
    const w = await world();
    await db
      .update(schema.projectTable)
      .set({ ownerTeamId: w.team.id })
      .where(eq(schema.projectTable.id, w.project.id));
    // Fixture roles are RESTRICT-referenced by memberships; the real workspace purge removes
    // those first, so do the same and leave exactly the team/project pair for the FK to judge.
    await db.delete(schema.membershipTable);
    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, w.manager.workspace.id));
    expect(
      await db
        .select({ id: schema.teamTable.id })
        .from(schema.teamTable)
        .where(eq(schema.teamTable.id, w.team.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, w.project.id)),
    ).toHaveLength(0);
  });
});

describe("TM-8 deactivation removes team-derived standing", () => {
  beforeEach(async () => resetTestDatabase());

  it("demotes a lead, keeps history, and leaves no owner-team reach", async () => {
    const w = await world();
    await db
      .update(schema.projectTable)
      .set({ ownerTeamId: w.team.id })
      .where(eq(schema.projectTable.id, w.project.id));
    const before = await resolveIdentity({
      userId: w.teammate.user.id,
      credential: "session",
    });
    expect(before?.teamIds).toEqual([w.team.id]);

    await db.transaction(async (tx) => {
      const result = await transitionPersonLifecycleInTransaction(
        tx,
        w.teammate.personId,
        false,
        "end_memberships",
        { kind: "administrative" },
      );
      expect(result).toBeTruthy();
    });

    // History stays; the lead flag does not survive, so reactivation never restores it.
    const [row] = await db
      .select()
      .from(schema.teamMemberTable)
      .where(eq(schema.teamMemberTable.userId, w.teammate.user.id));
    expect(row).toBeDefined();
    expect(row?.isLead).toBe(false);
    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "team.member_updated"),
          eq(schema.auditLogTable.entityId, w.team.id),
        ),
      );
    expect(audit?.after).toMatchObject({
      personId: w.teammate.personId,
      isLead: false,
      reason: "person_deactivated",
    });

    // A deactivated person resolves to no identity at all: no team reach, no authority.
    expect(
      await resolveIdentity({
        userId: w.teammate.user.id,
        credential: "session",
      }),
    ).toBeNull();
  });
});
