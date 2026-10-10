/**
 * Slice S3 runtime checks required by the 0120 security review
 * (docs/07-planning/security-reviews/m0120-approval-anchor.md, "S3 runtime checks").
 * Every case drives the real HTTP app and asserts the database afterwards, so a runtime
 * check removed from the approvals code makes at least one case here fail.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { scanApprovalReminders } from "../../apps/api/src/approval/reminder-scan";
import {
  listApprovalRows,
  listApprovalsForWorkItemTransition,
  lockApproval,
  lockApprovalsForWorkItemTransition,
  lockLiveWorkItem,
} from "../../apps/api/src/approval/repository";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

type Member = Awaited<ReturnType<typeof createWorkspaceMember>>;

const json = { "content-type": "application/json" };

async function personOf(userId: string) {
  return requireRow(
    await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1),
    "approval tenant person",
  );
}

/** One self-contained tenant: workspace, gated workflow, change-type work item, CAB approver. */
async function buildTenant(label: string) {
  const requester = await createWorkspaceMember({ role: "owner" });
  const requesterPerson = await personOf(requester.user.id);
  const { project } = await createProjectFixture({
    workspaceId: requester.workspace.id,
  });
  await grantProjectRole(requester.user.id, project.id, [
    "project:read",
    "work_item:read",
    "work_item:create",
    "work_item:transition",
    "approval:request",
    "approval:request_cab",
  ]);
  const now = new Date();
  const wsId = requester.workspace.id;
  const tpl = async (group: string, name: string) =>
    requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: wsId,
          key: `${name}-${randomUUID()}`,
          name,
          group,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "tenant state template",
    );
  const backlog = await tpl("backlog", "Backlog");
  const done = await tpl("completed", "Done");
  await db.insert(schema.stateTable).values([
    {
      projectId: project.id,
      stateTemplateId: backlog.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      projectId: project.id,
      stateTemplateId: done.id,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({
        workspaceId: wsId,
        key: `wf-${label}-${randomUUID()}`,
        name: `Workflow ${label}`,
      })
      .returning(),
    "tenant workflow",
  );
  const version = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: now })
      .returning(),
    "tenant version",
  );
  const edge = (gated: boolean, versionId = version.id) =>
    db
      .insert(schema.workflowTransitionTable)
      .values({
        versionId,
        fromStateTemplateId: backlog.id,
        toStateTemplateId: done.id,
        requiresApproval: gated,
        approvalPolicy: gated ? "any" : null,
        notePolicy: "none",
        noteVisibility: "internal",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  const gated = requireRow(await edge(true), "gated transition");
  const ungated = requireRow(await edge(false), "ungated transition");
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.workflowTable.id, workflow.id));
  // A published-but-inactive second version of the same workflow with its own gated edge.
  const staleVersion = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 2, publishedAt: now })
      .returning(),
    "tenant stale version",
  );
  const staleGated = requireRow(
    await edge(true, staleVersion.id),
    "stale gated transition",
  );
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: wsId,
        key: `type-${label}-${randomUUID()}`,
        name: "Approval ticket",
        category: "service",
        workflowId: workflow.id,
        isChange: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "tenant type",
  );

  const approver = await createWorkspaceMember({ role: "owner" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: wsId,
    userId: approver.user.id,
    role: "owner",
    joinedAt: now,
  });
  await grantProjectRole(approver.user.id, project.id, [
    "project:read",
    "work_item:read",
    "approval:decide",
    "approval:decide_cab",
  ]);
  const approverPerson = await personOf(approver.user.id);
  const cabTeam = requireRow(
    await db
      .insert(schema.teamTable)
      .values({
        id: `cab-${randomUUID()}`,
        name: "CAB",
        workspaceId: wsId,
        isCab: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "tenant cab",
  );
  await db.insert(schema.teamMemberTable).values({
    id: `cabm-${randomUUID()}`,
    teamId: cabTeam.id,
    userId: approver.user.id,
    createdAt: now,
  });

  const { app } = createApp();
  mockAuthenticatedSession(requester.user);
  const created = await app.request(`/api/projects/${project.id}/work-items`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ typeId: type.id, title: `Item ${label}` }),
  });
  expect(created.status, await created.clone().text()).toBe(200);
  const { key } = (await created.json()) as { key: string };
  await db
    .update(schema.workItemTable)
    .set({ customerVisibility: "organisation" })
    .where(eq(schema.workItemTable.key, key));
  const workItem = requireRow(
    await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key))
      .limit(1),
    "tenant work item",
  );
  await db.insert(schema.workspaceFeatureFlagTable).values({
    workspaceId: wsId,
    featureKey: "feature.approvals",
    enabled: true,
  });
  return {
    app,
    requester,
    requesterPerson,
    approver,
    approverPerson,
    workspaceId: wsId,
    project,
    workflow,
    version,
    gated,
    ungated,
    staleGated,
    type,
    workItem,
    key,
    cabTeam,
    url: `/api/work-items/${key}/approvals`,
  };
}
type Tenant = Awaited<ReturnType<typeof buildTenant>>;

