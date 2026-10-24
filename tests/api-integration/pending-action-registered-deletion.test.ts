import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { automationTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { approveRegisteredDeletion } from "../../apps/api/src/pending-action/deletion-targets";
import { decideOwnPendingAction } from "../../apps/api/src/pending-action/service";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  requireRow,
} from "./helpers/fixtures";
import { upsertWorkspaceRoleRows } from "./helpers/workspace-role-rows";

/**
 * P0 deletion audit: the legacy click-confirmed deletes (column, canned response, milestone,
 * prerequisite, document link, workspace label, project label, workspace role, invitation
 * cancel) return 202 and leave the row intact until the requester's approval executes them
 * through the generic click-deletion executor. Mirrors pending-action-comment-deletion.test.ts.
 */

async function fixture() {
  const member = await createWorkspaceMember({ role: "owner" });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantProjectManageAccess(member.user.id, project.id);
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id)),
    "requester",
  );
  const session = requireRow(
    await db
      .insert(schema.sessionTable)
      .values({
        id: `session-${member.user.id}`,
        token: randomUUID(),
        userId: member.user.id,
        portal: "agent",
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning(),
    "session",
  );
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  const request = async (path: string) => {
    const response = await app.request(path, { method: "DELETE" });
    expect(response.status, await response.clone().text()).toBe(202);
    return (await response.json()) as {
      pendingActionId: string;
      confirmation: string;
      summary: Record<string, unknown>;
    };
  };
  const approve = async (pendingActionId: string) => {
    const response = await app.request(
      `/api/me/pending-actions/${pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
  };
  const approval = (id: string) => ({
    id,
    requesterPersonId: person.id,
    userId: member.user.id,
    sessionId: session.id,
    traceId: randomUUID(),
  });
  return {
    member,
    project,
    columns,
    person,
    session,
    app,
    request,
    approve,
    approval,
  };
}

async function pending(id: string) {
  return requireRow(
    await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, id)),
    "pending action",
  );
}

describe("registered legacy click deletions", () => {
  beforeEach(() => resetTestDatabase());

  it("column: 202 keeps the column; approval deletes it", async () => {
    const f = await fixture();
    const action = await f.request(`/api/column/${f.columns.inReview.id}`);
    expect(action.confirmation).toBe("click");
    const rows = () =>
      db
        .select()
        .from(schema.columnTable)
        .where(eq(schema.columnTable.id, f.columns.inReview.id));
    expect(await rows()).toHaveLength(1);
    await f.approve(action.pendingActionId);
    expect(await rows()).toHaveLength(0);
    expect((await pending(action.pendingActionId)).state).toBe("executed");
  });

  it("column holding tasks is refused at request time and nothing is recorded", async () => {
    const f = await fixture();
    await db.insert(schema.taskTable).values({
      projectId: f.project.id,
      columnId: f.columns.todo.id,
      title: "Blocking task",
    });
    const response = await f.app.request(`/api/column/${f.columns.todo.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(409);
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
  });

  it("canned response: renamed after request invalidates and is never deleted", async () => {
    const f = await fixture();
    const canned = requireRow(
      await db
        .insert(schema.cannedResponseTable)
        .values({
          workspaceId: f.member.workspace.id,
          name: "Greeting",
          body: { type: "doc", content: [] },
        })
        .returning(),
      "canned",
    );
    const action = await f.request(`/api/canned-responses/${canned.id}`);
    await db
      .update(schema.cannedResponseTable)
      .set({ name: "Greeting v2" })
      .where(eq(schema.cannedResponseTable.id, canned.id));
    await expect(
      approveRegisteredDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await pending(action.pendingActionId)).invalidationReason).toBe(
      "version_changed",
    );
    expect(
      await db
        .select()
        .from(schema.cannedResponseTable)
        .where(eq(schema.cannedResponseTable.id, canned.id)),
    ).toHaveLength(1);
  });

  it("milestone: executes once under concurrent approval", async () => {
    const f = await fixture();
    const milestone = requireRow(
      await db
        .insert(schema.milestoneTable)
        .values({ projectId: f.project.id, name: "Go-live", date: new Date() })
        .returning(),
      "milestone",
    );
    const action = await f.request(
      `/api/project/${f.project.id}/milestones/${milestone.id}`,
    );
    const outcomes = await Promise.allSettled([
      approveRegisteredDeletion(f.approval(action.pendingActionId)),
      approveRegisteredDeletion(f.approval(action.pendingActionId)),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.milestoneTable)
        .where(eq(schema.milestoneTable.id, milestone.id)),
    ).toHaveLength(0);
  });

  it("milestone addressed through another project's path is not found", async () => {
    const f = await fixture();
    const other = await createProjectFixture({
      workspaceId: f.member.workspace.id,
    });
    await grantProjectManageAccess(f.member.user.id, other.project.id);
    const milestone = requireRow(
      await db
        .insert(schema.milestoneTable)
        .values({ projectId: f.project.id, name: "Go-live", date: new Date() })
        .returning(),
      "milestone",
    );
    const response = await f.app.request(
      `/api/project/${other.project.id}/milestones/${milestone.id}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(404);
  });

  it("workspace label: cancellation preserves the label", async () => {
    const f = await fixture();
    const label = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: f.member.workspace.id,
          name: "urgent",
          color: "#ff0000",
        })
        .returning(),
      "label",
    );
    const action = await f.request(`/api/label/${label.id}`);
    await decideOwnPendingAction({
      id: action.pendingActionId,
      requesterPersonId: f.person.id,
      outcome: "cancelled",
      sessionId: f.session.id,
    });
    await expect(
      approveRegisteredDeletion(f.approval(action.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await db
        .select()
        .from(schema.labelTable)
        .where(eq(schema.labelTable.id, label.id)),
    ).toHaveLength(1);
  });

  it("invitation cancel: 202 keeps it pending; approval cancels it", async () => {
    const f = await fixture();
    const invitation = requireRow(
      await db
        .insert(schema.invitationTable)
        .values({
          workspaceId: f.member.workspace.id,
          email: `invitee-${randomUUID()}@example.com`,
          role: "member",
          expiresAt: new Date(Date.now() + 86_400_000),
          inviterId: f.member.user.id,
        })
        .returning(),
      "invitation",
    );
    const action = await f.request(`/api/invitation/${invitation.id}`);
    const status = async () =>
      requireRow(
        await db
          .select({ status: schema.invitationTable.status })
          .from(schema.invitationTable)
          .where(eq(schema.invitationTable.id, invitation.id)),
        "invitation",
      ).status;
    expect(await status()).toBe("pending");
    await f.approve(action.pendingActionId);
    expect(await status()).toBe("canceled");
  });

  it("workspace role: an unassigned custom role is deleted only on approval", async () => {
    const f = await fixture();
    // Owner decision, 23 Oct: the canonical `role` row is the role; the legacy row (same id) is
    // deleted with it.
    const role = await upsertWorkspaceRoleRows(
      f.member.workspace.id,
      "auditor",
      { project: ["read"] },
    );
    const action = await f.request(
      `/api/workspace/${f.member.workspace.id}/roles/${role.id}`,
    );
    const rows = async () => [
      ...(await db
        .select()
        .from(schema.roleTable)
        .where(eq(schema.roleTable.id, role.id))),
      ...(await db
        .select()
        .from(schema.workspaceRoleTable)
        .where(eq(schema.workspaceRoleTable.id, role.id))),
    ];
    expect(await rows()).toHaveLength(2);
    await f.approve(action.pendingActionId);
    expect(await rows()).toHaveLength(0);
  });
  it("team: 202 keeps the team; approval deletes it (TM-7 contract entry)", async () => {
    const f = await fixture();
    const now = new Date();
    const team = requireRow(
      await db
        .insert(schema.teamTable)
        .values({
          id: `team-${randomUUID()}`,
          name: "Service desk",
          workspaceId: f.member.workspace.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "team",
    );
    const action = await f.request(`/api/teams/${team.id}`);
    expect(action.confirmation).toBe("click");
    const rows = () =>
      db
        .select()
        .from(schema.teamTable)
        .where(eq(schema.teamTable.id, team.id));
    expect(await rows()).toHaveLength(1);
    await f.approve(action.pendingActionId);
    expect(await rows()).toHaveLength(0);
  });

  it("automation: 202 keeps the rule and its history; approval deletes both and audits", async () => {
    const f = await fixture();
    const role = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: f.member.workspace.id,
          key: `automation-agent-${randomUUID()}`,
          name: "Automation agent",
          rank: 50,
          capabilities: ["work_item:read"],
        })
        .returning(),
      "role",
    );
    const rule = requireRow(
      await db
        .insert(automationTable)
        .values({
          workspaceId: f.member.workspace.id,
          name: "Tidy up",
          trigger: "work_item.created",
          effectiveRoleId: role.id,
          createdBy: f.person.id,
        })
        .returning(),
      "automation",
    );
    const action = await f.request(`/api/automations/${rule.id}`);
    expect(action.confirmation).toBe("click");
    const rows = () =>
      db.select().from(automationTable).where(eq(automationTable.id, rule.id));
    expect(await rows()).toHaveLength(1);
    await f.approve(action.pendingActionId);
    expect(await rows()).toHaveLength(0);
    expect((await pending(action.pendingActionId)).state).toBe("executed");
    const audit = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, rule.id));
    expect(audit.map((row) => row.action)).toContain("automation.deleted");
  });
  it("automation: a project manager without workspace settings deletes their project's rule, not a workspace rule (AM-*)", async () => {
    const manager = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: manager.workspace.id,
    });
    await grantProjectManageAccess(manager.user.id, project.id);
    const person = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, manager.user.id)),
      "manager person",
    );
    await db.insert(schema.sessionTable).values({
      id: `session-${manager.user.id}`,
      token: randomUUID(),
      userId: manager.user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const role = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: manager.workspace.id,
          key: `automation-agent-${randomUUID()}`,
          name: "Automation agent",
          rank: 50,
          capabilities: ["work_item:read"],
        })
        .returning(),
      "role",
    );
    const insertRule = async (projectId: string | null) =>
      requireRow(
        await db
          .insert(automationTable)
          .values({
            workspaceId: manager.workspace.id,
            projectId,
            name: projectId ? "Project rule" : "Workspace rule",
            trigger: "work_item.created",
            effectiveRoleId: role.id,
            createdBy: person.id,
          })
          .returning(),
        "automation",
      );
    const projectRule = await insertRule(project.id);
    const workspaceRule = await insertRule(null);
    mockAuthenticatedSession(manager.user);
    const { app } = createApp();
    const refused = await app.request(`/api/automations/${workspaceRule.id}`, {
      method: "DELETE",
    });
    expect(refused.status).toBe(403);
    const accepted = await app.request(`/api/automations/${projectRule.id}`, {
      method: "DELETE",
    });
    expect(accepted.status, await accepted.clone().text()).toBe(202);
    const body = (await accepted.json()) as { pendingActionId: string };
    const row = await pending(body.pendingActionId);
    expect(row.projectId).toBe(project.id);
    expect(row.state).toBe("pending");
    // Approval re-checks the project-scoped policy and deletes the rule.
    const approved = await app.request(
      `/api/me/pending-actions/${body.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(
      await db
        .select()
        .from(automationTable)
        .where(eq(automationTable.id, projectRule.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(automationTable)
        .where(eq(automationTable.id, workspaceRule.id)),
    ).toHaveLength(1);
  });
});
