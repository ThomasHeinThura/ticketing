import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

async function enableIntake(workspaceId: string) {
  await db
    .insert(schema.instanceFeatureFlagTable)
    .values({ featureKey: "feature.intake", enabled: true, locked: false })
    .onConflictDoUpdate({
      target: schema.instanceFeatureFlagTable.featureKey,
      set: { enabled: true, locked: false },
    });
  await db
    .insert(schema.workspaceFeatureFlagTable)
    .values({ workspaceId, featureKey: "feature.intake", enabled: true })
    .onConflictDoUpdate({
      target: [
        schema.workspaceFeatureFlagTable.workspaceId,
        schema.workspaceFeatureFlagTable.featureKey,
      ],
      set: { enabled: true },
    });
}

function queueBody(workspaceId: string) {
  return {
    workspaceId,
    name: "Saved support queue",
    visibility: "private",
    submissionQuery: {
      entity: "submission",
      filter: { state: "accepted" },
    },
    workItemQuery: { entity: "work_item" },
  };
}

describe("API integration: paired intake queues", () => {
  beforeEach(async () => resetTestDatabase());

  it("creates exactly two saved views, runs both entities, and lists one queue", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    await enableIntake(member.workspace.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const createdResponse = await app.request("/api/intake/queues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...queueBody(member.workspace.id),
        submissionQuery: { entity: "submission", filter: { state: "new" } },
      }),
    });
    expect(createdResponse.status, await createdResponse.clone().text()).toBe(
      200,
    );
    const created = (await createdResponse.json()) as {
      id: string;
      versions: { submission: number; workItem: number };
      submissionView: { id: string; query: { entity: string } };
      workItemView: { id: string; query: { entity: string } };
    };
    expect(created.versions).toEqual({ submission: 1, workItem: 1 });
    expect(created.submissionView.query.entity).toBe("submission");
    expect(created.workItemView.query.entity).toBe("work_item");

    const rows = await db
      .select({
        id: schema.savedViewTable.id,
        pairId: schema.savedViewTable.queuePairId,
      })
      .from(schema.savedViewTable)
      .where(eq(schema.savedViewTable.queuePairId, created.id));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.id))).toEqual(
      new Set([created.submissionView.id, created.workItemView.id]),
    );

    const listResponse = await app.request(
      `/api/intake/queues?workspaceId=${encodeURIComponent(member.workspace.id)}`,
    );
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as Array<{ id: string }>;
    expect(listed.map((queue) => queue.id)).toEqual([created.id]);

    const runQuery = new URLSearchParams({
      workspaceId: member.workspace.id,
      workItemSorts: JSON.stringify([{ field: "priority", order: "desc" }]),
      workItemColumns: "key,title",
    });
    const runResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(created.id)}/run?${runQuery}`,
    );
    expect(runResponse.status, await runResponse.clone().text()).toBe(200);
    const run = (await runResponse.json()) as {
      submissions: { submissions: unknown[]; page: { hasMore: boolean } };
      workItems: { data: unknown[]; page: { hasMore: boolean } };
    };
    expect(run.submissions).toMatchObject({
      submissions: [],
      page: { hasMore: false },
    });
    expect(run.workItems).toMatchObject({ data: [], page: { hasMore: false } });

    const invalidOverride = await app.request(
      `/api/intake/queues/${encodeURIComponent(created.id)}/run?${new URLSearchParams(
        {
          workspaceId: member.workspace.id,
          workItemSorts: "not-json",
        },
      )}`,
    );
    expect(invalidOverride.status).toBe(400);
  });

  it("uses pair CAS and prevents editing either member through generic view routes", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    await enableIntake(member.workspace.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const createResponse = await app.request("/api/intake/queues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...queueBody(member.workspace.id),
        submissionQuery: { entity: "submission", filter: { state: "new" } },
      }),
    });
    expect(createResponse.status).toBe(200);
    const queue = (await createResponse.json()) as {
      id: string;
      versions: { submission: number; workItem: number };
      submissionView: { id: string };
      workItemView: { id: string };
    };

    const updateResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(queue.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: member.workspace.id,
          expectedVersions: queue.versions,
          name: "Updated saved support queue",
        }),
      },
    );
    expect(updateResponse.status, await updateResponse.clone().text()).toBe(
      200,
    );
    const updated = (await updateResponse.json()) as {
      name: string;
      versions: { submission: number; workItem: number };
    };
    expect(updated.name).toBe("Updated saved support queue");
    expect(updated.versions).toEqual({ submission: 2, workItem: 2 });

    const staleResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(queue.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: member.workspace.id,
          expectedVersions: queue.versions,
          name: "Stale update",
        }),
      },
    );
    expect(staleResponse.status).toBe(409);

    const genericUpdate = await app.request(
      `/api/views/${encodeURIComponent(queue.submissionView.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Break the pair" }),
      },
    );
    expect(genericUpdate.status).toBe(409);
    const genericDelete = await app.request(
      `/api/views/${encodeURIComponent(queue.workItemView.id)}`,
      { method: "DELETE" },
    );
    expect(genericDelete.status).toBe(409);
  });

  it("updates each entity query independently and preserves the pair on a malformed query", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    await enableIntake(member.workspace.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const originalWorkItemQuery = {
      entity: "work_item",
      filter: { field: "state.group", op: "eq", value: "backlog" },
      sort: [{ field: "key", direction: "asc" }],
    };
    const createResponse = await app.request("/api/intake/queues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...queueBody(member.workspace.id),
        submissionQuery: {
          entity: "submission",
          filter: { state: "new", assignee: "unclaimed" },
        },
        workItemQuery: originalWorkItemQuery,
      }),
    });
    expect(createResponse.status, await createResponse.clone().text()).toBe(
      200,
    );
    const created = (await createResponse.json()) as {
      id: string;
      versions: { submission: number; workItem: number };
    };

    const submissionOnlyResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(created.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: member.workspace.id,
          expectedVersions: created.versions,
          submissionQuery: {
            entity: "submission",
            filter: { state: "accepted" },
          },
        }),
      },
    );
    expect(
      submissionOnlyResponse.status,
      await submissionOnlyResponse.clone().text(),
    ).toBe(200);
    const submissionOnly = (await submissionOnlyResponse.json()) as {
      versions: { submission: number; workItem: number };
      submissionView: { query: unknown };
      workItemView: { query: unknown };
    };
    expect(submissionOnly.submissionView.query).toEqual({
      entity: "submission",
      filter: { state: "accepted" },
    });
    expect(submissionOnly.workItemView.query).toEqual(originalWorkItemQuery);
    expect(submissionOnly.versions).toEqual({ submission: 2, workItem: 2 });

    const workItemQuery = {
      entity: "work_item",
      filter: { field: "priority", op: "eq", value: "high" },
    };
    const workItemOnlyResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(created.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: member.workspace.id,
          expectedVersions: submissionOnly.versions,
          workItemQuery,
        }),
      },
    );
    expect(
      workItemOnlyResponse.status,
      await workItemOnlyResponse.clone().text(),
    ).toBe(200);
    const workItemOnly = (await workItemOnlyResponse.json()) as {
      versions: { submission: number; workItem: number };
      submissionView: { query: unknown };
      workItemView: { query: unknown };
    };
    expect(workItemOnly.submissionView.query).toEqual(
      submissionOnly.submissionView.query,
    );
    expect(workItemOnly.workItemView.query).toEqual(workItemQuery);

    const invalidScopeResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(created.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: member.workspace.id,
          expectedVersions: workItemOnly.versions,
          workItemQuery: {
            entity: "work_item",
            filter: { op: "and", clauses: [] },
          },
        }),
      },
    );
    expect(invalidScopeResponse.status).toBe(400);
    const afterInvalidResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(created.id)}?workspaceId=${encodeURIComponent(member.workspace.id)}`,
    );
    expect(afterInvalidResponse.status).toBe(200);
    expect(await afterInvalidResponse.json()).toMatchObject({
      versions: workItemOnly.versions,
      submissionView: { query: workItemOnly.submissionView.query },
      workItemView: { query: workItemOnly.workItemView.query },
    });
  });

  it("keeps paired views inaccessible while the intake feature is disabled", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/intake/queues?workspaceId=${encodeURIComponent(member.workspace.id)}`,
    );
    expect(response.status).toBe(404);
  });

  it("does not expose a private queue to another triager in the same workspace", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await enableIntake(owner.workspace.id);
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const createResponse = await app.request("/api/intake/queues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(queueBody(owner.workspace.id)),
    });
    expect(createResponse.status).toBe(200);
    const queue = (await createResponse.json()) as { id: string };

    const other = await createWorkspaceMember({ role: "lead" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: other.user.id,
      role: "lead",
      joinedAt: new Date(),
    });
    mockAuthenticatedSession(other.user);

    const listResponse = await app.request(
      `/api/intake/queues?workspaceId=${encodeURIComponent(owner.workspace.id)}`,
    );
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual([]);

    const getResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(queue.id)}?workspaceId=${encodeURIComponent(owner.workspace.id)}`,
    );
    expect(getResponse.status).toBe(404);
  });

  it("shares a team pair only with current team members and lets them edit its queue definition", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    await enableIntake(owner.workspace.id);
    const teamId = `queue-team-${owner.workspace.id}`;
    await db.insert(schema.teamTable).values({
      id: teamId,
      workspaceId: owner.workspace.id,
      name: "Service desk",
      createdAt: new Date(),
    });
    await db.insert(schema.teamMemberTable).values({
      id: `queue-member-owner-${owner.workspace.id}`,
      teamId,
      userId: owner.user.id,
      createdAt: new Date(),
    });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const createResponse = await app.request("/api/intake/queues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...queueBody(owner.workspace.id),
        visibility: "team",
        sharedWithTeamId: teamId,
      }),
    });
    expect(createResponse.status, await createResponse.clone().text()).toBe(
      200,
    );
    const queue = (await createResponse.json()) as {
      id: string;
      versions: { submission: number; workItem: number };
    };

    const teammate = await createWorkspaceMember({ role: "lead" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: teammate.user.id,
      role: "lead",
      joinedAt: new Date(),
    });
    await db.insert(schema.teamMemberTable).values({
      id: `queue-member-lead-${owner.workspace.id}`,
      teamId,
      userId: teammate.user.id,
      createdAt: new Date(),
    });
    mockAuthenticatedSession(teammate.user);

    const getResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(queue.id)}?workspaceId=${encodeURIComponent(owner.workspace.id)}`,
    );
    expect(getResponse.status).toBe(200);

    const updateResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(queue.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: owner.workspace.id,
          expectedVersions: queue.versions,
          name: "Team queue renamed",
        }),
      },
    );
    expect(updateResponse.status, await updateResponse.clone().text()).toBe(
      200,
    );
    expect(await updateResponse.json()).toMatchObject({
      name: "Team queue renamed",
      versions: { submission: 2, workItem: 2 },
    });
  });

  it("lets a triager use an owned queue without saved-view or work-item read grants", async () => {
    const member = await createWorkspaceMember({ role: "lead" });
    await enableIntake(member.workspace.id);
    const organisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({
          key: `queue-customer-${randomUUID()}`,
          name: "Queue customer",
        })
        .returning(),
      "queue test organisation",
    );
    const requester = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          organisationId: organisation.id,
          side: "customer",
          displayName: "Queue requester",
        })
        .returning(),
      "queue test requester",
    );
    const workItemType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: member.workspace.id,
          key: `queue-type-${randomUUID()}`,
          name: "Queue task",
          category: "delivery",
        })
        .returning(),
      "queue test work item type",
    );
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: member.workspace.id,
          key: `queue-request-${randomUUID()}`,
          name: "Queue request",
          group: "General",
          workItemTypeId: workItemType.id,
          formSchema: { fields: [] },
        })
        .returning(),
      "queue test request type",
    );
    const requestTypeVersion = requireRow(
      await db
        .insert(schema.requestTypeVersionTable)
        .values({
          workspaceId: member.workspace.id,
          requestTypeId: requestType.id,
          number: 1,
          formSchema: { fields: [] },
          workItemTypeId: workItemType.id,
        })
        .returning(),
      "queue test request type version",
    );
    const submission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: organisation.id,
          requesterId: requester.id,
          requestTypeId: requestType.id,
          requestTypeVersionId: requestTypeVersion.id,
          formData: {},
          state: "new",
          submittedAt: new Date(),
        })
        .returning(),
      "queue test submission",
    );
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const createResponse = await app.request("/api/intake/queues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...queueBody(member.workspace.id),
        submissionQuery: { entity: "submission", filter: { state: "new" } },
      }),
    });
    expect(createResponse.status, await createResponse.clone().text()).toBe(
      200,
    );
    const queue = (await createResponse.json()) as { id: string };

    const detailResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(queue.id)}?workspaceId=${encodeURIComponent(member.workspace.id)}`,
    );
    expect(detailResponse.status).toBe(200);

    const runResponse = await app.request(
      `/api/intake/queues/${encodeURIComponent(queue.id)}/run?workspaceId=${encodeURIComponent(member.workspace.id)}`,
    );
    expect(runResponse.status, await runResponse.clone().text()).toBe(200);
    const result = (await runResponse.json()) as {
      submissions: {
        submissions: Array<{ ref: string; suggestedDuplicates?: unknown[] }>;
      };
      workItems: { data: unknown[]; meta: { total: number } };
    };
    expect(result.workItems).toMatchObject({ data: [], meta: { total: 0 } });
    expect(result.submissions.submissions).toMatchObject([
      { ref: `SUB-${submission.number}`, suggestedDuplicates: [] },
    ]);
  });
});