function request(
  t: Tenant,
  as: Member | Tenant["requester"],
  overrides: Record<string, unknown> = {},
) {
  mockAuthenticatedSession(as.user);
  return t.app.request(t.url, {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      transitionId: t.gated.id,
      kind: "cab",
      approverId: t.approverPerson.id,
      ...overrides,
    }),
  });
}

async function createApproval(t: Tenant) {
  const response = await request(t, t.requester);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { id: string };
}

async function approvalRows(workItemId: string) {
  return db
    .select()
    .from(schema.approvalTable)
    .where(eq(schema.approvalTable.workItemId, workItemId));
}

async function decide(
  t: Tenant,
  as: { user: Member["user"] },
  id: string,
  body: Record<string, unknown> = { action: "approve" },
) {
  mockAuthenticatedSession(as.user);
  return t.app.request(`/api/approvals/${id}/decide`, {
    method: "POST",
    headers: json,
    body: JSON.stringify(body),
  });
}

describe("approvals: 0120 tenant runtime checks (S3)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("check 1: an approval of another workspace is 404 on read, decide, withdraw and the inbox", async () => {
    const a = await buildTenant("a");
    const b = await buildTenant("b");
    const approval = await createApproval(a);

    // A fully privileged member of workspace B, including the approval capabilities.
    for (const response of [
      await decide(a, b.approver, approval.id),
      await (async () => {
        mockAuthenticatedSession(b.requester.user);
        return a.app.request(`/api/approvals/${approval.id}/withdraw`, {
          method: "POST",
        });
      })(),
      await (async () => {
        mockAuthenticatedSession(b.requester.user);
        return a.app.request(a.url);
      })(),
    ]) {
      expect(response.status, await response.clone().text()).toBe(404);
    }

    mockAuthenticatedSession(b.approver.user);
    const inbox = await a.app.request("/api/me/approvals");
    expect(
      ((await inbox.json()) as { approvals: unknown[] }).approvals,
    ).toEqual([]);
    const [row] = await approvalRows(a.workItem.id);
    expect(row?.state).toBe("pending");
    expect(row?.decidedAt).toBeNull();
  });

  it("check 1: every approval query is scoped by workspace_id as well as id", async () => {
    const a = await buildTenant("a");
    const b = await buildTenant("b");
    const approval = await createApproval(a);
    expect(await listApprovalRows(a.workItem.id, a.workspaceId)).toHaveLength(
      1,
    );
    expect(await listApprovalRows(a.workItem.id, b.workspaceId)).toEqual([]);
    expect(
      await listApprovalsForWorkItemTransition(a.workItem.id, b.workspaceId),
    ).toEqual([]);
    await db.transaction(async (tx) => {
      expect(
        await lockApproval(tx, approval.id, a.workItem.id, b.workspaceId),
      ).toBeNull();
      expect(
        await lockApprovalsForWorkItemTransition(
          tx,
          a.workItem.id,
          b.workspaceId,
        ),
      ).toEqual([]);
      expect(
        await lockApproval(tx, approval.id, a.workItem.id, a.workspaceId),
      ).not.toBeNull();
      expect(
        await lockLiveWorkItem(tx, b.workspaceId, a.workItem.id),
      ).toBeNull();
    });
  });

  it("check 1: an unknown approval id is indistinguishable from another workspace's id", async () => {
    const a = await buildTenant("a");
    const response = await decide(a, a.approver, `missing-${randomUUID()}`);
    expect(response.status).toBe(404);
  });

  it("check 2: the approval's workspace comes from the loaded work item, never from the body, and a soft-deleted item is not found", async () => {
    const a = await buildTenant("a");
    const b = await buildTenant("b");

    const forged = await request(a, a.requester, {
      workspaceId: b.workspaceId,
    });
    expect(forged.status, await forged.clone().text()).toBe(400);
    expect(await approvalRows(a.workItem.id)).toHaveLength(0);

    const approval = await createApproval(a);
    const [row] = await approvalRows(a.workItem.id);
    expect(row?.id).toBe(approval.id);
    expect(row?.workspaceId).toBe(a.workspaceId);

    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.id, a.workItem.id));
    const deleted = await request(a, a.requester);
    expect(deleted.status).toBe(404);
    expect(await approvalRows(a.workItem.id)).toHaveLength(1);
  });

  it("check 3: the transition must be a gated edge of this workspace's active workflow version", async () => {
    const a = await buildTenant("a");
    const b = await buildTenant("b");

    // Another workspace's transition id.
    const foreign = await request(a, a.requester, { transitionId: b.gated.id });
    expect(foreign.status, await foreign.clone().text()).toBe(422);
    // A transition that is not approval-gated.
    const ungated = await request(a, a.requester, {
      transitionId: a.ungated.id,
    });
    expect(ungated.status).toBe(422);
    // A gated edge of a version that is not the active one.
    const stale = await request(a, a.requester, {
      transitionId: a.staleGated.id,
    });
    expect(stale.status).toBe(422);
    // A type wired to another workspace's workflow cannot make that workflow's edge valid.
    await db
      .update(schema.workItemTypeTable)
      .set({ workflowId: b.workflow.id })
      .where(eq(schema.workItemTypeTable.id, a.type.id));
    const crossWorkflow = await request(a, a.requester, {
      transitionId: b.gated.id,
    });
    expect(crossWorkflow.status, await crossWorkflow.clone().text()).toBe(422);
    expect(await approvalRows(a.workItem.id)).toHaveLength(0);

    await db
      .update(schema.workItemTypeTable)
      .set({ workflowId: a.workflow.id })
      .where(eq(schema.workItemTypeTable.id, a.type.id));
    const ok = await request(a, a.requester);
    expect(ok.status, await ok.clone().text()).toBe(200);
  });

  it("check 4: the approver must be an active, non-placeholder person with reach and, for CAB, a CAB-team member of this workspace", async () => {
    const a = await buildTenant("a");
    const b = await buildTenant("b");

    // Another organisation's person.
    const foreign = await request(a, a.requester, {
      approverId: b.approverPerson.id,
    });
    expect(foreign.status, await foreign.clone().text()).toBe(422);
    // A person id that does not exist.
    const missing = await request(a, a.requester, {
      approverId: `nobody-${randomUUID()}`,
    });
    expect(missing.status).toBe(422);
    // A placeholder.
    await db
      .update(schema.personTable)
      .set({ isPlaceholder: true })
      .where(eq(schema.personTable.id, a.approverPerson.id));
    const placeholder = await request(a, a.requester);
    expect(placeholder.status, await placeholder.clone().text()).toBe(422);
    await db
      .update(schema.personTable)
      .set({ isPlaceholder: false })
      .where(eq(schema.personTable.id, a.approverPerson.id));
    // Inactive.
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, a.approverPerson.id));
    const inactive = await request(a, a.requester);
    expect(inactive.status).toBe(422);
    await db
      .update(schema.personTable)
      .set({ active: true })
      .where(eq(schema.personTable.id, a.approverPerson.id));
    // In reach, but not on a CAB team of this workspace.
    await db
      .delete(schema.teamMemberTable)
      .where(eq(schema.teamMemberTable.teamId, a.cabTeam.id));
    const notCab = await request(a, a.requester);
    expect(notCab.status, await notCab.clone().text()).toBe(422);
    expect(await approvalRows(a.workItem.id)).toHaveLength(0);
  });

  it("check 5: requested_by is the session's person; a body-supplied requester is refused", async () => {
    const a = await buildTenant("a");
    const forged = await request(a, a.requester, {
      requestedBy: a.approverPerson.id,
    });
    expect(forged.status, await forged.clone().text()).toBe(400);
    expect(await approvalRows(a.workItem.id)).toHaveLength(0);

    await createApproval(a);
    const [row] = await approvalRows(a.workItem.id);
    expect(row?.requestedBy).toBe(a.requesterPerson.id);

    // A caller without the request capability in this workspace cannot request at all.
    const stranger = await createWorkspaceMember({ role: "member" });
    const denied = await request(a, stranger);
    expect([403, 404]).toContain(denied.status);
    expect(await approvalRows(a.workItem.id)).toHaveLength(1);
  });

  it("check 6: only the named, current approver may decide a pending, unexpired approval, once", async () => {
    const a = await buildTenant("a");
    const approval = await createApproval(a);

    // Not the approver (the requester, and a workspace outsider).
    const asRequester = await decide(a, a.requester, approval.id);
    expect(asRequester.status).toBe(403);
    const outsider = await createWorkspaceMember({ role: "owner" });
    const asOutsider = await decide(a, outsider, approval.id);
    expect(asOutsider.status).toBe(404);
    expect((await approvalRows(a.workItem.id))[0]?.state).toBe("pending");

    // Lost membership/reach before deciding.
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "private" })
      .where(eq(schema.workItemTable.id, a.workItem.id));
    const reachLost = await decide(a, a.approver, approval.id);
    expect(reachLost.status, await reachLost.clone().text()).toBe(403);
    expect((await approvalRows(a.workItem.id))[0]?.state).toBe("pending");
    await db
      .update(schema.workItemTable)
      .set({ customerVisibility: "organisation" })
      .where(eq(schema.workItemTable.id, a.workItem.id));

    // Expired.
    await db
      .update(schema.approvalTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.approvalTable.id, approval.id));
    const expired = await decide(a, a.approver, approval.id);
    expect(expired.status).toBe(409);
    expect((await approvalRows(a.workItem.id))[0]?.state).toBe("pending");
    await db
      .update(schema.approvalTable)
      .set({ expiresAt: new Date(Date.now() + 86_400_000) })
      .where(eq(schema.approvalTable.id, approval.id));

    // Two concurrent decisions: exactly one wins; the state is decided once.
    const results = await Promise.all([
      decide(a, a.approver, approval.id),
      decide(a, a.approver, approval.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [row] = await approvalRows(a.workItem.id);
    expect(row?.state).toBe("approved");
    const events = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "approval.decided"));
    expect(events).toHaveLength(1);
  });

  it("check 7: decide, withdraw and expiry never change the immutable columns", async () => {
    const a = await buildTenant("a");
    const first = await createApproval(a);
    const [before] = await approvalRows(a.workItem.id);
    const immutable = (row: typeof before) =>
      row && {
        workspaceId: row.workspaceId,
        workItemId: row.workItemId,
        transitionId: row.transitionId,
        kind: row.kind,
        requestedBy: row.requestedBy,
        approverId: row.approverId,
      };

    const decided = await decide(a, a.approver, first.id);
    expect(decided.status).toBe(200);
    const [afterDecide] = await approvalRows(a.workItem.id);
    expect(immutable(afterDecide)).toEqual(immutable(before));

    const second = await createApproval(a);
    mockAuthenticatedSession(a.requester.user);
    const withdrawn = await a.app.request(
      `/api/approvals/${second.id}/withdraw`,
      {
        method: "POST",
      },
    );
    expect(withdrawn.status).toBe(200);
    const third = await createApproval(a);
    await db
      .update(schema.approvalTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.approvalTable.id, third.id));
    await scanApprovalReminders();
    const rows = await approvalRows(a.workItem.id);
    expect(rows.map((r) => r.state).sort()).toEqual([
      "approved",
      "expired",
      "withdrawn",
    ]);
    for (const row of rows) {
      expect(immutable(row)).toEqual({
        workspaceId: a.workspaceId,
        workItemId: a.workItem.id,
        transitionId: a.gated.id,
        kind: "cab",
        requestedBy: a.requesterPerson.id,
        approverId: a.approverPerson.id,
      });
    }
  });

  it("check 8: approval events carry the approval's workspace and no notification is delivered before S4", async () => {
    const a = await buildTenant("a");
    const b = await buildTenant("b");
    const approval = await createApproval(a);
    await decide(a, a.approver, approval.id);
    const expiring = await createApproval(a);
    await db
      .update(schema.approvalTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.approvalTable.id, expiring.id));
    await scanApprovalReminders();

    const events = (await db.select().from(schema.outboxTable)).filter(
      (event) => event.kind.startsWith("approval."),
    );
    expect(events.map((e) => e.kind).sort()).toEqual([
      "approval.decided",
      "approval.expired",
      "approval.requested",
      "approval.requested",
    ]);
    for (const event of events) {
      expect(event.workspaceId).toBe(a.workspaceId);
      expect(event.workspaceId).not.toBe(b.workspaceId);
      const payload = event.payload as {
        scope: { workspaceId: string };
        payload: { approvalId: string };
      };
      expect(payload.scope.workspaceId).toBe(a.workspaceId);
      const [row] = await db
        .select()
        .from(schema.approvalTable)
        .where(eq(schema.approvalTable.id, payload.payload.approvalId));
      expect(row?.workspaceId).toBe(event.workspaceId);
    }
    // Fail closed: S4 owns delivery, so nothing is written to the inbox or delivery ledger.
    expect(
      (await db.select().from(schema.notificationTable)).filter(
        (n) => n.kind?.startsWith("approval.") ?? false,
      ),
    ).toEqual([]);
    const deliveries = await db.execute(
      sql`select count(*)::int as n from notification_delivery`,
    );
    expect(deliveries.rows[0]).toEqual({ n: 0 });
  });

  it("check 9: the approvals flag is resolved per the approval's workspace", async () => {
    const a = await buildTenant("a");
    const b = await buildTenant("b");
    await db
      .update(schema.workspaceFeatureFlagTable)
      .set({ enabled: false })
      .where(eq(schema.workspaceFeatureFlagTable.workspaceId, b.workspaceId));

    const off = await request(b, b.requester);
    expect(off.status, await off.clone().text()).toBe(404);
    expect(await approvalRows(b.workItem.id)).toHaveLength(0);
    // Workspace A's enabled flag does not leak into B and B's disabled flag does not close A.
    const on = await request(a, a.requester);
    expect(on.status, await on.clone().text()).toBe(200);
    expect(await approvalRows(a.workItem.id)).toHaveLength(1);
  });

  it("check 10: a workspace-scoped approval row is only addressable by its own workspace and id together", async () => {
    const a = await buildTenant("a");
    const approval = await createApproval(a);
    const [row] = await db
      .select()
      .from(schema.approvalTable)
      .where(
        and(
          eq(schema.approvalTable.id, approval.id),
          eq(schema.approvalTable.workspaceId, a.workspaceId),
        ),
      );
    expect(row?.workspaceId).toBe(a.workspaceId);
    // The composite FK backstops the application check: re-homing the approval to another
    // workspace without its work item is refused by the database.
    const b = await buildTenant("b");
    await expect(
      db
        .update(schema.approvalTable)
        .set({ workspaceId: b.workspaceId })
        .where(eq(schema.approvalTable.id, approval.id)),
    ).rejects.toThrow();
  });
});
